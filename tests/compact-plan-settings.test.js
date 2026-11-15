import test from 'node:test';
import assert from 'node:assert/strict';
import {revisitDate} from '../assets/investment-panel.js';
test('Hold shortcuts use calendar months, clamp month ends and cross years',()=>{
 assert.equal(revisitDate('2026-11-15'),'2026-12-15');
 assert.equal(revisitDate('2026-11-15',3),'2027-02-15');
 assert.equal(revisitDate('2027-01-31'),'2027-02-28');
 assert.equal(revisitDate('2028-01-31'),'2028-02-29');
 assert.equal(revisitDate('2026-08-31',3),'2026-11-30');
});
