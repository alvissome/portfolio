import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {refreshSecTickerCatalog} from '../.github/scripts/update-sec-ticker-catalog.mjs';
import {SEC_CATALOG_SOURCE, validateSecTickerCatalog, loadBundledSecTickerCatalog} from '../.github/scripts/sec-ticker-catalog.mjs';
import {fetchResearchData} from '../.github/scripts/research-data.mjs';

const now = new Date('2026-11-12T12:00:00Z');
const fixture = () => {
  const raw=JSON.stringify({0:{cik_str:1,ticker:'EXAMPLE',title:'Example Company'},
    1:{cik_str:2,ticker:'OTHER',title:'Other Company'}});
  return {raw,metadata:{sourceURL:SEC_CATALOG_SOURCE,retrievedAt:'2026-11-12T00:00:00Z',
    sha256:createHash('sha256').update(raw).digest('hex'),recordCount:2,catalogFile:'sec-company-tickers.json'}};
};
const validate = (raw,metadata,clock=now) => validateSecTickerCatalog(raw,metadata,{now:clock,minimumRows:2});

test('public catalog validates exact bytes, source, full schema, count and 45-day expiry',()=>{
  const {raw,metadata}=fixture();
  assert.equal(validate(raw,metadata).data[0].ticker,'EXAMPLE');
  assert.equal(validate(raw,metadata).provenance.maxAgeDays,45);
  assert.throws(()=>validate(raw+' ',metadata),/CHECKSUM/);
  assert.throws(()=>validate(raw,{...metadata,sourceURL:'https://example.com/catalog'}),/METADATA/);
  assert.throws(()=>validate(raw,{...metadata,recordCount:3}),/SCHEMA/);
  assert.throws(()=>validate(raw,metadata,new Date('2027-01-01T00:00:00Z')),/EXPIRED/);
  assert.throws(()=>validate(raw,{...metadata,retrievedAt:'2026-11-13T00:00:00Z'}),/DATE/);
  assert.throws(()=>validate(raw,{...metadata,retrievedAt:'2026-02-30T00:00:00Z'}),/DATE/);
  for(const data of [[],{0:{cik_str:1,ticker:'EXAMPLE',title:'Example'},2:{cik_str:2,ticker:'OTHER',title:'Other'}},
    {0:{cik_str:'1',ticker:'EXAMPLE',title:'Example'},1:{cik_str:2,ticker:'OTHER',title:'Other'}},
    {0:{cik_str:1,ticker:'EXAMPLE',title:'Example'},1:{cik_str:2,ticker:'EXAMPLE',title:'Duplicate'}}]){
    const broken=JSON.stringify(data),meta={...metadata,sha256:createHash('sha256').update(broken).digest('hex')};
    assert.throws(()=>validate(broken,meta),/SCHEMA/);
  }
});

test('bundled snapshot is the full public catalog with a matching checksum and no verification flags',async()=>{
  const metadata=JSON.parse(await readFile(new URL('../.github/data/sec-company-tickers.meta.json',import.meta.url),'utf8'));
  const loaded=await loadBundledSecTickerCatalog({now:new Date(metadata.retrievedAt)});
  assert.ok(Object.keys(loaded.data).length>=1000);
  assert.equal(Object.keys(loaded.data).length,metadata.recordCount);
  assert.deepEqual(Object.keys(loaded.data[0]).sort(),['cik_str','ticker','title']);
  assert.equal(Object.hasOwn(loaded.data[0],'verified'),false);
});

const series=(type,value)=>({meta:{symbol:['EXAMPLE']},[type]:[
  {asOfDate:'2026-09-30',periodType:'12M',currencyCode:'USD',reportedValue:{raw:value}}]});
function provider({issuerTicker='EXAMPLE',submissionsStatus=200,indexStatus=403}={}){
  const calls=[];
  const fetch=async url=>{
    calls.push(url);
    if(url.includes('/chart/'))return{ok:true,json:async()=>({chart:{result:[{meta:{symbol:'EXAMPLE',currency:'USD',instrumentType:'EQUITY',
      longName:'Example Company',dataGranularity:'1d',exchangeTimezoneName:'UTC'},timestamp:[],indicators:{quote:[{}]}}]}})};
    if(url.includes('fundamentals-timeseries'))return{ok:true,json:async()=>({timeseries:{result:[series('annualOperatingCashFlow',100),series('annualOrdinarySharesNumber',10)]}})};
    if(url===SEC_CATALOG_SOURCE)return indexStatus===200?{ok:true,json:async()=>({0:{cik_str:1,ticker:'EXAMPLE',title:'Example'}})}:{ok:false,status:indexStatus};
    if(url==='https://data.sec.gov/submissions/CIK0000000001.json')return submissionsStatus===200?{ok:true,json:async()=>({tickers:[issuerTicker],sic:'7372',
      filings:{recent:{form:['10-K'],filingDate:['2026-02-01']}}})}:{ok:false,status:submissionsStatus};
    throw Error('Unexpected provider request');
  };
  return{calls,fetch};
}
const loadFixture=async({now:clock})=>{const {raw,metadata}=fixture();return validate(raw,metadata,clock);};

test('index403 fallback preserves diagnostics and requires current exact issuer and 10-K evidence',async()=>{
  const source=provider();
  const data=await fetchResearchData('EXAMPLE',{fetch:source.fetch,now,loadSecCatalog:loadFixture});
  assert.equal(data.fundamentals.listingSharesVerified,true);
  assert.equal(data.instrument.issuer.cik,'0000000001');
  assert.ok(source.calls.includes('https://data.sec.gov/submissions/CIK0000000001.json'));
  assert.ok(data.warnings.includes('SEC_TICKERS_HTTP_403'));
  assert.ok(data.warnings.includes('SEC_TICKERS_CATALOG_FALLBACK'));
  assert.equal(data.instrument.issuerCatalog.sourceURL,SEC_CATALOG_SOURCE);
  assert.equal(data.instrument.issuerCatalog.recordCount,2);
  const mismatched=provider({issuerTicker:'OTHER'});
  const rejected=await fetchResearchData('EXAMPLE',{fetch:mismatched.fetch,now,loadSecCatalog:loadFixture});
  assert.equal(rejected.fundamentals.listingSharesVerified,false);
  assert.equal(rejected.instrument.methodFamily,'unknown');
});

test('expired fallback and denied current submissions cannot turn lookup entries into verified shares',async()=>{
  const source=provider();
  const data=await fetchResearchData('EXAMPLE',{fetch:source.fetch,now,
    loadSecCatalog:async()=>{throw Error('SEC_CATALOG_EXPIRED');}});
  assert.equal(data.fundamentals.listingSharesVerified,false);
  assert.ok(data.warnings.includes('SEC_CATALOG_EXPIRED'));
  assert.ok(!source.calls.some(url=>url.includes('/submissions/')));
  const denied=provider({submissionsStatus:403});
  const rejected=await fetchResearchData('EXAMPLE',{fetch:denied.fetch,now,loadSecCatalog:loadFixture});
  assert.equal(rejected.fundamentals.listingSharesVerified,false);
  assert.ok(rejected.warnings.includes('SEC_SUBMISSIONS_HTTP_403'));
  assert.equal(denied.calls.filter(url=>url.includes('/submissions/')).length,1,'no alternate-route retry');
});

test('a successful live index never loads the bundled fallback',async()=>{
  const source=provider({indexStatus:200});
  const data=await fetchResearchData('EXAMPLE',{fetch:source.fetch,now,
    loadSecCatalog:async()=>{throw Error('Fallback should not be loaded');}});
  assert.equal(data.fundamentals.listingSharesVerified,true);
  assert.equal(data.instrument.issuerCatalog,undefined);
  assert.ok(!data.warnings.includes('SEC_TICKERS_CATALOG_FALLBACK'));
});

test('an in-memory fallback expires at45days even before the one-day fetch cache expires',async()=>{
  const source=provider();
  const before=new Date('2026-12-26T23:59:59Z'),after=new Date('2026-12-27T00:00:01Z');
  const valid=await fetchResearchData('EXAMPLE',{fetch:source.fetch,now:before,loadSecCatalog:loadFixture});
  assert.equal(valid.fundamentals.listingSharesVerified,true);
  const expired=await fetchResearchData('EXAMPLE',{fetch:source.fetch,now:after,loadSecCatalog:loadFixture});
  assert.equal(expired.fundamentals.listingSharesVerified,false);
  assert.ok(expired.warnings.includes('SEC_CATALOG_EXPIRED'));
  assert.equal(source.calls.filter(url=>url===SEC_CATALOG_SOURCE).length,2);
});

test('catalog refresh stops on the official source denial without another route or a write',async()=>{
  const calls=[];
  await assert.rejects(refreshSecTickerCatalog({directory:'/unused/never-written',now:()=>now,
    fetch:async url=>{calls.push(url);return{ok:false,status:403};}}),/SEC_CATALOG_HTTP_403/);
  assert.deepEqual(calls,[SEC_CATALOG_SOURCE]);
});
