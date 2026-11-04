import {readPortfolioTSV,exportedCash} from './stockscafe-cash.js';

export const ACCOUNT_TYPES={cash:'Cash',srs:'Retirement - SRS',cpf:'Retirement - CPF'};
export const ACCOUNT_NAMES={cash:'Cash investments',srs:'SRS',cpf:'CPF investment'};
export const holdingKey=h=>encodeURIComponent(h.accountType||'Unclassified')+'~'+encodeURIComponent(h.ticker);
const finite=(value,label)=>{
  if(value==null||String(value).trim()===''||!Number.isFinite(Number(String(value).replace(/,/g,''))))throw Error('Missing or invalid '+label+'.');
  return Number(String(value).replace(/,/g,''));
};
const optional=(v)=>v==null||v===''||v==='NA'?undefined:finite(v,'optional numeric field');
const rounded=n=>Math.round((n+Number.EPSILON)*100)/100;
export function parseAccountFile(text,account) {
  if(!Object.hasOwn(ACCOUNT_TYPES,account))throw Error('Select Cash, SRS or CPF for every file.');
  const rows=readPortfolioTSV(text),holdings=[],seen=new Set();
  const suffix={SGX:'.SI',USX:'',HKEX:'.HK',LSE:'.L'};
  for(const row of rows){
    if(row.Symbol==='CASH')continue;
    if(!row.Symbol||!Object.hasOwn(suffix,row.Exchange))throw Error('A holding has a missing ticker or unsupported exchange.');
    const ticker=row.Symbol+suffix[row.Exchange];
    if(seen.has(ticker))throw Error('Duplicate '+ticker+' within one account export. Export a single complete account view.');
    seen.add(ticker);
    const shares=finite(row.Shares,ticker+' shares'),average_cost=finite(row.AveragePrice,ticker+' average cost'),close=finite(row.Close,ticker+' closing price');
    if(shares<=0||average_cost<0||close<=0)throw Error('Invalid quantity, cost or price for '+ticker+'.');
    if(!['SGD','USD','HKD','GBP','EUR','JPY','AUD','CNY'].includes(row.Currency))throw Error('Unsupported currency for '+ticker+'.');
    // Derive dividends entirely from StocksCafe's SGD base-currency figures.
    // Never subtract a native-currency gain or a gain converted at today's FX.
    const pnl=finite(row.ProfitAndLossPlusDividendInBaseCurrency,ticker+' SGD P&L including dividends');
    const baseCost=finite(row.CostInBaseCurrency,ticker+' SGD cost'),baseValue=finite(row.ValueInBaseCurrency,ticker+' SGD value');
    const pct=row.DividendPercent?.replace(/%$/,'');
    holdings.push({ticker,name:row.Name||ticker,shares,currency:row.Currency,average_cost,accountType:ACCOUNT_TYPES[account],importAccount:account,portfolioType:'',bDiv:rounded(pnl-(baseValue-baseCost)),divPct:optional(pct),lastClose:close,exited:false,bDivMappingVersion:2});
  }
  return {holdings,cash:exportedCash(rows)};
}
export function planAccountImports(state,files,now=new Date().toISOString()) {
  if(!Array.isArray(files)||files.length<1||files.length>3)throw Error('Choose one to three account-specific TSV files.');
  const accounts=new Set(),contents=new Set(),parsed=[];
  for(const file of files){
    if(accounts.has(file.account))throw Error('Choose each account only once per batch.');
    accounts.add(file.account);
    const content=String(file.text).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
    if(contents.has(content))throw Error('The same export appears more than once. Use a separate export for each selected account.');
    contents.add(content);
    const p=parseAccountFile(file.text,file.account);
    if(p.cash===null)p.cash=finite(file.cashIfMissing,'actual cash for '+ACCOUNT_NAMES[file.account]+' (no CASH row in file)');
    if(Math.abs(p.cash*100-Math.round(p.cash*100))>1e-6)throw Error('Use cents for account cash.');
    parsed.push({...p,account:file.account,name:String(file.name||'TSV export'),cashSource:exportedCash(readPortfolioTSV(file.text))===null?'confirmed during import':'StocksCafe CASH row'});
  }
  const initial=state.accountImportVersion!==1;
  if(initial&&(accounts.size!==3||!['cash','srs','cpf'].every(a=>accounts.has(a))))throw Error('The first account-separated import needs all three files: Cash, SRS and CPF. This safely replaces old combined positions.');
  if(initial&&state.holdings.some(h=>h.accountType&&!Object.values(ACCOUNT_TYPES).includes(h.accountType)))throw Error('An existing holding uses another account type. Resolve its Cash/SRS/CPF classification before the first batch import.');
  const previous=state.holdings||[],cash={...state.cash},priceCache={...state.priceCache},cashImportInfo={...state.cashImportInfo};
  // A file replaces only its account. Other accounts, including exited rows,
  // retain their quantities and classifications exactly as previously saved.
  let holdings=initial?[]:previous.filter(h=>!accounts.has(h.importAccount||Object.keys(ACCOUNT_TYPES).find(a=>ACCOUNT_TYPES[a]===h.accountType)));
  const summary=[];
  for(const p of parsed){
    const accountHoldings=p.holdings.map(h=>{
      const exact=previous.find(x=>holdingKey(x)===holdingKey(h));
      const tags=[...new Set(previous.filter(x=>x.ticker===h.ticker&&x.portfolioType).map(x=>x.portfolioType))];
      const portfolioType=exact?.portfolioType||(tags.length===1?tags[0]:'');
      return {...exact,...h,portfolioType,unclassified:!portfolioType,lastImported:Date.parse(now)};
    });
    holdings.push(...accountHoldings);
    if(!initial){const incoming=new Set(accountHoldings.map(holdingKey));holdings.push(...previous.filter(h=>h.accountType===ACCOUNT_TYPES[p.account]&&!incoming.has(holdingKey(h))).map(h=>({...h,exited:true})));}
    const field={cash:'brokers',srs:'srs',cpf:'cpfIs'}[p.account];cash[field]=p.cash;
    cashImportInfo[field]={importedAt:now,filename:p.name,source:p.cashSource,account:p.account};
    for(const h of accountHoldings){
      const existing=priceCache[h.ticker];
      // Preserve shared quotes when files disagree, rather than letting file
      // order silently choose an account-specific price.
      if(parsed.some(q=>q.holdings.some(x=>x.ticker===h.ticker&&Math.abs(x.lastClose-h.lastClose)>1e-8)))throw Error('Closing prices differ between files for '+h.ticker+'. Export the accounts together from the same price date.');
      priceCache[h.ticker]={...existing,close:h.lastClose,name:h.name,timestamp:0};
    }
    summary.push({account:p.account,name:p.name,positions:accountHoldings.length,shares:accountHoldings.reduce((n,h)=>n+h.shares,0),cash:p.cash,dividends:rounded(accountHoldings.reduce((n,h)=>n+h.bDiv,0)),beforeCash:state.cash[field]});
  }
  for(const h of holdings){if(holdings.some(x=>x.ticker===h.ticker&&x.currency!==h.currency))throw Error('The same ticker has conflicting trading currencies across accounts.');}
  if(new Set(holdings.map(holdingKey)).size!==holdings.length)throw Error('Duplicate ticker/account positions remain. Review the account exports before importing.');
  return {patch:{holdings,cash,priceCache,cashImportInfo,accountImportVersion:1,lastImportDate:now},summary,initial};
}

export function editAccountHolding(holdings,key,patch) {
  const original=holdings.find(h=>holdingKey(h)===key);
  if(!original)throw Error('Holding no longer exists. Refresh the table.');
  if(original.importAccount&&patch.accountType!==undefined&&patch.accountType!==original.accountType)throw Error('An imported holding belongs to its selected source account. Correct the import mapping instead of changing its account tag.');
  const next=holdings.map(h=>holdingKey(h)===key?{...h,...patch}:h);
  if(new Set(next.map(holdingKey)).size!==next.length)throw Error('That ticker already has a position in the destination account.');
  return next;
}
export function combinedHolding(holdings,ticker) {
  const rows=holdings.filter(h=>h.ticker===ticker&&!h.exited);
  if(!rows.length)return undefined;
  const shares=rows.reduce((n,h)=>n+h.shares,0);
  return {...rows[0],shares,average_cost:shares?rows.reduce((n,h)=>n+h.shares*h.average_cost,0)/shares:0,bDiv:rows.reduce((n,h)=>n+(h.bDiv||0),0)};
}
