import test from 'node:test';
import assert from 'node:assert/strict';
import {readCashLedger,ledgerReviewWindow,reconcileLedgerEntries,ledgerPatch} from '../assets/stockscafe-ledger.js';
import {makeFlow,flowValue} from '../assets/performance-core.js';

const header='Type,Date (YYYY-MM-DD),Currency,Amount,Details,Symbol,StockName,Portfolio';
const deposit='DEPOSIT,2025-11-04,SGD,100,"Bank, funding",,,Investment SG';
const withdrawal='WITHDRAW,2025-11-05,USD,20,Returned funds,,,| CPF-SRS';
const ledger=(...rows)=>[header,...rows].join('\n');

test('reads StocksCafe deposits and withdrawals for review without turning trades into funding',async()=>{
  const {entries,excluded}=await readCashLedger(ledger(deposit,withdrawal,
    'BUY,2025-11-04,SGD,-50,,,,Investment SG',
    'DEPOSIT,2025-11-04,SGD,50,,,,Options - Trading'));
  assert.equal(excluded,2);
  assert.deepEqual(entries.map(({account,kind,amount,note})=>[account,kind,amount,note]),
    [['cash','contribution',100,'Bank, funding'],['srs','withdrawal',20,'Returned funds']]);
  await assert.rejects(readCashLedger('Symbol,Shares,AveragePrice\nABC,1,1'),/cash transaction export/);
});

test('overlapping exports skip both imported IDs and equivalent manual entries',async()=>{
  const {entries}=await readCashLedger(ledger(deposit,deposit,withdrawal));
  const [first,second]=entries;
  assert.notEqual(first.id,second.id);
  const manual=makeFlow({...first,id:'manual'});
  const history={flows:{manual},settings:{capture:{cash:{reconciledOn:'2025-11-04'}}}};
  const preview=reconcileLedgerEntries(entries,history.flows);
  assert.equal(preview.existing,1);
  const firstImport=ledgerPatch(entries,new Set([second.id]),history);
  assert.equal(firstImport.added,1);
  assert.deepEqual(firstImport.patch.settings.capture.cash,{needsReconciliation:true});
  const later=(await readCashLedger(ledger(withdrawal,deposit,deposit))).entries;
  const flows={manual,...firstImport.patch.flows};
  assert.equal(reconcileLedgerEntries(later,flows).existing,2);
  flows[second.id].voided=true;
  assert.equal(ledgerPatch(later,new Set([second.id]),{flows}).added,0);
});

test('only selected rows save and a foreign-currency movement needs reviewed SGD',async()=>{
  const {entries}=await readCashLedger(ledger(deposit,withdrawal));
  const foreign=entries[1],selected=new Set([foreign.id]);
  assert.equal(ledgerPatch(entries,new Set(),{}).added,0);
  assert.throws(()=>ledgerPatch(entries,selected,{}),/finite amount/);
  const reviewed=[entries[0],{...foreign,sgd:27.14}];
  const {patch,added}=ledgerPatch(reviewed,selected,{});
  assert.equal(added,1);
  assert.equal(flowValue(patch.flows[foreign.id],'srs','broker'),-27.14);
  const manual=makeFlow({...foreign,id:'manual',amount:27.14});
  assert.equal(ledgerPatch(reviewed,selected,{flows:{manual}}).added,0);
});

test('full exports resume per account after finishing review, including new same-date rows',async()=>{
  const before='DEPOSIT,2025-11-03,SGD,80,,,,Investment SG';
  const sameDate='DEPOSIT,2025-11-04,SGD,125,,,,Investment SG';
  const newer='WITHDRAW,2025-11-06,SGD,-10,,,,Investment SG';
  const {entries}=await readCashLedger(ledger(before,deposit,withdrawal));
  const history={coverage:{cash:{broker:{start:'2025-01-01',end:'2025-11-03'}},srs:{broker:{start:'2025-01-01',end:'2025-11-04'}}}};
  const initial=ledgerReviewWindow(entries,history);
  assert.deepEqual(initial,entries.slice(1));
  const result=ledgerPatch(initial,new Set(),history);
  assert.equal(result.reviewed,true);
  assert.equal(result.added,0);
  assert.equal(Object.hasOwn(result.patch,'flows'),false);
  assert.equal(Object.hasOwn(result.patch,'coverage'),false);
  history.settings=result.patch.settings;
  assert.deepEqual(ledgerReviewWindow(entries,history),[]);
  const reexport=(await readCashLedger(ledger(before,deposit,sameDate,withdrawal,newer))).entries;
  assert.deepEqual(ledgerReviewWindow(reexport,history),[reexport[2],reexport[4]]);
  const earlier=ledgerReviewWindow(entries,history,'2025-11-03');
  assert.deepEqual(earlier,entries);
  const olderReview=ledgerPatch([earlier[0]],new Set(),history);
  assert.equal(olderReview.reviewed,false);
  assert.deepEqual(olderReview.patch,{});
});

test('overlapping reviews on the same boundary date write only newly reviewed IDs',async()=>{
  const {entries}=await readCashLedger(ledger(deposit,'DEPOSIT,2025-11-04,SGD,125,,,,Investment SG'));
  const [first,second]=entries;
  const history={settings:ledgerPatch([first],new Set(),{}).patch.settings};
  const {patch}=ledgerPatch(entries,new Set(),history);
  assert.deepEqual(patch.settings.cashLedgerReviewed.cash['2025-11-04'],{[second.id]:true});
});
