import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await fs.readFile(new URL('../public/premium.css', import.meta.url), 'utf8');
const astra = await fs.readFile(new URL('../public/astra-ui.js', import.meta.url), 'utf8');
const notifications = await fs.readFile(new URL('../public/notifications-ui.js', import.meta.url), 'utf8');

function browserFunctions(){
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Apex customer app script must be present');
  const code = script.replace(/\nboot\(\);\s*\}\)\(\);\s*$/, '\nwindow.__test={pageDashboard,pageSettings,pageAccount,pageHistory,pageCampaigns,pageLearning,releaseCard,renderStatusPills,settingsTabs,activateSettingsTab,STATE,NAV};\n})();');
  assert.match(code, /window\.__test/, 'Test app must omit live boot and expose render functions');
  const targets = new Map();
  const context={
    window:{addEventListener(){},AstraUI:{card:()=>'<div id="astra-control">Astra controls</div>'}},
    document:{getElementById(id){if(!targets.has(id))targets.set(id,{innerHTML:'',addEventListener(){}});return targets.get(id);}},
    location:{hash:''},console,
    setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}
  };
  vm.runInNewContext(code,context,{timeout:1000,filename:'apex-index-inline.js'});
  return {app:context.window.__test,targets};
}

const sample={
  dataAvailable:true,
  license:{key:'APEX-EXAMPLE',status:'ACTIVE',account:'12345678',accountProfile:'NORMAL'},
  account:{balance:1000,equity:1020,freeMargin:930,broker:'ExampleBroker',account:'12345678',currency:'USD',asOf:new Date().toISOString()},
  mt5:{status:'CONNECTED',lastSeen:new Date().toISOString()},
  control:{desired:{armed:true,revision:2},applied:{revision:2,inSync:true}},
  settings:{accountProfile:'NORMAL',normalTargetProfitPct:0,normalL1MarginPct:15,normalL2MarginPct:50,
    normalL3PlusMarginPct:100,normalReferenceLeverage:200,normalFixedSLGoldMove:12,maxLayers:5,
    masterBreakEvenEnabled:true,masterBreakEvenTriggerPct:2,recoveryExitEnabled:true,recoveryExitArmPctOfSL:40,
    profitRatchetEnabled:true,ratchetTriggerPct:5,ratchetLockPct:2,ratchetStepPct:1,ratchetLockStepPct:1,advanced:{}},
  release:{available:true,version:'3.10.0',sha256:'a'.repeat(64),publishedAt:new Date().toISOString()},
  recentHuman:[{ts:new Date().toISOString(),text:'Broker confirmed the position'}]
};

test('download is available ONLY inside Settings, never Overview or Account',()=>{
  const {app}=browserFunctions();
  const overview=app.pageDashboard(sample);
  const account=app.pageAccount(sample);
  const settings=app.pageSettings(sample);
  assert.doesNotMatch(overview,/href="\/api\/session\/bot\/download"/);
  assert.doesNotMatch(account,/href="\/api\/session\/bot\/download"/);
  assert.match(settings,/href="\/api\/session\/bot\/download"/);
  assert.match(settings,/Download Apex \.ex5/);
  assert.match(account,/Open setup & updates/);
  assert.match(overview,/Account balance/);
  assert.match(overview,/Open trade P\/L/);
  assert.doesNotMatch(overview,/Score components|CONFIG REVISION|ASTRA BRAIN|Effective EA Configuration/);
});

test('dashboard with no heartbeat offers setup without presenting an obsolete binary',()=>{
  const {app}=browserFunctions();
  const overview=app.pageDashboard({...sample,dataAvailable:false,release:{available:false,version:'3.10.0'}});
  assert.match(overview,/Get Apex connected/);
  assert.match(overview,/Setup guide/);
  assert.doesNotMatch(overview,/Download Apex \.ex5/);
});

test('Settings separates common setup from risk controls and optional AI',()=>{
  const {app}=browserFunctions();
  const settings=app.pageSettings(sample);
  for(const tab of ['setup','trading','protection','astra','more']){
    assert.ok(settings.includes('data-settings-tab="'+tab+'"'),tab+' tab missing');
    assert.ok(settings.includes('data-settings-panel="'+tab+'"'),tab+' panel missing');
  }
  for(const id of ['arm-toggle','f-change-license','f-normalTargetProfitPct','f-normalL1MarginPct',
    'f-normalFixedSLGoldMove','f-masterBreakEvenEnabled','f-recoveryExitEnabled',
    'f-profitRatchetEnabled','f-entryScore','apex-notifications-card']){
    assert.ok(settings.includes('id="'+id+'"'),id+' control lost');
  }
  assert.match(settings,/Setup & updates/);
  assert.match(settings,/https:\/\/xaucloud\.io/);
  assert.match(settings,/https:\/\/apex\.xaucloud\.io/);
  assert.match(settings,/id="astra-control"/);
  assert.match(astra,/id="astra-key" type="password"/);
  assert.match(settings,/settings-details/);
});

test('mobile navigation retains Account and Settings; Insights remains accessible in History',()=>{
  const {app}=browserFunctions();
  const ids=Array.from(app.NAV,part=>part.id);
  assert.ok(ids.includes('account'));
  assert.ok(ids.includes('settings'));
  assert.ok(app.pageHistory({...sample,history:[]}).includes('history-insights-link'));
  assert.match(html,/NAV\.filter\(function\(n\)\{return n\.id!=='learning';\}\)/);
});

test('status pills do not claim trading is running with disconnected MT5',()=>{
  const {app,targets}=browserFunctions();
  app.STATE.me={...sample,mt5:{status:'DISCONNECTED',lastSeen:null}};
  app.renderStatusPills();
  const status=targets.get('status-pills').innerHTML;
  assert.match(status,/MT5 offline/);
  assert.doesNotMatch(status,/Trading enabled/);
});

test('UI stylesheet and Astra / notification scripts remain linked and parsable',()=>{
  assert.match(html,/href="\/premium\.css\?v=/);
  for(const [name,src] of [['astra-ui.js',astra],['notifications-ui.js',notifications]])
    assert.doesNotThrow(()=>new vm.Script(src,{filename:name}));
  for(const cls of ['settings-panel','settings-tabs','balance-hero','overview-layout','overview-inline-control'])
    assert.match(css,new RegExp('\\.'+cls.replace(/-/g,'\\-')));
});

test('AI route versioned assets and graceful reload fallback',()=>{assert.match(html,/astra-ui\.js\?v=2026-11-25-desk/);assert.match(html,/typeof window\.AstraUI\.chatPage/);assert.match(html,/reload-ai/);assert.match(astra,/apex-chat-welcome/);});
