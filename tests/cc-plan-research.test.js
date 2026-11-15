import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseAkSheet,previousAkRows} from '../assets/ak-sheet-sources.js';
import {parseAdamSnapshot} from '../assets/research-client.js';
import {akReferenceCost} from '../assets/ak-reference-cost.js';
import {resolvedCompany,buildCommandCentre} from '../assets/investment-command-centre.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
const active='Capital Gains Portfolio\nUpdated on:,3 Nov 26\nTicker,Currency,SL1,SL2,SL3,SL4,SL5,Base IV,Average Cost\nEXAMPLE-US,USD,120,100,80,,,200,90';
const closed='Closed Positions\nUpdated on:,4 Nov 26\nTicker,Average Sell Price\nEXAMPLE-US,150';
const rows=()=>[...parseAkSheet(active,'capital_gains',{today:'2026-11-15'}).rows,...parseAkSheet(closed,'closed_positions',{today:'2026-11-15'}).rows];
const record=()=>({symbol:'EXAMPLE',securityId:'EXAMPLE',instrument:{currency:'USD'},reference:parseAdamSnapshot({retrievedAt:'2026-11-15',rows:rows()}).references.EXAMPLE});
test('AK average cost and closed average sell price import without replacing active valuation/supports',()=>{
 const r=record();assert.equal(r.reference.iv.value,200);assert.deepEqual(r.reference.supports,[120,100,80]);assert.equal(r.reference.conflict,false);assert.equal(akReferenceCost(r,'buy','USD').value,90);assert.equal(akReferenceCost(r,'hold','USD').value,90);assert.equal(akReferenceCost(r,'sell','USD').value,150);assert.equal(akReferenceCost(r,'sell','HKD').value,null);
 const old=previousAkRows({EXAMPLE:r});assert.equal(old.find(x=>x.source==='capital_gains').averageCost,90);assert.equal(old.find(x=>x.source==='closed_positions').averageSellPrice,150);
});
test('missing or conflicting closing prices do not fall back to active purchase prices',()=>{
 const r=record();r.reference.entries=r.reference.entries.filter(e=>e.source!=='closed_positions');assert.equal(akReferenceCost(r,'sell','USD').value,null);
 const closed=record().reference.entries.find(e=>e.source==='closed_positions');r.reference.entries.push(closed,{...closed,averageSellPrice:160});assert.equal(akReferenceCost(r,'sell','USD').value,null);
});
test('plan action selects cost basis automatically; explicit manual override remains possible',()=>{
 const s={strategyCategories:{EXAMPLE:'core'},holdings:[],watchlist:[{symbol:'EXAMPLE',priceCurrency:'USD',refCost:'999'}],fxRates:{USD:1.3}},research={records:{EXAMPLE:record()}};
 assert.equal(resolvedCompany(s,research,'EXAMPLE').refCost,90);assert.equal(resolvedCompany(s,research,'EXAMPLE',{action:'sell'}).refCost,150);assert.equal(resolvedCompany(s,research,'EXAMPLE',{action:'sell',researchOverrides:{refCost:'155'}}).refCost,155);
});
test('manual rebalancing flag works below IV/ceiling and survives backup without adding Watchlist rows',()=>{
 const now=Date.parse('2026-11-15T02:00:00Z');const s={strategyCategories:{EXAMPLE:'core'},holdings:[{ticker:'EXAMPLE',accountType:'Cash',currency:'USD',shares:1}],watchlist:[],priceCache:{EXAMPLE:{close:150,timestamp:now}},fxRates:{USD:1.3},cash:{brokers:10000,growth:0,dividend:0},rebalancingSymbols:{EXAMPLE:true}};
 const m=buildCommandCentre(s,{records:{EXAMPLE:record()}},{plans:{},decisions:{},funding:{}},{today:'2026-11-15',now});assert.ok(m.rows[0].lists.includes('balance'));assert.equal(m.rows[0].overIV,false);assert.equal(m.rows[0].concentration,false);assert.equal(s.watchlist.length,0);
 const restored=readDashboardBackup(createDashboardBackup(s,{snapshots:{},flows:{},trades:{},coverage:{},settings:{}}));assert.equal(restored.state.rebalancingSymbols.EXAMPLE,true);
});
test('production wiring uses persisted rebalancing flags and per-plan source/status/method controls',async()=>{
 const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8'),panel=await readFile(new URL('../assets/investment-panel.js',import.meta.url),'utf8');
 assert.ok(bundle.includes('mergeFields:["settings.rebalancingSymbols"]'));assert.ok(bundle.includes('onRebalance:updateRebalancing'));assert.ok(!bundle.includes('Research · AK sheets and independent calculations'));
 for(const value of ['name="levelSource"','name="methodFamily"','data-plan-research-status','data-recalculate'])assert.ok(panel.includes(value),value);
});
test('rebalancing flag round-trips the production cloud serializer independently of watchlist membership',async()=>{
 const {runInNewContext}=await import('node:vm');const {normalizeStrategyCategories}=await import('../assets/strategy-categories.js');const {normalizeResearchColumnSettings}=await import('../assets/research-columns.js');const {holdingKey}=await import('../assets/account-portfolio.js');
 const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8'),context={holdingKey,normalizeStrategyCategories,normalizeResearchColumnSettings,In:{cash:{},emailSettings:{}}};
 const a=bundle.indexOf('function MR('),b=bundle.indexOf('async function JT(',a);runInNewContext(bundle.slice(a,b)+';this.save=BR;this.load=UR;',context);
 const state={holdings:[],watchlist:[],cash:{},strategyCategories:{},rebalancingSymbols:{EXAMPLE:true}};const saved=context.save(state);assert.equal(saved.settings.rebalancingSymbols.EXAMPLE,true);assert.equal(context.load(saved).rebalancingSymbols.EXAMPLE,true);assert.equal(context.load(saved).watchlist.length,0);
});

test('an explicit flag reopens a saved plan only in Rebalancing, while retaining My decisions',async()=>{
 const {renderCommandCentre}=await import('../assets/investment-command-view.js');const now=Date.parse('2026-11-15T02:00:00Z');
 const s={strategyCategories:{EXAMPLE:'core'},holdings:[{ticker:'EXAMPLE',accountType:'Cash',currency:'USD',shares:1}],watchlist:[],priceCache:{EXAMPLE:{close:150,timestamp:now}},fxRates:{USD:1.3},cash:{brokers:10000,growth:0,dividend:0},rebalancingSymbols:{EXAMPLE:true}};
 const c={plans:{EXAMPLE:{id:'p',symbol:'EXAMPLE',action:'hold',category:'core',currency:'USD',iv:200,stages:[],revisitOn:'2027-01-01'}},decisions:{},funding:{}};
 const model=buildCommandCentre(s,{records:{EXAMPLE:record()}},c,{today:'2026-11-15',now});assert.match(renderCommandCentre(model,{show:String,today:'2026-11-15',filter:'balance'}),/data-opportunity="EXAMPLE"/);assert.doesNotMatch(renderCommandCentre(model,{show:String,today:'2026-11-15',filter:'opportunities'}),/data-opportunity="EXAMPLE"/);assert.match(renderCommandCentre(model,{show:String,today:'2026-11-15',filter:'decisions'}),/data-decision-row="EXAMPLE"/);
});
