(function(){
  'use strict';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function pct(v){return typeof v==='number'?Math.round(v*100)+'%':'—';}
  function row(k,v){return '<div class="row"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v==null?'—':v)+'</span></div>';}
  function label(v){return String(v||'NO SETUP').replace(/_/g,' ');}
  function card(me,editing){
    var a=me.astra||{},d=a.lastDecision||{};
    var connected=a.status==='ASTRA_ACTIVE',hasKey=a.hasKey===true,enabled=a.enabled===true;
    var state=connected?'Connected':enabled?(hasKey?'Checking connection':'Finish setup'):'Off';
    var html='<section class="card" aria-label="Astra AI settings">'
      +'<div class="release-head"><div><h3 style="margin:0 0 5px">Astra AI</h3>'
      +'<div class="settings-subtle">Optional AI decisions, managed from your Apex account.</div></div>'
      +'<span class="overview-pill '+(connected?'ok':enabled?'':'off')+'">'+esc(state)+'</span></div>';
    if(!editing){
      html+='<div class="settings-subtle" style="margin-top:13px">'+(connected?'Astra is connected to Apex.':'Apex is using its native trading strategy.')+'</div>';
      return html+'</section>';
    }
    html+='<p class="settings-section-intro" style="margin:18px 0">Astra can help evaluate trade setups. If it is switched off or unavailable, Apex uses its native trading rules. Enabling AI does not guarantee profitable trades.</p>';
    html+='<div class="overview-inline-control" style="margin:0 0 21px"><div>'
      +'<label class="control-title" for="astra-enabled" style="display:block;cursor:pointer">Use Astra AI</label>'
      +'<div class="control-desc">'+(hasKey?'A key is securely saved for this license.':'Connect your own OpenAI API key to enable Astra.')+'</div>'
      +'</div><label class="switch"><input id="astra-enabled" type="checkbox" aria-label="Enable Astra AI" '+(enabled?'checked':'')+'>'
      +'<span class="track"></span><span class="knob"></span></label></div>';
    html+='<div class="field"><label for="astra-key">OpenAI API key</label>'
      +'<input id="astra-key" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="none" placeholder="'+esc(a.maskedKey||'Paste your API key here')+'">'
      +'<div class="hint">Create a key in <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a> and enable API billing. Your key is encrypted on Apex and never goes into MT5. Leave this empty to keep an existing key.</div></div>';
    html+='<details class="settings-details" style="margin-bottom:18px"><summary><span>'
      +'<span class="details-name">AI usage & model</span>'
      +'<span class="details-desc" style="display:block">Choose a supported model and control API requests.</span>'
      +'</span></summary><div class="details-content" style="padding-top:21px">'
      +'<div class="field"><label for="astra-model">Model</label><input id="astra-model" value="'+esc(a.model||'gpt-6-astra')+'" autocomplete="off" spellcheck="false">'
      +'<div class="hint">Use a model available through your own OpenAI API account.</div></div>'
      +'<div class="field"><label for="astra-limit">Daily API request limit</label><input id="astra-limit" type="number" min="10" max="5000" step="10" value="'+esc(a.dailyRequestLimit||500)+'">'
      +'<div class="hint">Astra requests are billed separately by your API provider. This is a request count, not a spending limit. When reached, native trading takes over until the next UTC day.</div></div>';
    var efforts=['low','medium','high','none','default'],eff=a.reasoningEffort||'low';
    html+='<div class="field"><label for="astra-effort">Reasoning effort</label><select id="astra-effort">'
      +efforts.map(function(x){return '<option value="'+x+'"'+(x===eff?' selected':'')+'>'+esc(x==='default'?'Model default':x)+'</option>';}).join('')
      +'</select><div class="hint">Higher effort may respond too slowly for live decisions. Apex falls back to native trading when a decision times out.</div></div>'
      +'</div></details>';
    html+='<div class="release-actions" style="margin-top:8px">'
      +'<button class="btn btn-primary" id="astra-save" style="width:auto">Save Astra settings</button>'
      +'<button class="btn btn-ghost" id="astra-test" style="width:auto" '+(!hasKey?'disabled':'')+'>Test connection</button></div>';
    html+='<details class="settings-details" style="margin-top:18px"><summary><span>'
      +'<span class="details-name">Advanced Astra tools</span>'
      +'<span class="details-desc" style="display:block">Run strategy checks, review diagnostics or remove your saved key.</span>'
      +'</span></summary><div class="details-content" style="padding-top:14px">'
      +row('Last decision',d.action?label(d.action):'No decision yet')
      +row('AI requests today',(a.requestsToday==null?'—':a.requestsToday)+' / '+(a.dailyRequestLimit||'—'))
      +row('Last connection issue',a.lastFallbackReason?label(a.lastFallbackReason):'None reported')
      +'<div class="release-actions" style="margin-top:15px">'
      +'<button class="btn btn-ghost" style="width:auto" id="astra-checks" '+(!hasKey?'disabled':'')+'>Run strategy checks</button>'
      +'<button class="btn btn-danger" style="width:auto" id="astra-remove" '+(!hasKey?'disabled':'')+'>Remove API key</button></div>'
      +'<div class="hint" style="margin-top:10px">Both tests use your saved key and may incur API charges. A successful connection is not proof of trading performance.</div></div></details>'
      +'<div id="astra-result" role="status" aria-live="polite" class="settings-subtle" style="margin-top:13px"></div>'
      +'</section>';
    return html;
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
