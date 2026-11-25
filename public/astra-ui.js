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
  var state={identity:null,history:[],busy:false,epoch:0,refresh:null,status:''};
  function resetChat(){state.epoch++;state.identity=null;state.history=[];state.busy=false;state.refresh=null;state.status='';}
  function chatPage(me){
    var id=String((me.license||{}).key||(me.license||{}).account||'session');if(state.identity!==id){resetChat();state.identity=id;}
    var key=!!(me.astra&&me.astra.hasKey);
    return '<section class="apex-ai-chat"><header><div class="apex-ai-mark">✦</div><div class="apex-chat-heading"><h2>Apex AI</h2><p>Gold setup &amp; chart research</p></div><button type="button" id="apex-chat-clear" class="btn btn-ghost">New chat</button></header>'
    +(key?'':'<div class="apex-chat-note">Connect your API key in <a href="#settings">Settings → Astra AI</a> to begin.</div>')
    +'<div class="apex-chat-thread" id="apex-chat-thread" role="log" aria-live="polite"></div><form id="apex-chat-form"><div id="apex-chat-preview" class="apex-chat-file" hidden><img id="apex-chat-thumb" alt="Chart preview"><span id="apex-chat-name"></span><button id="apex-chat-remove" type="button" aria-label="Remove chart">×</button></div><div class="apex-chat-compose"><label class="apex-attach-button" for="apex-chat-image" title="Attach a gold chart">＋</label><input class="apex-file-input" type="file" id="apex-chat-image" accept="image/png,image/jpeg" aria-label="Attach gold chart"><textarea id="apex-chat-message" aria-label="Message Apex AI" placeholder="Ask about a gold setup…" rows="2" maxlength="4000" '+(key?'':'disabled')+'></textarea><button id="apex-chat-send" type="submit" class="btn btn-primary" '+(key?'':'disabled')+'>Send ↑</button></div><div id="apex-chat-status" class="hint" role="status"></div></form></section>';
  }
  function bindChat(me){
    var thread=document.getElementById('apex-chat-thread'),form=document.getElementById('apex-chat-form');if(!thread||!form)return;
    var message=document.getElementById('apex-chat-message'),attachment=document.getElementById('apex-chat-image'),send=document.getElementById('apex-chat-send'),status=document.getElementById('apex-chat-status'),clear=document.getElementById('apex-chat-clear'),preview=document.getElementById('apex-chat-preview'),thumb=document.getElementById('apex-chat-thumb');
    var key=!!(me.astra&&me.astra.hasKey),image=null,selection=0;
    function append(role,text,url){var node=document.createElement('div');node.className='apex-chat-'+role;if(url){var img=document.createElement('img');img.src=url;img.alt='Uploaded gold chart';img.className='apex-chat-chart';node.appendChild(img);}var body=document.createElement('div');body.textContent=text;node.appendChild(body);thread.appendChild(node);}
    function render(){if(!thread.isConnected)return;thread.textContent='';
      if(!state.history.length&&!state.busy){var w=document.createElement('div');w.className='apex-chat-welcome';w.innerHTML='<span class="intel-kicker">REFERENCE PATTERN DESK</span><h3>Find the setup.<br>Understand the move.</h3><p>Research a gold chart, developing rejection or active campaign.</p>';['Recognize a setup on my chart','Explain the latest Apex decision','Compare reversal and continuation'].forEach(function(q){var b=document.createElement('button');b.type='button';b.className='apex-chat-suggestion';b.textContent=q;b.disabled=!key;b.onclick=function(){message.value=q;message.focus();};w.appendChild(b);});thread.appendChild(w);}
      state.history.forEach(function(m){append(m.role,m.text,m.image);});if(state.busy)append('assistant','Researching market evidence…');send.disabled=!key||state.busy;clear.disabled=state.busy;status.textContent=state.status;thread.scrollTop=thread.scrollHeight;}
    state.refresh=render;render();
    function clearImage(){selection++;image=null;attachment.value='';preview.hidden=true;thumb.removeAttribute('src');}
    attachment.onchange=function(){var f=attachment.files[0],n=++selection;image=null;preview.hidden=true;if(!f)return;if(f.size>1000000||!['image/png','image/jpeg'].includes(f.type)){clearImage();status.textContent='Choose a PNG or JPEG under 1 MB.';return;}var r=new FileReader();r.onload=function(){if(n!==selection||!thread.isConnected)return;image=r.result;thumb.src=image;document.getElementById('apex-chat-name').textContent=f.name;preview.hidden=false;};r.onerror=function(){clearImage();status.textContent='Unable to read chart.';};r.readAsDataURL(f);};
    document.getElementById('apex-chat-remove').onclick=clearImage;
    clear.onclick=function(){if(state.busy)return;state.history=[];state.status='';clearImage();render();};
    form.onsubmit=async function(e){e.preventDefault();var value=message.value.trim();if(!value&&image)value='Analyze this gold chart and identify the developing setup.';if(!value||state.busy||!key)return;if(attachment.files[0]&&!image){status.textContent='Chart still loading.';return;}
      var selected=image,history=state.history.slice(-8).map(function(m){return {role:m.role,text:m.text.slice(0,6000)};}),epoch=state.epoch;
      state.busy=true;state.status='';state.history.push({role:'user',text:value,image:selected});message.value='';clearImage();render();
      try{var result=await request('POST','/api/session/astra/chat',{message:value,image:selected,history:history});if(epoch!==state.epoch)return;state.history.push({role:'assistant',text:result.answer});state.status=result.marketStatus==='RECENT_SNAPSHOT'?'Snapshot at request: '+result.observedAt:result.marketStatus==='HISTORICAL_SNAPSHOT'?'Historical snapshot: '+result.observedAt:'Chart and reference research · No recent Apex snapshot';}
      catch(error){if(epoch!==state.epoch)return;state.status='Unable to complete research: '+label(error.message);state.history.pop();if(thread.isConnected)message.value=value;}
      finally{if(epoch===state.epoch){state.busy=false;state.history=state.history.slice(-32);if(state.refresh)state.refresh();}}
    };
  }
  window.AstraUI={card:card,bind:bind,chatPage:chatPage,bindChat:bindChat,resetChat:resetChat};
})();
