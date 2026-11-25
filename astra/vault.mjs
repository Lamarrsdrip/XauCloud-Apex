import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {modelId,DEFAULT_MODEL,reasoningEffort,DEFAULT_REASONING_EFFORT,dailyRequestLimit,DEFAULT_DAILY_REQUEST_LIMIT,DEFAULT_RESEARCH,researchSettings} from './contract.mjs';
import {DEFAULT_MODEL_BY_PROVIDER} from './models.mjs';
const RESEARCH_KEYS=Object.keys(DEFAULT_RESEARCH);

const safeError = code => Object.assign(new Error(code),{httpStatus:400});

export function createAstraVault(dataDir) {
  const file=path.join(dataDir,'astra-vault.json'), keyFile=path.join(dataDir,'astra-master.key');
  let chain=Promise.resolve();
  const locked=fn=>{const run=chain.then(fn);chain=run.catch(()=>{});return run;};
  async function read() {
    try {const obj=JSON.parse(await fs.readFile(file,'utf8'));if(!obj||Array.isArray(obj)||typeof obj!=='object')throw new Error();return obj;}
    catch(e){if(e.code==='ENOENT')return {};throw new Error('ASTRA_VAULT_UNAVAILABLE');}
  }
  async function master(create=false) {
    await fs.mkdir(dataDir,{recursive:true,mode:0o700});
    if(create) {
      try {await fs.writeFile(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});}
      catch(e){if(e.code!=='EEXIST')throw new Error('ASTRA_ENCRYPTION_UNAVAILABLE');}
    }
    try {
      const stat=await fs.lstat(keyFile);
      if(!stat.isFile()||stat.isSymbolicLink())throw new Error();
      await fs.chmod(keyFile,0o600);
      const key=await fs.readFile(keyFile);if(key.length!==32)throw new Error();return key;
    }catch{throw new Error('ASTRA_ENCRYPTION_UNAVAILABLE');}
  }
  async function write(data) {
    const tmp=file+'.tmp-'+crypto.randomUUID();
    try {await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}
    finally {await fs.rm(tmp,{force:true}).catch(()=>{});}
  }
  const identity=license=>crypto.createHash('sha256').update(license).digest('hex');
  const cryptoFields=['ciphertext','iv','tag','suffix','keyAddedAt'];
  const providerOfModel=m=>/^claude-/i.test(m)?'anthropic':'openai';
  function keysOf(rec={}){
    const keys={...(rec.providerKeys||{})};
    // v1 records used the license hash only as associated data. Preserve their
    // encryption until the customer rotates the key; new records bind provider too.
    if(rec.ciphertext&&!keys[rec.provider||'openai'])keys[rec.provider||'openai']={...Object.fromEntries(cryptoFields.map(k=>[k,rec[k]])),aadVersion:1};
    return keys;
  }
  const mask=(p,k)=>k?.ciphertext?(p==='anthropic'?'sk-ant-••••••••':'sk-••••••••••••')+k.suffix:null;
  function view(rec={}) {
    const provider=rec.provider||'openai',keys=keysOf(rec),key=keys[provider];
    return {...DEFAULT_RESEARCH,...Object.fromEntries(RESEARCH_KEYS.filter(k=>k in rec).map(k=>[k,rec[k]])),
      enabled:rec.enabled===true,hasKey:!!key?.ciphertext,model:rec.model||DEFAULT_MODEL_BY_PROVIDER[provider]||DEFAULT_MODEL,reasoningEffort:rec.reasoningEffort||DEFAULT_REASONING_EFFORT,dailyRequestLimit:'dailyRequestLimit' in rec?rec.dailyRequestLimit:DEFAULT_DAILY_REQUEST_LIMIT,
      provider,maskedKey:mask(provider,key),keyAddedAt:key?.keyAddedAt||null,availableProviders:['openai','anthropic'].filter(p=>!!keys[p]?.ciphertext),providerKeys:Object.fromEntries(['openai','anthropic'].map(p=>[p,{hasKey:!!keys[p]?.ciphertext,maskedKey:mask(p,keys[p]),keyAddedAt:keys[p]?.keyAddedAt||null}])),revision:rec.revision||0};
  }
  return {
    async settings(license){return view((await read())[identity(license)]);},
    async update(license,patch) {
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['enabled','model','reasoningEffort','dailyRequestLimit','apiKey',...RESEARCH_KEYS].includes(k)))throw safeError('INVALID_ASTRA_SETTINGS');
      if('enabled'in patch&&typeof patch.enabled!=='boolean')throw safeError('INVALID_ASTRA_SETTINGS');
      if('model'in patch)modelId(patch.model);
      if('reasoningEffort'in patch)reasoningEffort(patch.reasoningEffort);
      if('dailyRequestLimit'in patch)dailyRequestLimit(patch.dailyRequestLimit);
      let research;try{research=researchSettings(patch);}catch{throw safeError('INVALID_ASTRA_SETTINGS');}
      if('apiKey'in patch&&(typeof patch.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(patch.apiKey)))throw safeError('INVALID_API_KEY_FORMAT');
      return locked(async()=>{
        const rows=await read(),id=identity(license),rec={...(rows[id]||{})},keys=keysOf(rec);
        if('apiKey'in patch) {
          // Losing the master must not silently rotate it and destroy all other
          // users' decryptability. Rotation requires an explicit re-encryption job.
          const existingCiphertext=Object.values(rows).some(x=>Object.values(keysOf(x)).some(k=>k.ciphertext));
          const provider=patch.apiKey.startsWith('sk-ant-')?'anthropic':'openai';
          if('model' in patch&&providerOfModel(patch.model)!==provider)throw safeError('PROVIDER_MODEL_MISMATCH');
          const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',await master(!existingCiphertext),iv);
          cipher.setAAD(Buffer.from(id+'|'+provider));
          keys[provider]={ciphertext:Buffer.concat([cipher.update(patch.apiKey,'utf8'),cipher.final()]).toString('base64'),
            iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),suffix:patch.apiKey.slice(-4),keyAddedAt:new Date().toISOString(),aadVersion:2};
          rec.provider=provider;
          if(!('model'in patch)&&rec.model&&providerOfModel(rec.model)!==provider)delete rec.model;
        }
        if('enabled'in patch)rec.enabled=patch.enabled;
        if('model'in patch){
          const provider=providerOfModel(patch.model);
          if(Object.keys(keys).length&&!keys[provider]?.ciphertext)throw safeError('PROVIDER_MODEL_MISMATCH');
          rec.model=patch.model;rec.provider=provider;
        }
        rec.providerKeys=keys;
        for(const field of cryptoFields)delete rec[field];
        Object.assign(rec,research);
        if(rec.researchModel&&Object.keys(keys).length&&!keys[providerOfModel(rec.researchModel)]?.ciphertext)throw safeError('RESEARCH_PROVIDER_KEY_MISSING');
        if('reasoningEffort'in patch)rec.reasoningEffort=patch.reasoningEffort;
        if('dailyRequestLimit'in patch)rec.dailyRequestLimit=patch.dailyRequestLimit;
        rec.revision=(rec.revision||0)+1;
        rows[id]=rec;await write(rows);return view(rec);
      });
    },
    async remove(license) {
      return locked(async()=>{
        const rows=await read(),id=identity(license),old=rows[id]||{};
        rows[id]={enabled:false,model:old.model||DEFAULT_MODEL,reasoningEffort:old.reasoningEffort||DEFAULT_REASONING_EFFORT,dailyRequestLimit:'dailyRequestLimit' in old?old.dailyRequestLimit:DEFAULT_DAILY_REQUEST_LIMIT,revision:(old.revision||0)+1};
        await write(rows);return view(rows[id]);
      });
    },
    async withKey(license,fn,provider=null) {
      const id=identity(license),record=(await read())[id];
      const selected=provider||record?.provider||'openai',rec=keysOf(record)[selected];
      if(!rec?.ciphertext)throw new Error('NO_API_KEY');
      let key;
      try {
        const decipher=crypto.createDecipheriv('aes-256-gcm',await master(),Buffer.from(rec.iv,'base64'));
        decipher.setAAD(Buffer.from(rec.aadVersion===2?id+'|'+selected:id));decipher.setAuthTag(Buffer.from(rec.tag,'base64'));
        key=Buffer.concat([decipher.update(Buffer.from(rec.ciphertext,'base64')),decipher.final()]);
      }catch{throw new Error('ASTRA_ENCRYPTION_UNAVAILABLE');}
      try{return await fn(key.toString('utf8'));}finally{key.fill(0);}
    }
  };
}
