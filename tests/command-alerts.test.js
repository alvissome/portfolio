import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateMarketContext,marketContextFresh,marketText,renderMarketCallout,sma,ema} from '../assets/market-context.js';
import {alertUniverse,evaluateTicker,evaluateMarket,levelKey} from '../.github/scripts/command-alerts.mjs';
import {parseAlertQuote,parseNews,fetchAlertNews,fetchSPX} from '../.github/scripts/alert-data.mjs';
import {renderAlertEmail} from '../.github/scripts/alert-email.mjs';
import {deliveryDecision,sendAlertEmail,SAFE_RETRY_MS} from '../.github/scripts/alert-delivery.mjs';
import {validateAlertEnvironment,eventIdentity,alertRunMode,outstandingDelivery,singaporeDigestDay} from '../.github/scripts/runCommandAlerts.mjs';
const now=Date.parse('2026-11-17T10:00:00Z');
const bars=values=>values.map((close,i)=>({date:new Date(Date.parse('2026-11-16')-(values.length-1-i)*86400000).toISOString().slice(0,10),close}));
const context=()=>calculateMarketContext(bars(Array.from({length:400},(_,i)=>100+i)),{checkedAt:new Date(now).toISOString()});
const item={symbol:'EXAMPLE',currency:'USD',levels:[{key:'s1',price:100},{key:'s2',price:90},{key:'s3',price:80}]};
const quote=(price,extra={})=>({symbol:'EXAMPLE',currency:'USD',price,previousClose:price,date:'2026-11-16',time:Date.parse('2026-11-16T21:00:00Z'),session:'regular-session close',...extra});
test('daily moving averages use seeded EMA and the expected SMA window',()=>{
  assert.deepEqual(sma([1,2,3,4],3),[null,null,2,3]);
  assert.deepEqual(ema([1,2,3,4],3),[null,null,2,3]);
});
test('SPX requires completed daily history and uses a labelled 52-week closing peak',()=>{
  const c=context();assert.equal(c.symbol,'^GSPC');assert.equal(c.medium,'bullish');assert.equal(c.short,'bullish');assert.equal(c.long,'bullish');assert.equal(c.drawdownPct,0);
  assert.equal(c.peak.lookback,'52-week closing peak');
  const points=bars(Array.from({length:400},(_,i)=>i===0?10000:i===390?500:400));
  const d=calculateMarketContext(points,{checkedAt:new Date(now).toISOString()});assert.equal(d.peak.price,500);assert.ok(Math.abs(d.drawdownPct-20)<1e-10);
  assert.throws(()=>calculateMarketContext(points.slice(0,200)),/INCOMPLETE/);
  assert.throws(()=>calculateMarketContext([...points].reverse()),/INCOMPLETE/);
});
test('alignment without both rising slopes stays pending; later confirmation alerts without a new crossing',()=>{
  const values=[...Array.from({length:260},(_,i)=>250-i*.25),...Array.from({length:180},(_,i)=>185+i*.5)];
  const points=bars(values);let pending,confirmed;
  for(let i=260;i<=points.length;i++){
    const c=calculateMarketContext(points.slice(0,i),{checkedAt:new Date(now).toISOString()});
    if(c.medium==='bullish_pending')pending=c;
    if(pending&&c.medium==='bullish'){confirmed=c;break;}
  }
  assert.ok(pending);assert.ok(confirmed);assert.ok(pending.average.sma50>pending.average.sma150);assert.ok(confirmed.average.sma50>confirmed.average.sma150);
  // Use evaluation time consistent with each completed historical example.
  pending.checkedAt=pending.date+'T23:00:00Z';confirmed.checkedAt=confirmed.date+'T23:00:00Z';
  const prior=evaluateMarket(pending,{},Date.parse(pending.checkedAt));
  assert.equal(prior.events.length,0);
  const next=evaluateMarket(confirmed,prior.state,Date.parse(confirmed.checkedAt));assert.equal(next.events.length,1);
  assert.equal(evaluateMarket(confirmed,next.state,Date.parse(confirmed.checkedAt)).events.length,0);
});
test('stale, malformed or future SPX data is visibly unavailable',()=>{
  const c=context();assert.ok(marketContextFresh(c,now));assert.ok(!marketContextFresh(c,now+6*86400000));assert.ok(!marketContextFresh({...c,slopes:null},now));
  assert.equal(marketText({...c,checkedAt:new Date(now+3600000).toISOString()},now),'SPX context unavailable or stale');
  assert.match(renderMarketCallout(null,{now}),/unavailable or stale/);
});
test('active CC holdings, Watchlist and saved decisions share one deduplicated universe and override resolution',()=>{
  const data={holdings:{cash:{ticker:'EXAMPLE',currency:'USD',accountType:'Cash'},retirement:{ticker:'RETIRE',currency:'SGD',accountType:'SRS'}},watchlist:[{symbol:'EXAMPLE',priceCurrency:'USD',s1:'100'},{symbol:'OTHER',priceCurrency:'SGD',s1:'10'}]};
  const strategy={plans:{EXAMPLE:{action:'buy',researchOverrides:{s1:'99'}},ARCHIVED:{symbol:'ARCHIVED',researchOverrides:{s1:'50'}}}};
  const universe=alertUniverse(data,strategy);assert.deepEqual(universe.map(r=>r.symbol),['EXAMPLE','OTHER']);assert.equal(universe[0].levels[0].price,99);assert.equal(universe[0].held,true);assert.equal(universe[0].watchlisted,false);assert.equal(universe[1].levels[0].price,10);assert.deepEqual(alertUniverse(data,{plans:{}})[0].levels,[]);
  assert.deepEqual(alertUniverse({...data,holdings:{},classifications:{EXAMPLE:{accountType:'Cash',currency:'USD'}},watchlist:[]},strategy).map(r=>r.symbol),['EXAMPLE']);
});
test('approaching nearest support sends once and recovery does not re-arm it',()=>{
  let result=evaluateTicker(item,quote(110),{},now);assert.equal(result.events.length,0);
  result=evaluateTicker(item,quote(104),result.state,now);assert.equal(result.events.length,1);assert.equal(result.events[0].type,'support_approach');
  result=evaluateTicker(item,quote(110),result.state,now);result=evaluateTicker(item,quote(103),result.state,now);assert.equal(result.events.length,0);
});
test('first-run breached levels baseline quietly; lower levels stay eligible',()=>{
  let result=evaluateTicker(item,quote(95),{},now);assert.equal(result.events.length,0);assert.equal(result.state.levels[levelKey('USD',100)].baseline,true);
  result=evaluateTicker(item,quote(89),result.state,now);assert.equal(result.events.length,1);assert.deepEqual(result.events[0].levels,[{key:'s2',price:90}]);
});
test('a gap through several levels produces one hit event and consumes their approaching notices',()=>{
  let result=evaluateTicker(item,quote(110),{},now);result=evaluateTicker(item,quote(89),result.state,now);
  assert.deepEqual(result.events.map(e=>e.type),['support_hit']);assert.deepEqual(result.events[0].levels.map(l=>l.price),[100,90]);
  assert.ok(result.state.levels[levelKey('USD',100)].approach);assert.ok(result.state.levels[levelKey('USD',90)].hit);
  assert.equal(evaluateTicker(item,quote(89),result.state,now).events.length,0);
});
test('once-only support identity follows currency and price, not a reordered rung label',()=>{
  const first=evaluateTicker(item,quote(104),{},now);assert.equal(first.events[0].type,'support_approach');
  assert.equal(evaluateTicker({...item,levels:[{key:'s2',price:100}]},quote(104),first.state,now).events.length,0);
  const changed=evaluateTicker({...item,levels:[{key:'s1',price:103}]},quote(104),first.state,now);assert.equal(changed.events[0].levels[0].price,103);
});
test('daily drops alert once per tier and exchange day, including escalation after recovery',()=>{
  let result=evaluateTicker({...item,levels:[]},quote(96,{previousClose:100}),{},now);assert.equal(result.events[0].tier,3);
  result=evaluateTicker({...item,levels:[]},quote(94,{previousClose:100}),result.state,now);assert.equal(result.events[0].tier,5);
  result=evaluateTicker({...item,levels:[]},quote(99,{previousClose:100}),result.state,now);result=evaluateTicker({...item,levels:[]},quote(94,{previousClose:100}),result.state,now);assert.equal(result.events.length,0);
  result=evaluateTicker({...item,levels:[]},quote(94,{previousClose:100,date:'2026-11-17',time:now}),result.state,now);assert.equal(result.events[0].tier,5);
  assert.equal(evaluateTicker({...item,levels:[]},quote(97,{previousClose:100}),{},now).events.length,0);
  assert.equal(evaluateTicker({...item,levels:[]},quote(95,{previousClose:100}),{},now).events[0].tier,3);
});
test('a first observation beyond 5% emits the largest daily tier only',()=>{
  assert.deepEqual(evaluateTicker({...item,levels:[]},quote(94,{previousClose:100}),{},now).events.map(e=>e.tier),[5]);
});
test('wrong currency and stale quotes never consume an event',()=>{
  const state=evaluateTicker(item,quote(110),{},now).state;
  for(const q of [quote(99,{currency:'HKD'}),quote(99,{time:now-5*86400000}),quote(99,{time:now+3600000})]){const r=evaluateTicker(item,q,state,now);assert.equal(r.events.length,0);assert.deepEqual(r.state,state);}
});
test('a split blocks the old support ladder until it is reviewed, with daily drops resuming on later sessions',()=>{
  let r=evaluateTicker(item,quote(110),{},now);r=evaluateTicker(item,quote(55,{splitDate:'2026-11-16',previousClose:110}),r.state,now);assert.equal(r.events.length,0);assert.ok(r.skipped);
  r=evaluateTicker(item,quote(54,{previousClose:55,date:'2026-11-17',time:now}),r.state,now);assert.equal(r.events.length,0);assert.ok(r.skipped);
  r=evaluateTicker({...item,levels:[{key:'s1',price:50}]},quote(54,{previousClose:55,date:'2026-11-17',time:now}),r.state,now);assert.equal(r.skipped,null);
});
function payload(){
  return {chart:{result:[{meta:{symbol:'EXAMPLE',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:Date.parse('2026-11-16T18:00:00Z')/1000,regularMarketPrice:95,currentTradingPeriod:{regular:{start:Date.parse('2026-11-16T14:30:00Z')/1000,end:Date.parse('2026-11-16T21:00:00Z')/1000}}},timestamp:['2026-11-13T14:30:00Z','2026-11-16T14:30:00Z'].map(d=>Date.parse(d)/1000),indicators:{quote:[{open:[100,99],high:[102,100],low:[99,94],close:[100,95]}]}}]}};
}
test('intraday decline uses previous completed trading close and regular-session quote, not range-start close',()=>{
  const p=payload();p.chart.result[0].meta.chartPreviousClose=500;
  const q=parseAlertQuote(p,'EXAMPLE',{now:new Date('2026-11-16T18:05:00Z')});assert.equal(q.previousClose,100);assert.equal(q.price,95);assert.equal(q.session,'regular session');assert.equal(q.date,'2026-11-16');
  p.chart.result[0].meta.currency='USD';assert.throws(()=>parseAlertQuote(p,'OTHER',{now:new Date(now)}),/IDENTITY/);
});
test('SPX fetch uses actual index, validates instrument identity, and excludes an unfinished daily bar',async()=>{
  let url;await assert.rejects(fetchSPX({now:new Date(now),fetch:async input=>{url=input;return {ok:true,json:async()=>payload()};}}),/IDENTITY/);assert.match(url,/%5EGSPC/);assert.ok(!url.includes('SPY'));
  const points=bars(Array.from({length:400},(_,i)=>5000+i));
  const p={chart:{result:[{meta:{symbol:'^GSPC',currency:'USD',instrumentType:'INDEX',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',currentTradingPeriod:{regular:{start:Date.parse('2026-11-17T14:30:00Z')/1000,end:Date.parse('2026-11-17T21:00:00Z')/1000}}},timestamp:[...points.map(b=>Date.parse(b.date+'T14:30:00Z')/1000),Date.parse('2026-11-17T14:30:00Z')/1000],indicators:{quote:[Object.fromEntries(['open','high','low','close'].map(k=>[k,[...points.map(b=>b.close),9999]]))]}}]}};
  const c=await fetchSPX({now:new Date('2026-11-17T15:00:00Z'),fetch:async()=>({ok:true,json:async()=>p})});assert.equal(c.date,'2026-11-16');assert.equal(c.close,5399);assert.equal(c.peak.price,5399);
});
test('news parser admits recent safe links, preserves timestamps, deduplicates and rejects future/old items',()=>{
  const entry=(title,url,date)=>`<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const xml='<rss><channel>'+entry('Example &amp; results','https://example.com/a','Tue, 17 Nov 2026 08:00:00 GMT')+entry('Duplicate','https://example.com/a','Tue, 17 Nov 2026 08:00:00 GMT')+entry('Unsafe','javascript:alert(1)','Tue, 17 Nov 2026 08:00:00 GMT')+entry('Future','https://example.com/future','Wed, 18 Nov 2026 08:00:00 GMT')+entry('Old','https://example.com/old','Thu, 12 Nov 2026 08:00:00 GMT')+'</channel></rss>';
  const items=parseNews(xml,{now:new Date(now)});assert.equal(items.length,1);assert.equal(items[0].title,'Example & results');
  assert.throws(()=>parseNews('<html>sign in</html>'),/UNAVAILABLE/);
});
test('news outage leaves the price alert usable and makes no causal claim',async()=>{
  const news=await fetchAlertNews('EXAMPLE',{fetch:async()=>{throw Error('private provider details');}});assert.deepEqual(news.items,[]);assert.match(news.status,/unavailable; no cause confirmed/);
});
test('HTML email has a real template, SPX context, accessible structure, timestamps and fallback text',()=>{
  const email=renderAlertEmail({createdAt:new Date(now).toISOString(),context:context(),events:[{type:'support_hit',symbol:'<EXAMPLE>',currency:'USD',quote:quote(99),levels:[{key:'s1',price:100}]}]});
  assert.match(email.html,/role="presentation"/);assert.match(email.html,/lang="en"/);assert.match(email.html,/<h1/);assert.match(email.html,/52-week closing peak/);assert.match(email.html,/&lt;EXAMPLE&gt;/);assert.doesNotMatch(email.html,/<EXAMPLE>/);assert.match(email.text,/Open command centre/);assert.ok(Buffer.byteLength(email.html)<95000);
  assert.match(renderAlertEmail({createdAt:new Date(now).toISOString(),context:null,events:[{type:'daily_drop',symbol:'EXAMPLE',currency:'USD',tier:5,dropPct:-6,quote:quote(94)}]}).html,/SPX context unavailable or stale/);
});
test('retry cutoff prevents duplicate risk outside Resend idempotency retention',()=>{
  const record={status:'retry',createdAt:new Date(now).toISOString(),firstAttemptAt:now-10000,attempts:1};assert.equal(deliveryDecision(record,now),'send');assert.equal(deliveryDecision({...record,firstAttemptAt:now-SAFE_RETRY_MS},now),'review');assert.equal(deliveryDecision({...record,status:'accepted'},now),'skip');assert.equal(deliveryDecision({...record,status:'sending',leaseUntil:now+1000},now),'skip');assert.equal(deliveryDecision({...record,firstAttemptAt:null,createdAt:new Date(now-25*3600000).toISOString()},now),'expire');
});
test('ambiguous sends retry identical content and key, while definite validation errors remain blocked',async()=>{
  const calls=[],email={from:'Personal <sender@example.com>',to:['owner@example.com'],subject:'test',html:'<p>Example</p>',text:'Example'};
  const fetch=async(url,options)=>{calls.push(options);if(calls.length===1)throw Error('network outcome unknown');return {ok:true,json:async()=>({id:'example-provider-id'})};};
  assert.equal((await sendAlertEmail(email,'stable-event-key','fake-test-key',{fetch})).status,'retry');assert.equal((await sendAlertEmail(email,'stable-event-key','fake-test-key',{fetch})).status,'accepted');assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
  assert.deepEqual(await sendAlertEmail(email,'key','fake-test-key',{fetch:async()=>({ok:false,status:403})}),{status:'blocked',uncertain:false,code:'EMAIL_HTTP_403'});
});
test('environment is personal-only, scopes to one owner, and never borrows legacy sender secrets',()=>{
  const env={FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'alvissome-portfolio'}),PORTFOLIO_ALERT_UID:'example-owner'};assert.equal(validateAlertEnvironment(env).enabled,false);
  assert.throws(()=>validateAlertEnvironment({...env,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'other-project'})}),/MISMATCH/);
  assert.throws(()=>validateAlertEnvironment({...env,PORTFOLIO_ALERTS_ENABLED:'true'}),/EMAIL_SETUP/);
  const event={type:'support_hit',symbol:'EXAMPLE',currency:'USD',levels:[{key:'s1',price:100}],quote:quote(99)};assert.deepEqual(eventIdentity(event),eventIdentity({...event,levels:[{key:'s2',price:100}]}));
});
test('new worker preserves the private data boundary and default-off delivery',async()=>{
  const worker=await readFile(new URL('../.github/scripts/runCommandAlerts.mjs',import.meta.url),'utf8'),workflow=await readFile(new URL('../.github/workflows/command-centre-alerts.yml',import.meta.url),'utf8');
  assert.match(worker,/getAuth\(\)\.getUser/);assert.match(worker,/tx\.create\(mailRef/);assert.match(worker,/stillCurrent/);assert.match(worker,/Ticker or support changed/);assert.doesNotMatch(worker,/upload-artifact|console\.log\(data|console\.log\(events/);assert.match(workflow,/PORTFOLIO_ALERT_RESEND_KEY/);assert.match(workflow,/0 0 \* \* \*/);assert.doesNotMatch(workflow,/^  push:/m);assert.doesNotMatch(workflow,/pull_request_target|contents: write/);
});
test('the alert worker requires an explicit, unambiguous execution mode',()=>{
  assert.equal(alertRunMode(['node','script','--dry-run']),'dry-run');assert.equal(alertRunMode(['node','script','--run']),'run');assert.throws(()=>alertRunMode(['node','script']),/EXPLICIT/);assert.throws(()=>alertRunMode(['--run','--dry-run']),/SELECT_ONE/);
});
test('unresolved delivery failures stay visible after subsequent quiet checks',()=>{
  assert.deepEqual(outstandingDelivery([{status:'accepted'}]),{count:0,message:''});
  const r=outstandingDelivery([{status:'needs_review'},{status:'blocked'},{status:'accepted'}]);assert.equal(r.count,2);assert.match(r.message,/needs review/);
  assert.match(outstandingDelivery([{status:'blocked'}]).message,/blocked/);
});

test('market callout names all three trends and explains alignment, individual slopes and peak',()=>{
 const html=renderMarketCallout(context(),{now});
 for(const text of ['Short:','Medium:','Long:','Short-term','Medium-term','Long-term','20 EMA above 40 EMA','50 SMA above 150 SMA','200 SMA','over 5 sessions','crossover alone','52-week closing peak'])assert.ok(html.includes(text),text);
 assert.match(html,/<details/);
});


test('daily email groups multiple alerts in one ticker card and keeps every alert',()=>{
  const email=renderAlertEmail({createdAt:new Date(now).toISOString(),context:context(),events:[
    {type:'support_approach',symbol:'CRM',currency:'USD',quote:quote(99),distancePct:2,levels:[{key:'s2',price:97}]},
    {type:'daily_drop',symbol:'CRM',currency:'USD',tier:5,dropPct:-6,quote:quote(99)},
    {type:'support_hit',symbol:'CRM',currency:'USD',quote:quote(99),levels:[{key:'s1',price:100}]},
  ]});
  assert.match(email.subject,/Daily digest · 3 alerts · CRM/);
  assert.equal((email.html.match(/>CRM<\/h2>/g)||[]).length,1);
  for(const label of ['Approaching support','New support reached','Large daily drop'])assert.ok(email.html.includes(label));
  assert.equal(singaporeDigestDay(new Date('2026-11-18T15:59:00Z')),'2026-11-18');
  assert.equal(singaporeDigestDay(new Date('2026-11-18T16:00:00Z')),'2026-11-19');
});
