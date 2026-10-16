import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {modelId,DEFAULT_MODEL,reasoningEffort,DEFAULT_REASONING_EFFORT,dailyRequestLimit,DEFAULT_DAILY_REQUEST_LIMIT} from './contract.mjs';

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
  function view(rec={}) {
    return {enabled:rec.enabled===true,hasKey:!!rec.ciphertext,model:rec.model||DEFAULT_MODEL,reasoningEffort:rec.reasoningEffort||DEFAULT_REASONING_EFFORT,dailyRequestLimit:rec.dailyRequestLimit||DEFAULT_DAILY_REQUEST_LIMIT,
      maskedKey:rec.ciphertext?'sk-••••••••••••'+rec.suffix:null,revision:rec.revision||0};
  }
  return {
    async settings(license){return view((await read())[identity(license)]);},
    async update(license,patch) {
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['enabled','model','reasoningEffort','dailyRequestLimit','apiKey'].includes(k)))throw safeError('INVALID_ASTRA_SETTINGS');
      if('enabled'in patch&&typeof patch.enabled!=='boolean')throw safeError('INVALID_ASTRA_SETTINGS');
      if('model'in patch)modelId(patch.model);
      if('reasoningEffort'in patch)reasoningEffort(patch.reasoningEffort);
      if('dailyRequestLimit'in patch)dailyRequestLimit(patch.dailyRequestLimit);
      if('apiKey'in patch&&(typeof patch.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(patch.apiKey)))throw safeError('INVALID_API_KEY_FORMAT');
      return locked(async()=>{
        const rows=await read(),id=identity(license),rec={...(rows[id]||{})};
        if('apiKey'in patch) {
          // Losing the master must not silently rotate it and destroy all other
          // users' decryptability. Rotation requires an explicit re-encryption job.
          const existingCiphertext=Object.values(rows).some(x=>x.ciphertext);
          const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',await master(!existingCiphertext),iv);
          cipher.setAAD(Buffer.from(id));
          rec.ciphertext=Buffer.concat([cipher.update(patch.apiKey,'utf8'),cipher.final()]).toString('base64');
          rec.iv=iv.toString('base64');rec.tag=cipher.getAuthTag().toString('base64');rec.suffix=patch.apiKey.slice(-4);
        }
        if('enabled'in patch)rec.enabled=patch.enabled;
        if('model'in patch)rec.model=patch.model;
        if('reasoningEffort'in patch)rec.reasoningEffort=patch.reasoningEffort;
        if('dailyRequestLimit'in patch)rec.dailyRequestLimit=patch.dailyRequestLimit;
        rec.revision=(rec.revision||0)+1;
        rows[id]=rec;await write(rows);return view(rec);
      });
    },
    async remove(license) {
      return locked(async()=>{
        const rows=await read(),id=identity(license),old=rows[id]||{};
        rows[id]={enabled:false,model:old.model||DEFAULT_MODEL,reasoningEffort:old.reasoningEffort||DEFAULT_REASONING_EFFORT,dailyRequestLimit:old.dailyRequestLimit||DEFAULT_DAILY_REQUEST_LIMIT,revision:(old.revision||0)+1};
        await write(rows);return view(rows[id]);
      });
    },
    async withKey(license,fn) {
      const id=identity(license),rec=(await read())[id];
      if(!rec?.ciphertext)throw new Error('NO_API_KEY');
      let key;
      try {
        const decipher=crypto.createDecipheriv('aes-256-gcm',await master(),Buffer.from(rec.iv,'base64'));
        decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(rec.tag,'base64'));
        key=Buffer.concat([decipher.update(Buffer.from(rec.ciphertext,'base64')),decipher.final()]);
      }catch{throw new Error('ASTRA_ENCRYPTION_UNAVAILABLE');}
      try{return await fn(key.toString('utf8'));}finally{key.fill(0);}
    }
  };
}
