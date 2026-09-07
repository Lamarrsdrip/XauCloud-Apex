(function(){
  'use strict';
  var PREFS = [
    ['setupDetected','Setup Detected','Potential setup found; Apex is watching for confirmation.'],
    ['tradeFired','Trade Fired','First broker-confirmed Apex entry opened.'],
    ['newLayers','New Layers','Apex adds another confirmed layer.'],
    ['campaignClosed','Campaign Closed','Apex campaign finishes.'],
    ['criticalAlerts','Critical Execution Alerts','Broker rejection, unconfirmed order, close stall or master SL failure.'],
    ['setupCancelled','Setup Cancelled','A watched setup becomes invalid.'],
    ['profitFloorUpdates','Profit Floor Updates','Apex raises the earned profit floor.'],
    ['masterSlUpdates','Master SL Updates','Broker-verified master stop changes.']
  ];

  function api(path, opts){
    opts = opts || {};
    var o = { method: opts.method || 'GET', credentials:'same-origin', headers:{'content-type':'application/json'} };
    if (opts.body !== undefined) o.body = JSON.stringify(opts.body);
    return fetch(path,o).then(async function(r){
      var d={}; try{d=await r.json();}catch(_){}
      if(!r.ok) throw new Error(d.error||d.reason||('HTTP '+r.status));
      return d;
    });
  }
  function supported(){ return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function b64(s){
    var p='='.repeat((4-s.length%4)%4), raw=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')), a=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i); return a;
  }
  async function registration(){
    var reg = await navigator.serviceWorker.register('/push-sw.js',{scope:'/'});
    await navigator.serviceWorker.ready;
    return reg;
  }
  async function getSub(){
    if(!supported()) return null;
    var reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]}); }
  function toast(msg, bad){
    var x=document.createElement('div'); x.textContent=msg;
    x.style.cssText='position:fixed;z-index:99999;left:50%;bottom:28px;transform:translateX(-50%);padding:11px 14px;border-radius:12px;background:'+(bad?'#6f1f25':'#17231b')+';color:#fff;border:1px solid rgba(255,255,255,.15);box-shadow:0 10px 35px rgba(0,0,0,.4);font:600 13px system-ui';
    document.body.appendChild(x); setTimeout(function(){x.remove()},2600);
  }
  function injectStyles(){
    if(document.getElementById('apex-notify-style'))return;
    var s=document.createElement('style'); s.id='apex-notify-style'; s.textContent=`
      .apn-card{border:1px solid rgba(216,177,90,.28);background:linear-gradient(180deg,rgba(216,177,90,.055),rgba(255,255,255,.012));border-radius:18px;padding:18px;margin-bottom:16px}
      .apn-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.apn-title{font-size:17px;font-weight:800}.apn-sub{font-size:12px;opacity:.68;margin-top:4px;line-height:1.45}.apn-status{font-size:11px;font-weight:800;padding:6px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.13);white-space:nowrap}.apn-status.on{color:#8de1a3;background:rgba(50,160,88,.12)}.apn-status.off{color:#f0c979;background:rgba(216,177,90,.08)}
      .apn-actions{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}.apn-btn{appearance:none;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:inherit;padding:10px 12px;border-radius:10px;font-weight:700;cursor:pointer}.apn-btn.primary{background:#d8b15a;color:#080a0e;border-color:#d8b15a}.apn-btn:disabled{opacity:.5;cursor:wait}
      .apn-grid{display:grid;grid-template-columns:1fr;gap:8px}.apn-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid rgba(255,255,255,.07)}.apn-row:first-child{border-top:0}.apn-lbl{font-size:13px;font-weight:700}.apn-hint{font-size:11px;opacity:.58;margin-top:3px;line-height:1.35}.apn-switch{width:44px;height:24px;position:relative;flex:0 0 auto}.apn-switch input{opacity:0;width:0;height:0}.apn-track{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.15);transition:.2s}.apn-track:after{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}.apn-switch input:checked+.apn-track{background:#d8b15a}.apn-switch input:checked+.apn-track:after{transform:translateX(20px);background:#080a0e}.apn-ios{font-size:11px;line-height:1.5;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.035);margin-top:12px;opacity:.8}
    `; document.head.appendChild(s);
  }
  async function enable(btn){
    if(!supported()) throw new Error('Push notifications are not supported in this browser.');
    if(/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches){
      throw new Error('On iPhone, add Apex to Home Screen first, open it from the Home Screen, then enable notifications.');
    }
    var permission=await Notification.requestPermission(); if(permission!=='granted')throw new Error('Notification permission was not granted.');
    var key=await api('/api/notifications/key');
    var reg=await registration(); var sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key.publicKey)});
    await api('/api/notifications/subscribe',{method:'POST',body:{subscription:sub.toJSON()}});
    if(btn) btn.textContent='Notifications Enabled';
  }
  async function disable(){
    var sub=await getSub();
    if(sub){ await api('/api/notifications/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint}}).catch(function(){}); await sub.unsubscribe().catch(function(){}); }
  }
  async function render(){
    injectStyles();
    var slot=document.getElementById('apex-notifications-card'); if(!slot)return;
    if(slot.dataset.ready==='1')return;
    slot.dataset.ready='1';
    slot.innerHTML='<div class="apn-card"><div class="apn-top"><div><div class="apn-title">Apex Notifications</div><div class="apn-sub">Real-time setup and broker-confirmed execution alerts. Trading never waits for notifications.</div></div><div id="apn-status" class="apn-status off">Checking...</div></div><div class="apn-actions"><button id="apn-enable" class="apn-btn primary">Enable Notifications</button><button id="apn-test" class="apn-btn">Send Test Notification</button><button id="apn-disable" class="apn-btn">Disable on This Device</button></div><div id="apn-grid" class="apn-grid"></div><div class="apn-ios">iPhone: open Apex in Safari → Add to Home Screen → open Apex from Home Screen → Settings → Enable Notifications → Allow. Permission is only requested when you press the button.</div></div>';
    var status=document.getElementById('apn-status'), grid=document.getElementById('apn-grid');
    try{
      var s=await api('/api/notifications/status'), prefs=s.preferences||{}; var sub=await getSub();
      status.textContent=sub?'Enabled on this device':'Not enabled on this device'; status.className='apn-status '+(sub?'on':'off');
      grid.innerHTML=PREFS.map(function(p){return '<div class="apn-row"><div><div class="apn-lbl">'+esc(p[1])+'</div><div class="apn-hint">'+esc(p[2])+'</div></div><label class="apn-switch"><input type="checkbox" data-pref="'+p[0]+'" '+(prefs[p[0]]?'checked':'')+'><span class="apn-track"></span></label></div>'}).join('');
      grid.querySelectorAll('input[data-pref]').forEach(function(el){el.addEventListener('change',async function(){var body={};body[this.dataset.pref]=this.checked;try{await api('/api/notifications/preferences',{method:'POST',body:body});toast('Notification preference saved')}catch(e){this.checked=!this.checked;toast(e.message,true)}})});
    }catch(e){ status.textContent='Unavailable'; status.className='apn-status off'; grid.innerHTML='<div class="apn-hint">'+esc(e.message)+'</div>'; }
    document.getElementById('apn-enable').onclick=async function(){this.disabled=true;try{await enable(this);status.textContent='Enabled on this device';status.className='apn-status on';toast('Apex notifications enabled')}catch(e){toast(e.message,true)}finally{this.disabled=false}};
    document.getElementById('apn-disable').onclick=async function(){this.disabled=true;try{await disable();status.textContent='Not enabled on this device';status.className='apn-status off';toast('Notifications disabled on this device')}catch(e){toast(e.message,true)}finally{this.disabled=false}};
    document.getElementById('apn-test').onclick=async function(){this.disabled=true;try{var r=await api('/api/notifications/test',{method:'POST',body:{}});toast('Test push sent to '+r.sent+' device(s)')}catch(e){toast(e.message,true)}finally{this.disabled=false}};
  }
  var mo=new MutationObserver(function(){render().catch(function(){})});
  function start(){render().catch(function(){});mo.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('hashchange',function(){setTimeout(function(){render().catch(function(){})},50)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
