(function(){
  'use strict';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function pct(v){return typeof v==='number'?Math.round(v*100)+'%':'—';}
  function row(k,v){return '<div class="row"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v==null?'—':v)+'</span></div>';}
  function label(v){return String(v||'NO SETUP').replace(/_/g,' ');}
  function card(me,editing){
    var a=me.astra||{},d=a.lastDecision||{},c=me.campaign||{};
    var status=label(a.status||'NATIVE_LIFESTYLE');
    var html='<section class="card" aria-label="Astra Brain"><div class="card-head"><h3>ASTRA BRAIN</h3><span class="pill '+(a.status==='ASTRA_ACTIVE'?'green':'amber')+'">'+esc(status)+'</span></div>';
    html+='<div style="font-size:18px;font-weight:600;margin:12px 0">'+esc(label(d.state||'NO_SETUP'))+'</div>';
    html+=row('Last recommendation',d.action?label(d.action):'WAIT')+row('Confidence · setup quality',pct(d.confidence)+' · '+pct(d.setupQuality));
    html+=row('Freshness · extension risk',pct(d.freshness)+' · '+pct(d.extensionRisk));
    html+=row('Campaign owner',c.strategyOwner||'LIFESTYLE_NATIVE')+row('Active positions',c.layers??0);
    html+=row('Model',a.model+(a.reasoningEffort?' · effort '+a.reasoningEffort:''))+row('Knowledge',a.knowledgeVersion||a.strategyVersion)+row('Latency',a.latencyMs==null?'—':a.latencyMs+' ms');
    html+=row('Requests today',(a.requestsToday==null?'—':a.requestsToday)+' / '+(a.dailyRequestLimit||'—'))+row('Last fallback',a.lastFallbackReason?label(a.lastFallbackReason):'—');
    if(d.createdAtMs)html+=row('Decision time',new Date(d.createdAtMs).toLocaleString());
    if(editing){
      html+='<div class="toggle-row"><label for="astra-enabled">Enable Astra</label><input id="astra-enabled" type="checkbox" '+(a.enabled?'checked':'')+'></div>';
      html+='<div class="field"><label for="astra-key">OpenAI API Key</label><input id="astra-key" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="none" placeholder="'+esc(a.maskedKey||'Enter your key')+'"><div class="hint">Your key is encrypted on the Apex backend. Leave blank to keep the saved key.</div></div>';
      html+='<div class="field"><label for="astra-model">Model</label><input id="astra-model" value="'+esc(a.model||'gpt-6-astra')+'" autocomplete="off" spellcheck="false"></div>';
      html+='<div class="field"><label for="astra-limit">Daily request limit</label><input id="astra-limit" type="number" min="10" max="5000" step="10" value="'+esc(a.dailyRequestLimit||500)+'"><div class="hint">Each Astra decision is a paid request on your key. When the limit is reached, Apex trades native Lifestyle until the next UTC day.</div></div>';
      var efforts=['low','medium','high','none','default'],eff=a.reasoningEffort||'low';
      html+='<div class="field"><label for="astra-effort">Reasoning effort</label><select id="astra-effort">'+efforts.map(function(x){return '<option value="'+x+'"'+(x===eff?' selected':'')+'>'+esc(x==='default'?'Model default':x)+'</option>';}).join('')+'</select><div class="hint">Decisions expire after 8 seconds. Higher effort is slower and may time out, which hands control to native Lifestyle.</div></div>';
      html+='<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="astra-save">Save Key &amp; Settings</button><button class="btn btn-ghost" id="astra-test">Test Connection</button><button class="btn btn-ghost" id="astra-checks">Run Strategy Checks</button><button class="btn btn-ghost" id="astra-remove" '+(!a.hasKey?'disabled':'')+'>Remove Key</button></div>';
      html+='<p class="hint">Both tests use your saved key and incur API usage. Test Connection proves only that your key, model and the decision format work. Strategy Checks grade nine synthetic situations without placing orders. Neither proves trading performance.</p><div id="astra-result" role="status" aria-live="polite" style="margin-top:12px"></div>';
    }
    return html+'</section>';
  }
  async function request(method,route,body){
    var response=await fetch(route,{method:method,credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    var data=await response.json();if(!response.ok)throw new Error(data.error||'ASTRA_REQUEST_FAILED');return data;
  }
  function bind(refresh){
    var save=document.getElementById('astra-save');if(!save)return;
    var result=document.getElementById('astra-result');
    var buttons=['astra-save','astra-test','astra-checks','astra-remove'].map(function(id){return document.getElementById(id);});
    async function run(fn){buttons.forEach(function(b){b.disabled=true;});result.textContent='Working…';
      try{await fn();}catch(e){result.textContent=label(e.message);}finally{buttons.forEach(function(b){b.disabled=false;});}}
    save.onclick=function(){run(async function(){
      var input=document.getElementById('astra-key'),patch={enabled:document.getElementById('astra-enabled').checked,model:document.getElementById('astra-model').value.trim(),reasoningEffort:document.getElementById('astra-effort').value,dailyRequestLimit:parseInt(document.getElementById('astra-limit').value,10)};
      if(input.value.trim())patch.apiKey=input.value.trim();
      try{await request('POST','/api/session/astra',patch);}finally{input.value='';delete patch.apiKey;}
      await refresh();
    });};
    document.getElementById('astra-remove').onclick=function(){run(async function(){await request('DELETE','/api/session/astra',{});document.getElementById('astra-key').value='';await refresh();});};
    function test(scope){run(async function(){
      var data=await request('POST','/api/session/astra/test',{scope:scope});
      var lines=(data.results||[]).map(function(r){
        if(r.error)return r.name+': '+label(r.error);
        var t=r.latencyMs!=null?' · '+r.latencyMs+' ms'+(r.withinDecisionBudget===false?' (too slow for live use)':''):'';
        return scope==='connection'?'Model replied '+label(r.action)+' / '+label(r.state)+t:r.name+': '+(r.passed?'PASS':'FAIL (got '+label(r.action)+')')+t;});
      result.textContent=label(data.status)+' · '+lines.join(' · ');
    });}
    document.getElementById('astra-test').onclick=function(){test('connection');};
    document.getElementById('astra-checks').onclick=function(){test('strategy');};
  }
  window.AstraUI={card:card,bind:bind};
})();
