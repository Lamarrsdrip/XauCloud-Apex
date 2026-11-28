import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const sample={dataAvailable:true,license:{key:'TEST-LICENSE',status:'ACTIVE',account:'123'},account:{balance:1000,equity:1010,freeMargin:800,currency:'USD',broker:'Demo'},mt5:{status:'CONNECTED'},control:{desired:{armed:true},applied:{inSync:true}},astra:{hasKey:true,enabled:true,status:'ASTRA_READY'},history:[],recentHuman:[]};
try{
 for(const size of [{width:390,height:844},{width:1366,height:900}]){
  let dashboard=sample;
  const page=await browser.newPage({viewport:size}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://apex.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/me')return route.fulfill({json:dashboard});
    if(u.pathname==='/api/session/native-strategy'){
      const {strategy}=route.request().postDataJSON();
      dashboard={...dashboard,candidate:{...dashboard.candidate,strategy,appliedStrategy:strategy}};
      return route.fulfill({json:{ok:true,strategy}});
    }
    if(u.pathname==='/api/session/config'){
      const {armed}=route.request().postDataJSON();
      dashboard={...dashboard,control:{desired:{armed},applied:{inSync:true}}};
      return route.fulfill({json:{ok:true,inSync:true}});
    }
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
  await page.locator('.desk-account-strip').waitFor();
  assert.equal(await page.locator('.desk-secondary').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-overview-'+size.width+'.png'});
  await page.locator('[data-nav="campaigns"]:visible').click();
  await page.getByRole('heading',{name:'Trades',exact:true}).waitFor();
  await page.getByRole('link',{name:'Trade history ↗'}).click();
  await page.getByRole('heading',{name:'Trade history'}).waitFor();
  await page.locator('#shell-account').click();
  await page.getByRole('heading',{name:'Your account'}).waitFor();
  await page.locator('[data-nav="settings"]:visible').click();
  await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  await page.screenshot({path:'apex-settings-'+size.width+'.png'});
  await page.locator('[data-settings-tab="astra"]').click();
  assert.equal(await page.locator('#astra-model').inputValue(),'gpt-6-luna');
  for(const [id,price] of [['gpt-6-luna','$1.45'],['gpt-6.2-sol','$29'],['gpt-6.2-astra','$116']])assert.ok((await page.locator('[data-model-choice="'+id+'"]').innerText()).includes(price));
  assert.equal(await page.locator('#astra-research-model').inputValue(),'');
  await page.locator('[data-model-choice="gpt-6.2-sol"]').click();
  assert.equal(await page.locator('#astra-model').inputValue(),'gpt-6.2-sol');
  assert.equal(await page.locator('#astra-research-model').inputValue(),'');
  await page.locator('[data-model-choice="gpt-6.2-astra"]').click();
  assert.equal(await page.locator('#astra-model').inputValue(),'gpt-6.2-astra');
  await page.locator('[data-model-choice="gpt-6-luna"]').click();
  assert.equal(await page.locator('#astra-model').inputValue(),'gpt-6-luna');
  await page.screenshot({path:'apex-ai-connection-'+size.width+'.png'});
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
  await page.locator('[data-nav="lab"]:visible').click();
  await page.getByRole('heading',{name:'Strategy Research Lab'}).waitFor();
  await page.getByRole('button',{name:'New episode'}).click();
  await page.getByRole('button',{name:'Pattern engine'}).click();
  await page.getByText('Test setup',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reveal outcome'}).click();
  await page.getByText('ENGINE · FAVOURABLE FIRST',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-lab-'+size.width+'.png'});
  dashboard={...sample,candidate:{
    status:'UNQUALIFIED_PULLBACK_PATTERN',knowledge:{loaded:true,hoursWAT:[]},
    education:{status:'FORWARD_NOT_QUALIFIED',version:'8'.repeat(64),through:'2025-01-02T00:00:00Z',
      samples:{lessons:234},exam:{count:5},executionGroups:0},
    latestDecision:{pullbackEvidence:{stage:'SWEEP_RECOVERY'}},learning:{status:'COLLECTING'},
  }};
  await page.goto('https://apex.test/');
  await page.getByRole('heading',{name:'Outlook & pullbacks'}).waitFor();
  await page.getByText('234 pullback lessons',{exact:true}).waitFor();
  await page.getByText('5 simulated cases · 0 qualified groups',{exact:true}).waitFor();
  await page.getByText('SWEEP RECOVERY',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-pullback-education-'+size.width+'.png'});
  await page.locator('[data-nav="ai"]:visible').click();
  await page.getByRole('heading',{name:'Apex AI',exact:true}).waitFor();
  await page.getByText('Awaiting fresh Apex M1 broker data',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Research Lab'}).count(),0);
  dashboard={...sample,candidate:{mode:'APEX4_NATIVE_BASKET',status:'AWAITING_NATIVE_TERMINAL',strategy:'BOTH',fresh:false,basket:null,appliedStrategy:null,hoursWAT:[8,9],outlookKnowledge:{status:'OUTLOOK_GRADE_UNAVAILABLE'}},mt5:{status:'DISCONNECTED'}};
  await page.goto('https://apex.test/');
  await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
  assert.equal(await page.locator('#apx-outlook-toggle').isChecked(),true);
  assert.equal(await page.locator('#apx-pullback-toggle').isChecked(),true);
  await page.locator('#apx-outlook-toggle').uncheck();
  await page.waitForFunction(()=>!document.getElementById('apx-outlook-toggle').disabled);
  assert.equal(dashboard.candidate.strategy,'PULLBACK');
  await page.locator('#apx-pullback-toggle').uncheck();
  await page.waitForFunction(()=>!document.getElementById('apx-pullback-toggle').disabled);
  assert.equal(dashboard.candidate.strategy,'OFF');
  await page.locator('#apx-outlook-toggle').check();
  await page.waitForFunction(()=>!document.getElementById('apx-outlook-toggle').disabled);
  assert.equal(dashboard.candidate.strategy,'OUTLOOK');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-native-overview-'+size.width+'.png'});
  await page.locator('[data-nav="settings"]:visible').click();
  await page.getByRole('heading',{name:'Connect MT5',exact:true}).waitFor();
  assert.equal(await page.locator('#apx-copy-license').count(),1);
  assert.equal(await page.locator('#apx-outlook-toggle').count(),0);
  assert.equal(await page.locator('#astra4-key').count(),1);
  assert.equal(await page.getByText('Apex 4 demo preview',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-native-settings-'+size.width+'.png'});
  await page.locator('[data-nav="campaigns"]:visible').click();
  await page.getByRole('heading',{name:'Trades',exact:true}).waitFor();
  assert.equal(await page.locator('#apx-outlook-toggle').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'apex-native-trades-'+size.width+'.png'});
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{await browser.close();}
