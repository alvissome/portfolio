import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWatchlistLevels} from '../assets/watchlist-levels.js';

const record = {symbol:'TEST',securityId:'TEST',instrument:{currency:'USD'},
  reference:{present:true,currency:'USD',iv:{value:95},supports:[90,80]},
  iv:{result:{value:88,currency:'USD'}},supports:{result:{value:[85,75,65],currency:'USD'}}};
const raw = {symbol:'TEST',s1:'92',s4:'60'};
test('manual overrides survive refresh; partial AK ladder leaves missing rungs open',()=>{
  const {row,sources} = resolveWatchlistLevels(raw,record);
  assert.deepEqual([row.iv,row.s1,row.s2,row.s3,row.s4],['95','92','80','','60']);
  assert.equal(sources.s1,'Manual');
  assert.equal(resolveWatchlistLevels({...raw,s1:''},record).row.s1,'90');
  assert.equal(raw.s2,undefined);
});
test('independent preference and missing AK sections use independent values',()=>{
  assert.equal(resolveWatchlistLevels({...raw,levelSource:'independent'},record).row.s3,'65');
  const noSL = {...record,reference:{...record.reference,supports:[]}};
  assert.equal(resolveWatchlistLevels(raw,noSL).row.s3,'65');
  assert.equal(resolveWatchlistLevels(raw,noSL).row.iv,'95');
});
test('symbol and currency mismatch, conflicting references and unavailable calculations',()=>{
  assert.equal(resolveWatchlistLevels({...raw,priceCurrency:'SGD'},record).row.iv,'');
  assert.equal(resolveWatchlistLevels({...raw,symbol:'OTHER'},record).row.iv,'');
  assert.equal(resolveWatchlistLevels(raw,{...record,reference:{...record.reference,conflict:true}}).row.iv,'88');
  assert.equal(resolveWatchlistLevels(raw,{...record,reference:null,iv:{processing:'failed',previousResult:{value:91}}}).row.iv,'');
});
