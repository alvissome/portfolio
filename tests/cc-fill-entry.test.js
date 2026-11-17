import test from 'node:test';
import assert from 'node:assert/strict';
import {pricedFill,recordStageFill} from '../assets/investment-strategy.js';
import {recordStageCashFill} from '../assets/cc-cash-allowance.js';
test('partial fill adds converted cost to earlier SGD spend and reserves only the increment',()=>{
 const execution=pricedFill({quantity:2.5,price:20,fees:1,currency:'USD',fx:1.3});
 assert.equal(execution.amount,66.3);
 const config={plans:{ABC:{stages:[{id:'s1',spent:10,budget:100}]}},cashUsage:{}};
 const saved=recordStageCashFill(config,'ABC','s1',{execution,date:'2026-11-17'},{id:'fill1',now:'2026-11-17',state:{}});
 assert.equal(saved.plans.ABC.stages[0].spent,76.3);
 assert.equal(saved.cashUsage.fill1.amount,66.3);
 assert.equal(saved.plans.ABC.stages[0].fills[0].fx,1.3);
 assert.throws(()=>pricedFill({quantity:1,price:20,currency:'USD'}));
});
test('fills keep the stage open while the remaining budget covers a trading lot',()=>{
 const stage={id:'stage',spent:0,budget:1000};
 const buy=qty=>{const execution=pricedFill({quantity:qty,price:10,currency:'SGD'});
   return recordStageFill({lotSize:10,stages:[stage]},stage.id,{date:'2026-11-17',execution,spent:execution.amount}).stages[0];};
 assert.equal(buy(90).completed,false);
 assert.equal(buy(95).completed,true);
 assert.equal(buy(100).completed,true);
});
