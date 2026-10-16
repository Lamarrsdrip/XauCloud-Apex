// Hand-authored decision-quality fixtures, not historical trades or P&L evidence.
// Rebase clocks at invocation so live model checks cannot pass stale snapshots.
export function strategyFixtures(now=Date.now()) {
  const boundary=Math.floor(now/60000)*60000;
  const bars=[];let price=4378;
  for(let i=0;i<62;i++) {
    const close=price+0.22;
    bars.push({time:boundary-(70-i)*60000,open:price,high:close+0.18,low:price-0.13,close});price=close;
  }
  const sequence=[
    [4391.64,4393.8,4391.5,4393.4],[4393.4,4396.8,4393.2,4395.2],
    [4395.2,4396.5,4392.7,4393],[4393,4394.4,4392.6,4393.9],
    [4393.9,4394.1,4392.3,4392.5],[4392.5,4393.2,4392.2,4392.9],
    [4392.9,4393,4391.9,4392],[4392,4392.1,4391.3,4391.4]
  ];
  sequence.forEach(([open,high,low,close],i)=>bars.push({time:boundary-(8-i)*60000,open,high,low,close}));
  const higher=(seconds)=>Array.from({length:25},(_,i)=>({time:Math.floor(boundary/(seconds*1000))*seconds*1000-(25-i)*seconds*1000,
    open:4380+i*.4,high:4381+i*.4,low:4379.7+i*.4,close:4380.6+i*.4}));
  function base(id) {return {snapshotId:`fixture-${id}-${now}`,observedAtMs:now,symbol:'XAUUSDm',
    quote:{bid:4391.35,ask:4391.55,ageMs:20},account:{balance:1000,equity:1000,freeMargin:1000,marginLevel:0,leverage:200,profile:'NORMAL',floatingProfit:0},
    candles:{m1:structuredClone(bars),m3:higher(180),m5:higher(300)},
    campaign:{id:'',owner:'LIFESTYLE_NATIVE',direction:'NONE',layers:0,l1Price:0,weightedEntry:0,lastAddPrice:0,positions:[],basketProfit:0,mfe:0,mae:0}};}
  function active(id) {const s=base(id);s.campaign={id:'synthetic-campaign',owner:'ASTRA',direction:'SELL',layers:1,
    l1Price:4392.05,weightedEntry:4392.05,lastAddPrice:4392.05,positions:[{ticket:'1',price:4392.05,volume:0.01}],basketProfit:.5,mfe:.7,mae:-.2};return s;}
  const good=base('good-sell'),early=base('too-early'),late=base('too-late'),reclaim=active('reclaim'),add=active('early-add'),second=active('second-proof'),losing=active('losing'),revenge=base('revenge'),laterFail=active('valid-then-fails');
  for(let i=62;i<70;i++) {const p=4392+(i-62)*.4;early.candles.m1[i]={time:bars[i].time,open:p,high:p+.6,low:p-.1,close:p+.4};}
  early.quote={bid:4395.3,ask:4395.5,ageMs:20};
  late.quote={bid:4378,ask:4378.2,ageMs:20};
  reclaim.quote={bid:4398,ask:4398.2,ageMs:20};reclaim.campaign.basketProfit=-6;
  second.campaign.layers=2;second.campaign.lastAddPrice=4391.8;second.campaign.positions.push({ticket:'2',price:4391.8,volume:.01});
  second.quote={bid:4391.15,ask:4391.35,ageMs:20};second.campaign.basketProfit=.9;
  second.recentTicks=[{time:now-4000,bid:4391.5,ask:4391.7},{time:now-3000,bid:4391.9,ask:4392.1},{time:now-1000,bid:4391.15,ask:4391.35}];
  losing.quote={bid:4395,ask:4395.2,ageMs:20};losing.campaign.basketProfit=-3;
  revenge.candles.m1=early.candles.m1;revenge.quote=early.quote;
  // Fresh adverse acceptance through the upper thesis after earlier favorable proof.
  laterFail.quote={bid:4398,ask:4398.2,ageMs:20};laterFail.campaign.mfe=4;laterFail.campaign.basketProfit=-6;
  return [
    {name:'GOOD_SELL',snapshot:good,expected:['ENTER_SELL']},
    {name:'TOO_EARLY',snapshot:early,expected:['WAIT']},
    {name:'TOO_LATE_NO_FRESH_LOCAL_EVENT',snapshot:late,expected:['WAIT']},
    {name:'RECLAIM_ACTIVE_THESIS',snapshot:reclaim,expected:['EXIT'],expectedStates:['INVALID','EXIT']},
    {name:'EARLY_WINNER_ADD',snapshot:add,expected:['ADD']},
    {name:'ANOTHER_SMALL_PROOF',snapshot:second,expected:['ADD']},
    {name:'LOSING_BASKET_NO_RESCUE',snapshot:losing,expected:['HOLD','STOP_ADDING','EXIT']},
    {name:'REVENGE_WITHOUT_NEW_FAILURE',snapshot:revenge,expected:['WAIT']},
    {name:'GOOD_ENTRY_LATER_FAILS',snapshot:laterFail,expected:['EXIT']}
  ];
}
