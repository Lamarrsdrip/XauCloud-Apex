// Research-only deterministic reference model; does not submit broker orders.
export const clip = equity => equity>=1000?.50:equity>=500?.20:equity>=200?.10:equity>=100?.05:equity>=50?.02:equity>=20?.01:0;
export function validPlan(p,q,now,maxSpread=.35) {
 if(!p||![1,-1].includes(p.side)||![p.ref,p.sl,p.tp1,p.tp2,q.bid,q.ask,p.entryUntil].every(Number.isFinite))return false;
 const {side:s,ref,sl,tp1,tp2}=p, entry=s===1?q.ask:q.bid, exit=s===1?q.bid:q.ask;
 return now<p.entryUntil&&q.bid>0&&q.ask>=q.bid&&q.ask-q.bid<=maxSpread&&
 ref>0&&sl>0&&tp1>0&&tp2>0&&s*(ref-sl)>0&&s*(exit-sl)>0&&s*(tp1-entry)>0&&s*(tp2-tp1)>0&&Math.abs(entry-ref)<=Math.abs(ref-sl)*.25;
}
export function parseWire(s,now,entryWindow=25){
 const a=s.split('|');if(a.length!==9||a[0]!=='APEX4'||!(/^[a-f0-9]{24}$/).test(a[1])||!['BUY','SELL'].includes(a[2]))return null;
 if(a.slice(3).some(x=>!x.trim()||!Number.isFinite(Number(x))))return null;
 const [ref,sl,tp1,tp2,published,expiry]=a.slice(3).map(Number);
 const entryUntil=Math.min(expiry,published+Math.min(90,entryWindow));
 if(published>now+2||now>=entryUntil||expiry>published+90)return null;
 return {id:a[1],side:a[2]==='BUY'?1:-1,ref,sl,tp1,tp2,published,entryUntil};
}
// Each bar is completed; newest first. Do not read a live or future bar.
export function pullback(m,h,q,now){
 if(m.length<16||h.length<8)return null;
 let atr=0;for(let i=0;i<14;i++)atr+=Math.max(m[i].high-m[i].low,Math.abs(m[i].high-m[i+1].close),Math.abs(m[i].low-m[i+1].close));atr/=14;
 if(!(atr>0))return null;
 const impulse=m[3].close-m[9].close,trend=h[1].close-h[7].close;
 let side=0;
 if(impulse>=2*atr&&trend>0&&m[0].close<m[1].low&&m[1].high<m[2].high&&m[0].close>m[9].close+atr*.5)side=-1;
 if(impulse<=-2*atr&&trend<0&&m[0].close>m[1].high&&m[1].low>m[2].low&&m[0].close<m[9].close-atr*.5)side=1;
 if(!side)return null;
 const ref=side===1?q.ask:q.bid,sl=side===1?Math.min(m[1].low,m[2].low)-atr*.2:Math.max(m[1].high,m[2].high)+atr*.2;
 const tp2=ref+side*atr*1.1;
 if(side===-1&&tp2<=m[9].close||side===1&&tp2>=m[9].close)return null;
 const p={id:'P'+m[0].time,side,ref,sl,tp1:ref+side*atr*.55,tp2,published:now,entryUntil:now+15};
 return validPlan(p,q,now)?p:null;
}
// USD gold contract assumptions are explicit inputs. Stress runs are simulated, never live.
export function stressBasket({equity,plan,quotes,contractSize=100,marginPerLot=0,commissionPerLot=0,maxLayers=40,riskPercent=10,stress=false}){
 if(!(equity>0&&contractSize>0&&marginPerLot>=0&&commissionPerLot>=0))throw Error('INVALID_ASSUMPTIONS');
 const volume=clip(equity),fills=[];let balance=equity,stopped='END',realized=0;
 if(!volume)return {fills,stopped:'BELOW_TIER',equity:balance,realized};
 const mark=(q)=>fills.reduce((a,f)=>a+plan.side*((plan.side===1?q.bid:q.ask)-f.price)*contractSize*f.volume,0);
 let last=null,adding=true;
 for(const q of quotes){
  if(![q.bid,q.ask,q.at].every(Number.isFinite)||q.bid<=0||q.ask<q.bid)throw Error('INVALID_QUOTE');
  last=q;
  const exit=plan.side===1?q.bid:q.ask, marked=balance+mark(q);
  if(plan.side*(exit-plan.sl)<=0||plan.side*(exit-plan.tp2)>=0||marked<=0){
   stopped=marked<=0?'EQUITY_EXHAUSTED':plan.side*(exit-plan.sl)<=0?'SL':'TP2';realized=marked-equity;return {fills,stopped,equity:marked,realized};
  }
  if(!adding)continue;
  if(fills.length>=maxLayers){adding=false;stopped='LAYER_CAP';continue;}
  if(!validPlan(plan,q,q.at)){adding=false;stopped='ENTRY_CLOSED';continue;}
  const price=plan.side===1?q.ask:q.bid,margin=(fills.length+1)*volume*marginPerLot,spread=(q.ask-q.bid)*contractSize*volume;
  const risk=fills.reduce((a,f)=>a+Math.max(0,plan.side*(f.price-plan.sl))*contractSize*f.volume,0)+Math.abs(price-plan.sl)*contractSize*volume;
  if(marked<margin+spread+commissionPerLot*volume+Math.max(.5,marked*.02)){adding=false;stopped='MARGIN_OR_COST';continue;}
  if(!stress&&risk>equity*riskPercent/100){adding=false;stopped='RISK_BUDGET';continue;}
  fills.push({price,volume,at:q.at});balance-=commissionPerLot*volume;
 }
 return {fills,stopped,equity:last?balance+mark(last):balance,realized,open:fills.length>0};
}
// Historical hour ranking: requires point-in-time grade and known resolved R and duration.
// Caller supplies only a chronological evaluation split; no default claim about 08–10 WAT.
export function hourStudy(rows){
 const by={};for(const row of rows){
  if(!Number.isFinite(row.r)||!Number.isFinite(row.tp1Seconds)&&row.tp1Seconds!==null)continue;
  const t=Date.parse(row.publishedAt);if(!Number.isFinite(t))continue;
  const hour=new Date(t+3600000).getUTCHours(),key=hour+'|'+row.grade;
  const a=by[key]??={hour,grade:row.grade,n:0,totalR:0,wins:0,tp1Under60:0};
  a.n++;a.totalR+=row.r;a.wins+=Number(row.r>0);a.tp1Under60+=Number(row.tp1Seconds!==null&&row.tp1Seconds>=0&&row.tp1Seconds<=60);
 }
 return Object.values(by).map(a=>({...a,avgR:a.totalR/a.n,winRate:a.wins/a.n,fastTP1Rate:a.tp1Under60/a.n})).sort((a,b)=>b.avgR-a.avgR);
}
