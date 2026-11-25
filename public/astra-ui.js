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
      +'<div class="field"><label for="astra-limit">Daily live-decision request limit</label><input id="astra-limit" type="number" min="10" max="5000" step="10" value="'+esc(a.dailyRequestLimit||500)+'">'
      +'<div class="hint">Live decision requests are billed by your API provider. Research chat is billed separately and does not consume this live-decision allowance. When reached, native trading takes over until the next UTC day.</div></div>';
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
  function chatPage(me){
    var hasKey=me.astra&&me.astra.hasKey;
    return '<section class="apex-ai-chat"><header><div class="apex-ai-mark" aria-hidden="true">✦</div><div><h2>Apex AI</h2><p>Gold setup research · Reference pattern intelligence</p></div><button type="button" id="apex-chat-clear" class="btn btn-ghost">Clear</button></header>'
      +(hasKey?'':'<div class="apex-chat-note">Connect your API key in <a href="#settings">Settings</a> to use Apex AI.</div>')
      +'<div class="apex-chat-thread" id="apex-chat-thread" role="log" aria-live="polite"><div class="apex-chat-assistant">Send a gold chart or ask me to investigate a setup. I can compare it with Apex’s reference patterns and available market evidence.</div></div>'
      +'<form id="apex-chat-form"><div class="apex-chat-attachment"><input type="file" id="apex-chat-image" accept="image/png,image/jpeg" aria-label="Attach gold chart"><span>PNG or JPEG · up to 1 MB</span></div><div class="apex-chat-compose"><textarea id="apex-chat-message" aria-label="Message Apex AI" placeholder="Ask about a gold setup…" rows="2" maxlength="4000" '+(hasKey?'':'disabled')+'></textarea><button type="submit" id="apex-chat-send" class="btn btn-primary" '+(hasKey?'':'disabled')+'>Send</button></div><div id="apex-chat-status" class="hint" role="status"></div></form></section>';
  }
  function bindChat(){
    var thread=document.getElementById('apex-chat-thread'),form=document.getElementById('apex-chat-form');
    if(!thread||!form)return;
    var message=document.getElementById('apex-chat-message'),attachment=document.getElementById('apex-chat-image'),send=document.getElementById('apex-chat-send'),status=document.getElementById('apex-chat-status'),clear=document.getElementById('apex-chat-clear');
    var history=[],busy=false;
    function append(role,text){var node=document.createElement('div');node.className='apex-chat-'+role;node.textContent=text;thread.appendChild(node);thread.scrollTop=thread.scrollHeight;}
    function readImage(file){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=reject;reader.readAsDataURL(file);});}
    clear.onclick=function(){if(busy)return;history=[];thread.textContent='';status.textContent='';};
    form.onsubmit=async function(e){e.preventDefault();var value=message.value.trim();if(!value||busy)return;
      var file=attachment.files[0];if(file&&(file.size>1000000||!['image/png','image/jpeg'].includes(file.type))){status.textContent='Choose a PNG or JPEG chart smaller than 1 MB.';return;}
      busy=true;send.disabled=true;clear.disabled=true;status.textContent='Researching the setup…';
      try{
        var image=file?await readImage(file):null;
        append('user',value+(file?' · Chart attached':''));message.value='';attachment.value='';
        var result=await request('POST','/api/session/astra/chat',{message:value,image:image,history:history.slice(-8)});
        append('assistant',result.answer);history.push({role:'user',text:value},{role:'assistant',text:result.answer.slice(0,6000)});history=history.slice(-8);
        status.textContent=result.marketStatus==='RECENT_SNAPSHOT'?'Market snapshot: '+result.observedAt:result.marketStatus==='HISTORICAL_SNAPSHOT'?'Historical snapshot: '+result.observedAt:'No Apex market snapshot available';
      }catch(error){status.textContent='Unable to complete research: '+label(error.message);}
      finally{busy=false;send.disabled=false;clear.disabled=false;}
    };
  }
  window.AstraUI={card:card,bind:bind,chatPage:chatPage,bindChat:bindChat};
})();
