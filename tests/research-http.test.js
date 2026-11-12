import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSecUserAgent, GENERIC_RESEARCH_USER_AGENT, secContactConfigurationMessage} from '../.github/scripts/research-http.mjs';
import {fetchResearchData} from '../.github/scripts/research-data.mjs';

test('optional SEC contact uses a validated app/contact header and empty configuration keeps the generic header',()=>{
  for(const value of [undefined,null,'','   '])assert.equal(buildSecUserAgent(value),GENERIC_RESEARCH_USER_AGENT);
  assert.equal(buildSecUserAgent(' contact+research@example.com '),'PersonalPortfolioResearch contact+research@example.com');
  for(const value of [42,'contact@localhost','name <contact@example.com>','a..b@example.com',
    'private-fixture@example.com\r\nX-Injected: secret-fixture','fixture@example.com\0','fixture@example.com\n']){
    let caught;
    try{buildSecUserAgent(value);}catch(error){caught=error;}
    assert.equal(caught?.code,'SEC_CONTACT_EMAIL_INVALID');
    assert.ok(secContactConfigurationMessage(caught).includes('correct or remove'));
    assert.ok(!String(caught).includes(String(value)),'configuration errors never echo supplied values');
  }
  assert.equal(secContactConfigurationMessage(Error('unrelated')),null);
});

test('SEC-only contact header is isolated from Yahoo requests and never enters research data',async()=>{
  const contact='contact-fixture@example.com',agent=buildSecUserAgent(contact),requests=[];
  const series=(type,value)=>({meta:{symbol:['EXAMPLE']},[type]:[
    {asOfDate:'2026-09-30',periodType:'12M',currencyCode:'USD',reportedValue:{raw:value}}]});
  const fetch=async(url,options)=>{
    requests.push({url,headers:options.headers});
    if(url.includes('/chart/'))return{ok:true,json:async()=>({chart:{result:[{meta:{symbol:'EXAMPLE',currency:'USD',instrumentType:'EQUITY',
      longName:'Example Company',dataGranularity:'1d',exchangeTimezoneName:'UTC'},timestamp:[],indicators:{quote:[{}]}}]}})};
    if(url.includes('fundamentals-timeseries'))return{ok:true,json:async()=>({timeseries:{result:[series('annualOperatingCashFlow',100),series('annualOrdinarySharesNumber',10)]}})};
    if(url==='https://www.sec.gov/files/company_tickers.json')return{ok:true,json:async()=>({0:{cik_str:1,ticker:'EXAMPLE',title:'Example Company'}})};
    if(url==='https://data.sec.gov/submissions/CIK0000000001.json')return{ok:true,json:async()=>({tickers:['EXAMPLE'],sic:'7372',
      filings:{recent:{form:['10-K'],filingDate:['2026-02-01']}}})};
    throw Error('Unexpected fixture URL');
  };
  const result=await fetchResearchData('EXAMPLE',{fetch,now:new Date('2026-11-12T12:00:00Z'),secUserAgent:agent});
  const sec=requests.filter(row=>new URL(row.url).hostname.endsWith('sec.gov'));
  const yahoo=requests.filter(row=>new URL(row.url).hostname.endsWith('yahoo.com'));
  assert.equal(sec.length,2);assert.equal(yahoo.length,2);
  assert.ok(sec.every(row=>row.headers['User-Agent']===agent));
  assert.ok(yahoo.every(row=>row.headers['User-Agent']===GENERIC_RESEARCH_USER_AGENT));
  assert.ok(yahoo.every(row=>!JSON.stringify(row).includes(contact)));
  assert.equal(result.fundamentals.listingSharesVerified,true);
  assert.ok(!JSON.stringify(result).includes(contact));
});

test('worker and both CLI entry points reject invalid contact configuration without printing it or starting providers',()=>{
  const secret='private-config-marker@example.com\r\nX-Injected: fixture';
  for(const [name,args] of [['runResearch.js',['--process']],
    ['research-cli.js',['--input','not-accessed.json','--output','not-created.json']],['update-sec-ticker-catalog.mjs',[]]]){
    const script=fileURLToPath(new URL(`../.github/scripts/${name}`,import.meta.url));
    const run=spawnSync(process.execPath,[script,...args],{env:{SEC_CONTACT_EMAIL:secret},encoding:'utf8',timeout:10000});
    assert.equal(run.status,1,name);
    assert.match(run.stderr,/Invalid SEC_CONTACT_EMAIL configuration/);
    assert.equal(run.stdout,'');
    assert.ok(!run.stderr.includes('private-config-marker'));
    assert.ok(!run.stderr.includes('X-Injected'));
    assert.ok(!run.stderr.includes('not-accessed.json'));
  }
});
