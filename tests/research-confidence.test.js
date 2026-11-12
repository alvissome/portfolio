import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBackdatedSupportFit} from '../assets/research-confidence.js';
const base={symbol:'EXAMPLE',referenceSupports:[20,18,16],calculatedSupports:[20,18,16],referenceAsOf:'2026-11-03',asOf:'2026-11-03',studyMonth:'2026-11',modelVersion:'fixture'};
test('one-month numerical agreement alone does not earn high reconstruction confidence',()=>{
  const mid=assessBackdatedSupportFit(base);assert.equal(mid.confidence,'mid');assert.equal(mid.fullFit,true);
  const high=assessBackdatedSupportFit({...base,technicalReviewed:true,nearbyCutoffsStable:true});assert.equal(high.confidence,'high');
  assert.equal(assessBackdatedSupportFit({...base,calculatedSupports:[10,8,6]}).confidence,'low');
});
test('study exclusions, missing benchmarks and other months stay outside the success denominator',()=>{
  assert.equal(assessBackdatedSupportFit({...base,excludedSymbols:['EXAMPLE']}).confidence,'excluded');
  assert.equal(assessBackdatedSupportFit({...base,referenceSupports:[]}).confidence,'not_assessed');
  assert.equal(assessBackdatedSupportFit({...base,studyMonth:'2026-10'}).confidence,'not_assessed');
});
test('nearby-session fit can be assessed but current-day values cannot masquerade as a backdated case',()=>{
  assert.equal(assessBackdatedSupportFit({...base,asOf:'2026-11-05'}).confidence,'mid');
  assert.equal(assessBackdatedSupportFit({...base,asOf:'2026-11-12'}).confidence,'not_assessed');
});
test('extra levels prevent a full ticker reproduction even when all published levels fit',()=>{
  const a=assessBackdatedSupportFit({...base,calculatedSupports:[20,18,16,12],technicalReviewed:true,nearbyCutoffsStable:true});
  assert.equal(a.fullFit,false);assert.equal(a.extraCount,1);assert.equal(a.confidence,'mid');
});
