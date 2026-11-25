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
    if(u.pathname==='/api/session/astra/chat')return route.fulfill({contentType:'text/event-stream',body:'event: delta\ndata: {"delta":"Reference setup research response"}\n\nevent: done\ndata: {"answer":"Reference setup research response","marketStatus":"UNAVAILABLE"}\n\n'});
    const episode={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',prefix:Array.from({length:180},(_,i)=>({o:1000+i*.1,h:1000+i*.1+.2,l:1000+i*.1-.2,c:1000+i*.1+.1})),quote:{bid:1017.9,ask:1018.1},atr:1,predictions:[]};
    if(u.pathname==='/api/session/lab/new')return route.fulfill({json:episode});
    if(u.pathname.endsWith('/predict'))return route.fulfill({json:{...episode,predictions:[{source:'ENGINE',hash:'a'.repeat(64),prediction:{direction:'SELL',stage:'READY',reasoning:'Test setup',entryCondition:'Now',invalidationPrice:1020,targetPrice:1016,confidence:50}}]}});
    if(u.pathname.endsWith('/reveal'))return route.fulfill({json:{...episode,revealed:true,archiveCutoff:'2025-01-03T00:00:00Z',future:episode.prefix.slice(0,120),scores:[{source:'ENGINE',result:'FAVOURABLE_FIRST',mfePts:2,maePts:.5}]}});

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
  await page.getByRole('button',{name:'Research Lab'}).click();
  await page.getByRole('button',{name:'New episode'}).click();
  await page.getByRole('button',{name:'Pattern engine'}).click();
  await page.getByText('Test setup',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reveal outcome'}).click();
  await page.getByText('ENGINE · FAVOURABLE FIRST',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-lab-'+size.width+'.png'});
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{await browser.close();}
