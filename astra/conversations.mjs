// Persistent research-chat conversations per license (hashed id, 0600 files).
// Images are not stored; a message only records that a chart was attached.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_CONVERSATIONS=60,MAX_MESSAGES=200;
export function createConversations(dataDir,{clock=Date.now}={}){
  const dir=path.join(dataDir,'astra-chats');
  const file=license=>path.join(dir,crypto.createHash('sha256').update(String(license)).digest('hex').slice(0,32)+'.json');
  let chain=Promise.resolve();
  const locked=fn=>{const run=chain.then(fn);chain=run.catch(()=>{});return run;};
  async function read(license){try{const v=JSON.parse(await fs.readFile(file(license),'utf8'));return Array.isArray(v.conversations)?v:{conversations:[]};}catch{return {conversations:[]};}}
  async function write(license,data){await fs.mkdir(dir,{recursive:true,mode:0o700});const tmp=file(license)+'.tmp-'+crypto.randomUUID();
    await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600});await fs.rename(tmp,file(license));}
  const title=text=>{const t=String(text).replace(/\s+/g,' ').trim();return t.length>60?t.slice(0,57)+'…':t||'New conversation';};
  return {
    async list(license){return (await read(license)).conversations.map(({id,title,createdAt,updatedAt,messages})=>({id,title,createdAt,updatedAt,messages:messages.length}))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
    async get(license,id){return (await read(license)).conversations.find(c=>c.id===id)||null;},
    async remove(license,id){return locked(async()=>{const d=await read(license);d.conversations=d.conversations.filter(c=>c.id!==id);await write(license,d);return {ok:true};});},
    async rename(license,id,name){return locked(async()=>{const d=await read(license),c=d.conversations.find(x=>x.id===id);if(!c)return null;c.title=title(name);await write(license,d);return {id,title:c.title};});},
    async append(license,id,messages){
      return locked(async()=>{
        const d=await read(license),now=new Date(clock()).toISOString();
        let c=id?d.conversations.find(x=>x.id===id):null;
        if(!c){c={id:crypto.randomUUID(),title:title(messages[0]?.text),createdAt:now,updatedAt:now,messages:[]};d.conversations.push(c);}
        for(const m of messages)c.messages.push({role:m.role,text:String(m.text).slice(0,40000),image:!!m.image,at:now});
        c.messages=c.messages.slice(-MAX_MESSAGES);c.updatedAt=now;
        d.conversations=d.conversations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,MAX_CONVERSATIONS);
        await write(license,d);return {id:c.id,title:c.title};
      });
    }
  };
}
