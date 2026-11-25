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
    var html='<section class="card" aria-label="Apex AI settings">'
      +'<div class="release-head"><div><h3 style="margin:0 0 5px">Apex AI</h3>'
      +'<div class="settings-subtle">Optional AI decisions, managed from your Apex account.</div></div>'
      +'<span class="overview-pill '+(connected?'ok':enabled?'':'off')+'">'+esc(state)+'</span></div>';
    if(!editing){
      html+='<div class="settings-subtle" style="margin-top:13px">'+(connected?'Apex AI is connected.':'Apex is using its native trading strategy.')+'</div>';
      return html+'</section>';
    }
    html+='<p class="settings-section-intro" style="margin:18px 0">Astra can help evaluate trade setups. If it is switched off or unavailable, Apex uses its native trading rules. Enabling AI does not guarantee profitable trades.</p>';
    html+='<div class="overview-inline-control" style="margin:0 0 21px"><div>'
      +'<label class="control-title" for="astra-enabled" style="display:block;cursor:pointer">Use Apex AI</label>'
      +'<div class="control-desc">'+(hasKey?'A key is securely saved for this license.':'Connect your OpenAI or Anthropic API key to enable Apex AI.')+'</div>'
      +'</div><label class="switch"><input id="astra-enabled" type="checkbox" aria-label="Enable Apex AI" '+(enabled?'checked':'')+'>'
      +'<span class="track"></span><span class="knob"></span></label></div>';
    html+='<div class="field"><label for="astra-key">Model API key</label>'
      +'<input id="astra-key" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="none" placeholder="'+esc(a.maskedKey||'Paste your API key here')+'">'
      +'<div class="hint">Save a key for each provider separately; choosing a model switches to its saved provider key. Use <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a> or <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Anthropic</a> and enable API billing. Your key is encrypted on Apex and never goes into MT5. Leave this empty to keep an existing key.</div></div>';
    html+='<details class="settings-details" style="margin-bottom:18px"><summary><span>'
      +'<span class="details-name">AI usage & model</span>'
      +'<span class="details-desc" style="display:block">Choose a supported model and control API requests.</span>'
      +'</span></summary><div class="details-content" style="padding-top:21px">'
      +'<div class="field"><label for="astra-model">Model</label><input id="astra-model" list="astra-model-options" value="'+esc(a.model||'gpt-6.2-astra')+'" autocomplete="off" spellcheck="false"><datalist id="astra-model-options"></datalist>'
      +'<div class="hint">Use the exact model ID available to your OpenAI or Anthropic account. A Claude model needs an Anthropic key.</div></div>'
      +'<div class="field"><label for="astra-limit">Daily live-decision request limit</label><input id="astra-limit" type="number" min="10" max="20000" step="10" value="'+esc(a.dailyRequestLimit||2000)+'">'
      +'<div class="hint">Live decision requests are billed by your API provider. Research chat is billed separately and does not consume this live-decision allowance. When reached, native trading takes over until the next UTC day.</div></div>';
    var efforts=['low','medium','high','xhigh','max','none','default'],eff=a.reasoningEffort||'low';
    html+='<div class="field"><label for="astra-effort">Reasoning effort</label><select id="astra-effort">'
      +efforts.map(function(x){return '<option value="'+x+'"'+(x===eff?' selected':'')+'>'+esc(x==='default'?'Model default':x)+'</option>';}).join('')
      +'</select><div class="hint">Higher effort may respond too slowly for live decisions. Apex falls back to native trading when a decision times out.</div></div>'
      +'<div class="field"><label for="astra-research-effort">Research reasoning effort</label><select id="astra-research-effort">'+efforts.map(function(x){return '<option value="'+x+'"'+(x===(a.researchEffort||'high')?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select></div><div class="field"><label for="astra-research-limit">Daily research requests</label><input id="astra-research-limit" type="number" min="0" max="5000" value="'+esc(a.researchDailyLimit??300)+'"></div><label><input id="astra-research-enabled" type="checkbox" '+(a.researchEnabled?'checked':'')+'> Background deep research</label>'
      +'</div></details>';
    html+='<div class="release-actions" style="margin-top:8px">'
      +'<button class="btn btn-primary" id="astra-save" style="width:auto">Save AI settings</button>'
      +'<button class="btn btn-ghost" id="astra-test" style="width:auto" '+(!hasKey?'disabled':'')+'>Test connection</button></div>';
    html+='<details class="settings-details" style="margin-top:18px"><summary><span>'
      +'<span class="details-name">Diagnostics &amp; tests</span>'
      +'<span class="details-desc" style="display:block">Run strategy checks, review diagnostics or remove your saved key.</span>'
      +'</span></summary><div class="details-content" style="padding-top:14px">'
      +row('Last decision',d.action?label(d.action):'No decision yet')
      +row('AI requests today',(a.requestsToday==null?'—':a.requestsToday)+' / '+(a.dailyRequestLimit||'—'))
      +row('Saved providers',(a.availableProviders||[]).join(', ')||'—')+row('Research requests today',a.researchToday??'—')+row('Input / output tokens',a.tokensToday?(a.tokensToday.input+' / '+a.tokensToday.output):'—')+row('Last model latency',a.latencyMs==null?'—':a.latencyMs+' ms')
      +row('Last connection issue',a.lastFallbackReason?label(a.lastFallbackReason):'None reported')
      +'<div class="release-actions" style="margin-top:15px">'
      +'<button class="btn btn-ghost" style="width:auto" id="astra-checks" '+(!hasKey?'disabled':'')+'>Run strategy checks</button><button class="btn btn-ghost" style="width:auto" id="astra-text-test" '+(!hasKey?'disabled':'')+'>Text test</button><button class="btn btn-ghost" style="width:auto" id="astra-vision-test" '+(!hasKey?'disabled':'')+'>Vision test</button>'
      +'<button class="btn btn-danger" style="width:auto" id="astra-remove" '+(!hasKey?'disabled':'')+'>Remove all API keys</button></div>'
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
    var buttons=['astra-save','astra-test','astra-checks','astra-text-test','astra-vision-test','astra-remove'].map(function(id){return document.getElementById(id);});
    async function run(fn){buttons.forEach(function(b){b.disabled=true;});result.textContent='Working…';
      try{await fn();}catch(e){result.textContent=label(e.message);}finally{buttons.forEach(function(b){b.disabled=false;});}}
    save.onclick=function(){run(async function(){
      var input=document.getElementById('astra-key'),patch={enabled:document.getElementById('astra-enabled').checked,model:document.getElementById('astra-model').value.trim(),reasoningEffort:document.getElementById('astra-effort').value,dailyRequestLimit:parseInt(document.getElementById('astra-limit').value,10)};
      patch.researchEnabled=document.getElementById('astra-research-enabled').checked;patch.researchEffort=document.getElementById('astra-research-effort').value;patch.researchDailyLimit=parseInt(document.getElementById('astra-research-limit').value,10);
      if(input.value.trim()){patch.apiKey=input.value.trim();var anthropic=patch.apiKey.startsWith('sk-ant-');if(anthropic!==/^claude-/i.test(patch.model))patch.model=anthropic?'claude-opus-5-5':'gpt-6.2-astra';}
      try{await request('POST','/api/session/astra',patch);}finally{input.value='';delete patch.apiKey;}
      await refresh();
    });};
    document.getElementById('astra-remove').onclick=function(){run(async function(){await request('DELETE','/api/session/astra',{});document.getElementById('astra-key').value='';await refresh();});};
    function test(scope){run(async function(){
      var data=await request('POST','/api/session/astra/test',{scope:scope});
      var lines=(data.results||[]).map(function(r){
        if(r.error)return r.name+': '+label(r.error);
        var t=r.latencyMs!=null?' · '+r.latencyMs+' ms'+(r.withinDecisionBudget===false?' (too slow for live use)':''):'';
        return scope==='connection'?'Model replied '+label(r.action)+' / '+label(r.state)+t:r.name+': '+(r.passed?'PASS':'FAIL'+(r.action?' (got '+label(r.action)+')':''))+t;});
      result.textContent=label(data.status)+' · '+lines.join(' · ');
    });}
    document.getElementById('astra-test').onclick=function(){test('connection');};
    document.getElementById('astra-checks').onclick=function(){test('strategy');};
    document.getElementById('astra-text-test').onclick=function(){test('text');};
    document.getElementById('astra-vision-test').onclick=function(){test('vision');};
    request('GET','/api/session/astra/models').then(function(d){var list=document.getElementById('astra-model-options');if(!list)return;(d.models||[]).filter(function(m){return !m.legacy;}).forEach(function(m){var o=document.createElement('option');o.value=m.id;o.label=m.label+' · '+m.provider;list.appendChild(o);});}).catch(function(){});
  }
  var state={identity:null,history:[],busy:false,epoch:0,refresh:null,status:'',conversationId:null,workspace:'chat',episode:null,loaded:false,stream:''};
  function resetChat(){state.epoch++;state.identity=null;state.history=[];state.busy=false;state.refresh=null;state.status='';state.conversationId=null;state.workspace='chat';state.episode=null;state.benchmarkId=null;state.loaded=false;state.stream='';}
  function chatPage(me,workspace){
    var id=String((me.license||{}).key||(me.license||{}).account||'session');if(state.identity!==id){resetChat();state.identity=id;}
    if(workspace)state.workspace=workspace;
    var key=!!(me.astra&&me.astra.hasKey);
    if(state.workspace==='lab')return labPage(me);
    return '<section class="apex-ai-chat"><header><div class="apex-ai-mark">✦</div><div class="apex-chat-heading"><h2>Apex AI</h2><p>Gold setup &amp; chart research</p></div><button type="button" id="apex-lab-open" class="btn btn-ghost">Research Lab</button><button type="button" id="apex-chat-clear" class="btn btn-ghost">New chat</button></header><div class="apex-chat-tools"><label for="apex-conversations">Conversations</label><select id="apex-conversations"><option value="">New chat</option></select><button id="apex-chat-rename" class="btn btn-ghost" type="button">Rename</button><button id="apex-chat-delete" class="btn btn-ghost" type="button">Delete</button></div>'
    +(key?'':'<div class="apex-chat-note">Connect your API key in <a href="#settings-ai">AI connection</a> to begin.</div>')
    +'<div class="apex-chat-thread" id="apex-chat-thread" role="log" aria-live="polite"></div><form id="apex-chat-form"><div id="apex-chat-preview" class="apex-chat-file" hidden><img id="apex-chat-thumb" alt="Chart preview"><span id="apex-chat-name"></span><button id="apex-chat-remove" type="button" aria-label="Remove chart">×</button></div><div class="apex-chat-compose"><label class="apex-attach-button" for="apex-chat-image" title="Attach a gold chart">＋</label><input class="apex-file-input" type="file" id="apex-chat-image" accept="image/png,image/jpeg" aria-label="Attach gold chart"><textarea id="apex-chat-message" aria-label="Message Apex AI" placeholder="Ask about a gold setup…" rows="2" maxlength="4000" '+(key?'':'disabled')+'></textarea><button id="apex-chat-send" type="submit" class="btn btn-primary" '+(key?'':'disabled')+'>Send ↑</button></div><div id="apex-chat-status" class="hint" role="status"></div></form></section>';
  }
  function bindChat(me){
    if(state.workspace==='lab'){bindLab(me);return;}
    var thread=document.getElementById('apex-chat-thread'),form=document.getElementById('apex-chat-form');if(!thread||!form)return;
    var message=document.getElementById('apex-chat-message'),attachment=document.getElementById('apex-chat-image'),send=document.getElementById('apex-chat-send'),status=document.getElementById('apex-chat-status'),clear=document.getElementById('apex-chat-clear'),preview=document.getElementById('apex-chat-preview'),thumb=document.getElementById('apex-chat-thumb');
    var key=!!(me.astra&&me.astra.hasKey),image=null,selection=0;
    function append(role,text,url){var node=document.createElement('div');node.className='apex-chat-'+role;if(url){var img=document.createElement('img');img.src=url;img.alt='Uploaded gold chart';img.className='apex-chat-chart';node.appendChild(img);}var body=document.createElement('div');if(role==='assistant'){body.innerHTML=esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');}else body.textContent=text;node.appendChild(body);if(role==='assistant'&&text!=='Researching market evidence…'){var copy=document.createElement('button');copy.type='button';copy.className='apex-copy';copy.textContent='Copy';copy.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(text).then(function(){copy.textContent='Copied';}).catch(function(){copy.textContent='Copy unavailable';});};node.appendChild(copy);}thread.appendChild(node);}
    function render(){if(!thread.isConnected)return;thread.textContent='';
      if(!state.history.length&&!state.busy){var w=document.createElement('div');w.className='apex-chat-welcome';w.innerHTML='<span class="intel-kicker">REFERENCE PATTERN DESK</span><h3>Find the setup.<br>Understand the move.</h3><p>Research a gold chart, developing rejection or active campaign.</p>';['Recognize a setup on my chart','Explain the latest Apex decision','Compare reversal and continuation'].forEach(function(q){var b=document.createElement('button');b.type='button';b.className='apex-chat-suggestion';b.textContent=q;b.disabled=!key;b.onclick=function(){message.value=q;message.focus();};w.appendChild(b);});thread.appendChild(w);}
      state.history.forEach(function(m){append(m.role,m.text,m.image);});if(state.busy)append('assistant',state.stream||'Researching market evidence…');send.disabled=!key||state.busy;clear.disabled=state.busy;status.textContent=state.status;thread.scrollTop=thread.scrollHeight;}
    state.refresh=render;render();
    var conversations=document.getElementById('apex-conversations');
    async function listChats(){try{var d=await request('GET','/api/session/astra/conversations');if(!conversations.isConnected)return;conversations.innerHTML='<option value="">New chat</option>';(d.conversations||[]).forEach(function(c){var o=document.createElement('option');o.value=c.id;o.textContent=c.title;conversations.appendChild(o);});conversations.value=state.conversationId||'';}catch(e){state.status='Conversation history unavailable';render();}}
    conversations.onchange=async function(){if(state.busy){conversations.value=state.conversationId||'';return;}var id=conversations.value;try{var c=id?await request('GET','/api/session/astra/conversations/'+encodeURIComponent(id)):null;if(!thread.isConnected)return;state.conversationId=id||null;state.history=c?(c.messages||[]).map(function(m){return {role:m.role,text:m.text};}):[];state.status='';render();}catch(e){state.status=label(e.message);render();}};
    document.getElementById('apex-chat-delete').onclick=async function(){if(state.busy||!state.conversationId||!confirm('Delete this conversation?'))return;try{await request('DELETE','/api/session/astra/conversations/'+state.conversationId,{});state.conversationId=null;state.history=[];await listChats();render();}catch(e){state.status=label(e.message);render();}};
    document.getElementById('apex-chat-rename').onclick=async function(){if(state.busy||!state.conversationId)return;var name=prompt('Conversation name');if(!name||!name.trim())return;try{await request('PATCH','/api/session/astra/conversations/'+state.conversationId,{title:name.trim()});await listChats();}catch(e){state.status=label(e.message);render();}};
    document.getElementById('apex-lab-open').onclick=function(){if(state.busy)return;location.hash='#lab';};listChats();
    function clearImage(){selection++;image=null;attachment.value='';preview.hidden=true;thumb.removeAttribute('src');}
    attachment.onchange=function(){var f=attachment.files[0],n=++selection;image=null;preview.hidden=true;if(!f)return;if(f.size>1000000||!['image/png','image/jpeg'].includes(f.type)){clearImage();status.textContent='Choose a PNG or JPEG under 1 MB.';return;}var r=new FileReader();r.onload=function(){if(n!==selection||!thread.isConnected)return;image=r.result;thumb.src=image;document.getElementById('apex-chat-name').textContent=f.name;preview.hidden=false;};r.onerror=function(){clearImage();status.textContent='Unable to read chart.';};r.readAsDataURL(f);};
    document.getElementById('apex-chat-remove').onclick=clearImage;
    clear.onclick=function(){if(state.busy)return;state.history=[];state.conversationId=null;state.status='';conversations.value='';clearImage();render();};
    form.onsubmit=async function(e){e.preventDefault();var value=message.value.trim();if(!value&&image)value='Analyze this gold chart and identify the developing setup.';if(!value||state.busy||!key)return;if(attachment.files[0]&&!image){status.textContent='Chart still loading.';return;}
      var selected=image,history=state.history.slice(-24).map(function(m){return {role:m.role,text:m.text.slice(0,6000)};}),epoch=state.epoch;
      state.busy=true;state.stream='';state.status='';state.history.push({role:'user',text:value,image:selected});message.value='';clearImage();render();
      try{var result=await streamChat({message:value,image:selected,history:history,conversationId:state.conversationId},function(delta){if(epoch!==state.epoch)return;state.stream+=delta;if(state.refresh)state.refresh();});if(epoch!==state.epoch)return;state.conversationId=result.conversationId||null;state.stream='';listChats();state.history.push({role:'assistant',text:result.answer});state.status=result.marketStatus==='RECENT_SNAPSHOT'?'Snapshot at request: '+result.observedAt:result.marketStatus==='HISTORICAL_SNAPSHOT'?'Historical snapshot: '+result.observedAt:'Chart and reference research · No recent Apex snapshot';}
      catch(error){if(epoch!==state.epoch)return;state.status='Unable to complete research: '+label(error.message);state.history.pop();if(thread.isConnected)message.value=value;}
      finally{if(epoch===state.epoch){state.busy=false;state.stream='';state.history=state.history.slice(-200);if(state.refresh)state.refresh();}}
    };
  }
  async function streamChat(payload,onDelta){
    var r=await fetch('/api/session/astra/chat',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify(payload)});
    if(!r.ok){var e=await r.json();throw new Error(e.error||'CHAT_FAILED');}
    if(!String(r.headers.get('content-type')).includes('text/event-stream'))return r.json();
    var reader=r.body.getReader(),decoder=new TextDecoder(),buf='',result=null;
    try{while(true){var chunk=await reader.read();if(chunk.done)break;buf+=decoder.decode(chunk.value,{stream:true});var i;while((i=buf.indexOf('\n\n'))>=0){var frame=buf.slice(0,i);buf=buf.slice(i+2);var event=frame.split('\n').find(function(x){return x.startsWith('event: ');}),data=frame.split('\n').find(function(x){return x.startsWith('data: ');});if(!event||!data)continue;var d=JSON.parse(data.slice(6));if(event==='event: delta')onDelta(d.delta);else if(event==='event: done')result=d;else if(event==='event: error')throw new Error(d.error||'CHAT_FAILED');}}}finally{reader.releaseLock();}
    if(!result)throw new Error('CHAT_STREAM_INTERRUPTED');return result;
  }
  function labPage(me){
    return '<section class="apex-lab"><div class="intel-heading"><div><span class="intel-kicker">HISTORICAL / BLIND REPLAY</span><h2>Strategy Research Lab</h2></div><button id="lab-back" class="btn btn-ghost">Back to AI</button></div><p class="settings-subtle">Price and date are masked until reveal. Compare decisions on the same historical prefix; no live orders.</p><div class="lab-controls"><label>Dataset <select id="lab-split"><option value="VALIDATION">Validation · 2025</option><option value="HELD_OUT">Held-out · 2026</option></select></label><label>Sampling <select id="lab-mode"><option value="setup">Developing setups</option><option value="random">Random windows</option></select></label><button id="lab-new" class="btn btn-primary">New episode</button></div><div id="lab-content"></div><details class="settings-details lab-benchmark"><summary>Benchmark on identical blind windows</summary><div class="lab-controls"><label>Episodes <input id="lab-n" type="number" min="1" max="100" value="10"></label><label><input type="checkbox" id="lab-model"> Include configured AI</label><label>Compare saved-provider models <select id="lab-models" multiple aria-label="Models to benchmark"></select></label><button id="lab-benchmark" class="btn btn-ghost">Run benchmark</button></div><div id="lab-benchmark-results" role="status"></div></details><div id="lab-status" class="settings-subtle" role="status" aria-live="polite"></div></section>';
  }
  function bindLab(me){
    var root=document.getElementById('lab-content'),status=document.getElementById('lab-status'),busy=false;
    document.getElementById('lab-back').onclick=function(){if(busy)return;location.hash='#ai';};
    function draw(canvas,bars,cut){
      var w=canvas.width=900,h=canvas.height=330,ctx=canvas.getContext('2d'),hi=Math.max.apply(null,bars.map(function(b){return b.h;})),lo=Math.min.apply(null,bars.map(function(b){return b.l;})),pad=(hi-lo)*.08||1,y=function(v){return 10+(hi+pad-v)/(hi-lo+2*pad)*(h-30);},step=(w-75)/bars.length;
      ctx.fillStyle='#101720';ctx.fillRect(0,0,w,h);ctx.font='12px system-ui';ctx.strokeStyle='#293442';ctx.fillStyle='#a8b2bf';for(var j=0;j<5;j++){var p=hi-(hi-lo)*j/4;ctx.beginPath();ctx.moveTo(0,y(p));ctx.lineTo(w-65,y(p));ctx.stroke();ctx.fillText(p.toFixed(2),w-61,y(p)+4);}
      bars.forEach(function(b,i){var x=4+i*step+step/2;ctx.fillStyle=ctx.strokeStyle=b.c>=b.o?'#35c792':'#ef7181';ctx.beginPath();ctx.moveTo(x,y(b.h));ctx.lineTo(x,y(b.l));ctx.stroke();ctx.fillRect(x-Math.max(1,step*.3),Math.min(y(b.o),y(b.c)),Math.max(1,step*.6),Math.max(1,Math.abs(y(b.o)-y(b.c))));});
      if(cut){ctx.strokeStyle='#d8b477';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(4+cut*step,0);ctx.lineTo(4+cut*step,h);ctx.stroke();ctx.setLineDash([]);}
    }
    function render(){
      if(!root.isConnected)return;var e=state.episode;
      if(!e){root.innerHTML='<div class="lab-empty">Create a blind episode to begin. The chart will contain only closed historical candles available before the decision.</div>';return;}
      var sealed=e.predictions||[],sources=sealed.map(function(p){return p.source;});
      root.innerHTML='<div class="lab-chart"><div class="lab-chart-head"><strong>XAUUSD · M1 · masked prices</strong><span>'+esc(e.revealed?'Revealed':'Future hidden')+'</span></div><canvas id="lab-chart" aria-label="Historical candlestick chart"></canvas><div class="settings-subtle">Bid '+e.quote.bid.toFixed(2)+' · Ask '+e.quote.ask.toFixed(2)+' · M3 ATR '+e.atr.toFixed(2)+'</div></div>'
        +'<div class="lab-controls">'+['ENGINE','NATIVE','MODEL'].map(function(s){return '<button class="btn btn-ghost lab-predict" data-source="'+s+'" '+(e.revealed||sources.includes(s)||(s==='MODEL'&&!(me.astra&&me.astra.hasKey))?'disabled':'')+'>'+({ENGINE:'Pattern engine',NATIVE:'Native bot',MODEL:'Apex AI · uses API'})[s]+'</button>';}).join('')+'<button id="lab-reveal" class="btn btn-primary" '+(e.revealed||!sealed.length?'disabled':'')+'>Reveal outcome</button></div>'
        +sealed.map(function(p){var a=p.prediction;return '<article class="lab-pred"><strong>'+esc(p.source)+' · '+esc(a.direction)+' · '+esc(a.stage)+'</strong><p>'+esc(a.reasoning)+'</p><div class="settings-subtle">Entry: '+esc(a.entryCondition)+' · Invalidation '+esc(a.invalidationPrice)+' · Target '+esc(a.targetPrice)+' · '+esc(a.confidence)+'% (uncalibrated)</div><small>Sealed '+esc(p.hash.slice(0,12))+'</small></article>';}).join('')
        +(e.revealed?'<h3>Outcome</h3><p class="settings-subtle">Archive cutoff '+esc(e.archiveCutoff)+' · 1 ATR first-touch scoring, spread approximation; same-bar ambiguity adverse.</p>'+e.scores.map(function(s){return '<article class="lab-pred"><strong>'+esc(s.source)+' · '+esc(label(s.result))+'</strong><div>MFE '+esc(s.mfePts==null?'—':s.mfePts.toFixed(2))+' · MAE '+esc(s.maePts==null?'—':s.maePts.toFixed(2))+'</div></article>';}).join(''):'');
      draw(document.getElementById('lab-chart'),e.prefix.concat(e.future||[]),e.revealed?180:0);
      root.querySelectorAll('.lab-predict').forEach(function(b){b.onclick=function(){run(function(){return request('POST','/api/session/lab/'+e.id+'/predict',{source:b.dataset.source});});};});
      document.getElementById('lab-reveal').onclick=function(){run(function(){return request('POST','/api/session/lab/'+e.id+'/reveal',{});});};
    }
    async function run(fn){if(busy)return;busy=true;status.textContent='Working…';root.setAttribute('aria-busy','true');try{state.episode=await fn();status.textContent='';render();}catch(e){status.textContent=label(e.message);}finally{busy=false;root.removeAttribute('aria-busy');}}
    document.getElementById('lab-new').onclick=function(){run(function(){return request('POST','/api/session/lab/new',{split:document.getElementById('lab-split').value,mode:document.getElementById('lab-mode').value});});};
    var bench=document.getElementById('lab-benchmark-results'),benchButton=document.getElementById('lab-benchmark'),modelSelect=document.getElementById('lab-models');
    request('GET','/api/session/astra/models').then(function(d){if(!modelSelect.isConnected)return;var providers=(me.astra&&me.astra.availableProviders)||[];(d.models||[]).filter(function(m){return !m.legacy&&providers.includes(m.provider);}).forEach(function(m){var o=document.createElement('option');o.value=m.id;o.textContent=m.label+' · '+m.provider;modelSelect.appendChild(o);});}).catch(function(){});

    function showBenchmark(j){
      if(!bench.isConnected)return;
      bench.innerHTML='<p class="settings-subtle">'+esc(j.status)+' · '+j.completed+' / '+j.n+' episodes'+(j.errors.length?' · '+j.errors.length+' provider failures':'')+'</p>'+Object.keys(j.results||{}).map(function(k){var x=j.results[k];return '<article class="lab-pred"><strong>'+esc(k)+'</strong><div>Entries '+x.entered+' · Abstentions '+x.abstained+' · Resolved win rate '+(x.winRateResolved==null?'—':(x.winRateResolved*100).toFixed(1)+'%')+'</div><div class="settings-subtle">Coverage '+(x.coverage*100).toFixed(0)+'% · MFE '+(x.avgMfeAtr==null?'—':x.avgMfeAtr.toFixed(2))+' ATR · MAE '+(x.avgMaeAtr==null?'—':x.avgMaeAtr.toFixed(2))+' ATR</div></article>';}).join('');
    }
    async function pollBenchmark(id){if(!bench.isConnected)return;try{var j=await request('GET','/api/session/lab/benchmark/'+id);showBenchmark(j);if(j.status==='RUNNING')setTimeout(function(){pollBenchmark(id);},3500);else benchButton.disabled=false;}catch(e){bench.textContent=label(e.message);benchButton.disabled=false;}}
    benchButton.onclick=async function(){if(benchButton.disabled)return;var model=document.getElementById('lab-model').checked,n=Number(document.getElementById('lab-n').value),models=Array.from(modelSelect.selectedOptions).map(function(o){return o.value;}),paid=n*(models.length||(model?1:0));if(paid&&!confirm('This benchmark may make up to '+paid+' paid model requests using your keys. Continue?'))return;benchButton.disabled=true;try{var j=await request('POST','/api/session/lab/benchmark',{n:n,includeModel:model,models:models,split:document.getElementById('lab-split').value,mode:document.getElementById('lab-mode').value});state.benchmarkId=j.id;showBenchmark(j);pollBenchmark(j.id);}catch(e){bench.textContent=label(e.message);benchButton.disabled=false;}};
    if(state.benchmarkId){benchButton.disabled=true;pollBenchmark(state.benchmarkId);}render();
  }
  window.AstraUI={card:card,bind:bind,chatPage:chatPage,bindChat:bindChat,resetChat:resetChat};
})();
