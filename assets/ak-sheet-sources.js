/** Read-only AK sheet feeds. URLs and downloaded references stay in the user's
 * private store; no portfolio values are sent to Google. */
export const AK_SOURCES = [
  {key:'capital_gains',label:'Capital gains',portal:'https://insight.piranhaprofits.com/uip/current_growth_portfolio/'},
  {key:'dividend',label:'Dividend',portal:'https://insight.piranhaprofits.com/uip/current_dividend_portfolio/'},
  {key:'priority_watchlist',label:'Priority watchlist',portal:'https://insight.piranhaprofits.com/uip/watchlist/'},
  {key:'secondary_watchlist',label:'Secondary watchlist',portal:'https://insight.piranhaprofits.com/uip/secondary-watchlist/'},
];
const LIMIT=3*1024*1024;
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function googleSheetFeed(value) {
  let u;try{u=new URL(String(value).trim());}catch{throw Error('Enter a Google Sheets link.');}
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||u.port||u.username||u.password)throw Error('Use the embedded Google Sheets link, not a login or UIP page.');
  const published=u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})\/(?:pubhtml|pub)\/?$/);
  const native=u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/(?:edit|htmlview|pubhtml|pub|export))?\/?$/);
  if(!published&&!native)throw Error('This Google Sheets link format is not supported.');
  const gid=u.searchParams.get('gid')??new URLSearchParams(u.hash.slice(1)).get('gid');
  if(gid!==null&&!/^\d{1,12}$/.test(gid))throw Error('The sheet tab ID is invalid.');
  const feed=new URL(published?`https://docs.google.com/spreadsheets/d/e/${published[1]}/pub`:`https://docs.google.com/spreadsheets/d/${native[1]}/export`);
  if(published){feed.searchParams.set('output','csv');feed.searchParams.set('single','true');}
  else feed.searchParams.set('format','csv');
  if(gid!==null)feed.searchParams.set('gid',gid);
  return feed.href;
}
export function normalizeAkSourceSettings(settings={}) {
  const result=Object.fromEntries(AK_SOURCES.map(({key})=>[key,settings[key]?.trim()?googleSheetFeed(settings[key]):'']));
  const populated=Object.values(result).filter(Boolean);
  if(new Set(populated).size!==populated.length)throw Error('Each list needs its own sheet or tab link.');
  return result;
}
export function akSourceDefaults(metadata={}){
  return Object.fromEntries(AK_SOURCES.map(({key})=>{
    const source=metadata.sources?.[key];let value='';
    try{value=source?.publishedId?googleSheetFeed(`https://docs.google.com/spreadsheets/d/e/${source.publishedId}/pub${source.gid!=null?'?gid='+source.gid:''}`):source?.url?googleSheetFeed(source.url):'';}catch{}
    return [key,value];
  }));
}
export function parseSheetCSV(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>LIMIT)throw Error('Sheet is too large.');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else throw Error('Invalid CSV quoting.');}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
    if(rows.length>2000||row.length>80)throw Error('Sheet exceeds supported dimensions.');
  }
  if(quoted)throw Error('Incomplete CSV download.');
  if(cell||row.length){row.push(cell);rows.push(row);}
  if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');
  return rows;
}
function sourceDate(rows) {
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const candidates=rows.slice(0,10).flatMap((r,i)=>r.map((v,j)=>({v:String(v).trim(),preferred:/updated/i.test(String(r[j-1]??'')+v),i})));
  candidates.sort((a,b)=>Number(b.preferred)-Number(a.preferred)||a.i-b.i);
  for(const {v} of candidates){
    const iso=v.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(iso&&validDate(iso[1]))return iso[1];
    const m=v.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2}|20\d{2})\b/);
    if(m){const month=months.indexOf(m[2].slice(0,3).toLowerCase());const year=m[3].length===2?'20'+m[3]:m[3];
      const d=`${year}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(month>=0&&validDate(d))return d;}
  }
  throw Error('The sheet update date could not be read; previous reference retained.');
}
const aliases={conservativeIV:['conservativeiv','pessimisticiv','intrinsicvalueconservative'],baseIV:['baseiv','intrinsicvaluebasecase'],
  averageIV:['averageiv'],yieldIV:['intrinsicvalue5yieldprice','5yieldprice'],historicalPbIV:['intrinsicvalueptotbv'],adjustedPbIV:['intrinsicvaluebyadjustedpbv']};
function number(value) {
  const s=String(value??'').trim();if(!s||/^(?:NA|N\/A|NONE|—|-)$/i.test(s))return null;
  const cleaned=s.replace(/(?:HK\$|S\$|US\$|\$|,|\s)/g,'');
  if(!/^\d+(?:\.\d+)?$/.test(cleaned)||!(Number(cleaned)>0))throw Error('A support or IV cell is not a positive number.');
  return Number(cleaned);
}
function listedSymbol(value) {
  const ticker=String(value??'').trim().toUpperCase();
  const m=ticker.match(/^([A-Z0-9.\-]+)-(US|SG|SGX|HK|UK)$/);
  if(m){if(m[2]==='US')return m[1];if(['SG','SGX'].includes(m[2]))return m[1]+'.SI';
    if(m[2]==='HK'&&/^\d+$/.test(m[1]))return m[1].padStart(4,'0')+'.HK';if(m[2]==='UK')return ticker;}
  if(/^[A-Z0-9][A-Z0-9.\-]{0,29}$/.test(ticker)&&!ticker.includes(' '))return ticker;
  throw Error('A listed ticker could not be mapped.');
}
export function parseAkSheet(text,source,{today=new Date().toISOString().slice(0,10)}={}) {
  if(!AK_SOURCES.some(x=>x.key===source))throw Error('Unknown AK list.');
  const grid=parseSheetCSV(text),asOf=sourceDate(grid);if(asOf>today)throw Error('Sheet date is in the future.');
  const titles={capital_gains:['capitalgainsportfolio','capitalgainportfolio','growthportfolio'],dividend:['dividendportfolio'],priority_watchlist:['prioritywatchlist'],secondary_watchlist:['secondarywatchlist']};
  if(!grid.slice(0,6).flat().some(cell=>titles[source].some(title=>norm(cell).includes(title))))throw Error('The list title does not match this source setting. Check the sheet or tab link.');
  const rows=[];let columns=null;
  for(const cells of grid){
    const headers=cells.map(norm),ticker=headers.indexOf('ticker'),currency=headers.indexOf('currency');
    const supports=[1,2,3,4,5].map(n=>headers.findIndex(h=>h==='supportlevel'+n||h==='sl'+n));
    if(ticker>=0&&currency>=0&&supports.every(n=>n>=0)){
      columns={ticker,currency,supports,category:headers.findIndex(h=>['investmenttype','investmentcategory'].includes(h)),classification:headers.indexOf('classification'),
        fields:Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))]))};continue;
    }
    if(!columns||!String(cells[columns.ticker]??'').trim())continue;
    const raw=String(cells[columns.ticker]).trim();
    if(!/^[A-Za-z0-9.\-]+-(?:US|SG|SGX|HK|UK)$/.test(raw)&&!['USD','SGD','HKD','GBP'].includes(String(cells[columns.currency]).trim()))continue;
    const curr=String(cells[columns.currency]??'').trim().toUpperCase();if(!['USD','SGD','HKD','GBP'].includes(curr))throw Error('A listing currency is missing or unsupported.');
    const supportLevels=columns.supports.map(i=>number(cells[i])).filter(v=>v!==null);
    if(supportLevels.some((v,i)=>i&&v>=supportLevels[i-1]))throw Error('Support levels are not in descending order; review the sheet layout.');
    rows.push({symbol:listedSymbol(raw),source,asOf,currency:curr,supportLevels,
      category:columns.category>=0?String(cells[columns.category]??'').trim()||null:null,
      classification:columns.classification>=0?String(cells[columns.classification]??'').trim()||null:null,
      ...Object.fromEntries(Object.entries(columns.fields).map(([key,index])=>[key,index<0?null:number(cells[index])]))});
  }
  if(!rows.length)throw Error('No benchmark rows found; previous reference retained.');
  if(new Set(rows.map(x=>x.symbol)).size!==rows.length)throw Error('Duplicate listings in this source need review.');
  return {asOf,rows};
}
export function previousAkRows(records={}) {
  const rows=[];
  for(const [symbol,record] of Object.entries(records))for(const entry of record.reference?.entries??[]){
    if(!AK_SOURCES.some(s=>s.key===entry.source))continue;
    rows.push({symbol,source:entry.source,asOf:entry.asOf,currency:entry.currency,supportLevels:entry.supports??[],category:entry.category??null,classification:entry.classification??null,
      ...Object.fromEntries(Object.keys(aliases).map(key=>[key,entry.variants?.find(v=>v.key===key)?.value??null]))});
  }
  return rows;
}
export function planAkLevelCopy(watchlist,symbol,reference) {
  const row=watchlist.find(r=>r.symbol===symbol);
  if(!row||reference?.present!==true||!Array.isArray(reference.supports)||!reference.supports.length)throw Error('A watchlist row and published AK levels are required.');
  if(!validDate(reference.asOf)||reference.conflict)throw Error('Resolve the reference date or conflicting sources before copying levels.');
  if(reference.supports.length>5||reference.supports.some((v,i)=>!Number.isFinite(v)||v<=0||(i&&v>=reference.supports[i-1])))throw Error('AK support ordering needs review.');
  return {id:row.id,patch:Object.fromEntries([1,2,3,4,5].map((n,i)=>['s'+n,reference.supports[i]===undefined?'':String(reference.supports[i])]))};
}
function comparable(rows) {return JSON.stringify(rows.map(r=>({symbol:r.symbol,source:r.source,asOf:r.asOf,currency:r.currency,supportLevels:r.supportLevels,
  category:r.category??null,classification:r.classification??null,...Object.fromEntries(Object.keys(aliases).map(k=>[k,r[k]??null]))})).sort((a,b)=>(a.source+a.symbol).localeCompare(b.source+b.symbol)));}
export async function readAkSources(settings,records,{fetch:fetchImpl=globalThis.fetch,now=new Date(),signal}={}) {
  const urls=normalizeAkSourceSettings(settings),old=previousAkRows(records),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const results=await Promise.all(AK_SOURCES.map(async source=>{
    const previous=old.filter(r=>r.source===source.key);const oldDate=previous.map(r=>r.asOf).sort().at(-1)??null;
    const base={source:source.key,url:urls[source.key],checkedAt:now.toISOString(),asOf:oldDate};
    if(!base.url)return {...base,status:'not_configured',message:'Add the embedded Google Sheets URL.',rows:previous};
    try{
      const response=await fetchImpl(base.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
      if(!response.ok)throw Error([401,403].includes(response.status)?'Access required. Use a readable published sheet URL.':'The sheet could not be downloaded.');
      const text=await response.text();const parsed=parseAkSheet(text,source.key,{today});
      if(oldDate&&parsed.asOf<oldDate)throw Error('This sheet is older than the saved reference. Check the replacement URL.');
      return {...base,asOf:parsed.asOf,status:comparable(previous)===comparable(parsed.rows)?'unchanged':'updated',message:null,rows:parsed.rows};
    }catch(error){return {...base,status:'unavailable',message:signal?.aborted?'Sync cancelled.':error?.message==='Failed to fetch'?'Unable to read this sheet. Check its published link and access.':String(error?.message||'Sheet unavailable.').slice(0,200),rows:previous};}
  }));
  const readable=results.filter(r=>['updated','unchanged'].includes(r.status));const rows=results.flatMap(r=>r.rows);
  const statuses=Object.fromEntries(results.map(({rows,...r})=>[r.source,r]));
  return {settings:urls,statuses,readable:readable.length,changed:readable.some(r=>r.status==='updated'),snapshot:{snapshotId:'ak-sync-'+now.toISOString().replace(/[^0-9]/g,''),retrievedAt:today,
    complete:readable.length===4,coveredMarkets:['US','SG','HK'],rows,sources:statuses}};
}
