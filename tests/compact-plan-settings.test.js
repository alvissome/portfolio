import test from 'node:test';
import assert from 'node:assert/strict';
import {revisitDate,supportSourceLabel} from '../assets/investment-panel.js';
test('Hold shortcuts use calendar months, clamp month ends and cross years',()=>{
 assert.equal(revisitDate('2026-11-15'),'2026-12-15');
 assert.equal(revisitDate('2026-11-15',3),'2027-02-15');
 assert.equal(revisitDate('2027-01-31'),'2027-02-28');
 assert.equal(revisitDate('2028-01-31'),'2028-02-29');
 assert.equal(revisitDate('2026-08-31',3),'2026-11-30');
});

test('displayed support sources identify uniform and mixed AK, independent and manual levels',()=>{
 const levels=['s1','s2','s3'].map(key=>({key,price:1}));
 assert.equal(supportSourceLabel({levels,sources:{s1:'AK',s2:'AK',s3:'AK'}}),'AK (S1, S2, S3)');
 assert.equal(supportSourceLabel({levels,sources:{s1:'Independent',s2:'Independent',s3:'Independent'}}),'Independent (S1, S2, S3)');
 assert.equal(supportSourceLabel({levels,sources:{s1:'Manual',s2:'AK',s3:'Independent'}}),'S1: Manual · S2: AK · S3: Independent');
 assert.equal(supportSourceLabel({levels:[]}),'unavailable');
});
