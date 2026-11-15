import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createInvestmentComponent} from '../assets/investment-panel.js';
test('legacy alert senders and dashboard controls are retired while shared data workers remain',async()=>{
 for(const p of ['../alerts.html','../assets/alerts-entry.js','../.github/workflows/daily-alerts.yml','../.github/workflows/support-alerts.yml','../.github/scripts/checkAlerts.js','../.github/scripts/notifySupportFailure.js'])await assert.rejects(access(new URL(p,import.meta.url)));
 for(const p of ['../.github/workflows/research.yml','../.github/workflows/performance-snapshots.yml','../.github/scripts/capturePerformance.js'])await access(new URL(p,import.meta.url));
 const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8'),index=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const settings=bundle.slice(bundle.indexOf('function ON('),bundle.indexOf('function LN('));assert.ok(settings.includes('Twelve Data API key'));assert.ok(!settings.includes('EmailJS'));assert.ok(!settings.includes('Global Alert Email'));assert.ok(!bundle.includes('Sync Watchlist'));assert.ok(!bundle.includes('async function DN('));assert.ok(!index.includes('alerts-entry'));
 const watch=bundle.slice(bundle.indexOf('function RN('),bundle.indexOf('function NN('));for(const text of ['Cooldown (hours','Email override','Legacy multi-level config','children:"🔔"'])assert.ok(!watch.includes(text),text);
 assert.ok(bundle.includes('researchPanel:m.jsx(RN,'));assert.equal((bundle.match(/m\.jsx\(RN,/g)||[]).length,1);
});
test('CC excludes the old Watchlist AK disclosure; settings own source controls',()=>{
 const React={useRef:current=>({current}),useState:()=>['watchlist',()=>{}],useEffect:()=>{}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},Panel=createInvestmentComponent(React,jsx),researchPanel={type:'watchlist-test'};
 const props={uid:'test',state:{},research:{},storage:{},researchPanel};
 const tree=Panel(props);
 assert.equal(tree.type,'section');
 assert.equal(tree.props.children.length,1);
 assert.equal(tree.props.children[0].props.className,'pf-panel investment-panel');
 assert.ok(!tree.props.children.some(c=>c===researchPanel));
 const privateTree=Panel({...props,state:{privacyMode:true}});
 assert.equal(privateTree.props.children.length,1);
});
