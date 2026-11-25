import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const sample={dataAvailable:true,license:{key:'TEST-LICENSE',status:'ACTIVE',account:'123'},account:{balance:1000,equity:1010,freeMargin:800,currency:'USD',broker:'Demo'},mt5:{status:'CONNECTED'},control:{desired:{armed:true},applied:{inSync:true}},astra:{hasKey:true,enabled:true,status:'ASTRA_READY'},history:[],recentHuman:[]};
try{
 for(const size of [{width:390,height:844},{width:1366,height:900}]){
  const page=await browser.newPage({viewport:size}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://apex.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/me')return route.fulfill({json:sample});
    if(u.pathname==='/api/session/astra/chat')return route.fulfill({json:{answer:'Reference setup research response',marketStatus:'UNAVAILABLE'}});
    if(u.pathname.startsWith('/api/'))return route.fulfill({json:{}});
    const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
    const mime=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';
    try{return route.fulfill({body:await fs.readFile(new URL('../public/'+file,import.meta.url)),contentType:mime});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://apex.test/');
  await page.getByRole('heading',{name:'Command center'}).waitFor();
  await page.screenshot({path:'apex-overview-'+size.width+'.png'});
  await page.locator('[data-nav="ai"]:visible').click();
  await page.getByRole('heading',{name:'Apex AI',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Message Apex AI'}).fill('Explain the chart');
  await page.locator('#apex-chat-send').click();
  await page.getByText('Reference setup research response',{exact:true}).waitFor();
  await page.locator('[data-nav="dashboard"]:visible').click();
  await page.locator('[data-nav="ai"]:visible').click();
  await page.getByText('Reference setup research response',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-ai-'+size.width+'.png'});
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{await browser.close();}
