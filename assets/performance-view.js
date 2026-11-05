import {flowValue,number,selectedAccounts,snapshotValue,sourceSignature} from './performance-core.js?v=ytd-20261105';

export function performanceRange(history,{scope,basis,period,customStart='',customEnd,today}){
  let end=period==='custom'?customEnd:today,start=Object.keys(history.snapshots||{}).sort()[0]||end;
  if(period==='reconciled'){
    const coverage=selectedAccounts(scope).map(a=>history.coverage?.[a]?.[basis]||(basis==='broker'&&a!=='cash'?history.coverage?.[a]?.total:null));
    if(coverage.every(Boolean)){
      const from=coverage.map(c=>c.start).sort().at(-1),through=coverage.map(c=>c.end).sort()[0];
      if(from<=through){start=from;end=through;}
    }
  }else if(period==='YTD'){
    const year=Number(end.slice(0,4));
    start=String(year-1).padStart(4,'0')+'-12-31';
    const close=new Date(start+'T00:00:00Z'),weekday=close.getUTCDay();
    if((weekday===0||weekday===6)&&snapshotValue(history.snapshots?.[start]||{},scope,basis)===null){
      close.setUTCDate(close.getUTCDate()-(weekday===0?2:1));
      const lastFriday=close.toISOString().slice(0,10);
      const hasWeekendFlow=Object.values(history.flows||{}).some(f=>!f.voided&&f.date>lastFriday&&f.date<=start&&flowValue(f,scope,basis)!==0);
      if(!hasWeekendFlow&&snapshotValue(history.snapshots?.[lastFriday]||{},scope,basis)!==null)start=lastFriday;
    }
  }
  else if(['1M','3M','6M','1Y'].includes(period)){const d=new Date(end+'T00:00:00Z'),months=period==='1Y'?12:parseInt(period);d.setUTCMonth(d.getUTCMonth()-months);start=d.toISOString().slice(0,10);}
  else if(period==='custom')start=customStart||start;
  return [start,end];
}

export function cashParts(state,account) {
  if(account==='cash')return [
    {key:'broker',label:'Cash in broker (SGD)',value:number(state.cash.brokers)},
    {key:'bank',label:'Money set aside in bank (SGD)',value:number(state.cash.growth)+number(state.cash.dividend)}
  ];
  if(!['srs','cpf'].includes(account))throw Error('Choose an account.');
  return [{key:'cash',label:account==='srs'?'Actual SRS cash (SGD)':'Actual CPF investment cash (SGD; excludes OA)',value:number(account==='srs'?state.cash.srs:state.cash.cpfIs)}];
}
export function readCashParts(fd,account,prefix) {
  const keys=account==='cash'?['broker','bank']:['cash'];
  return keys.reduce((sum,key)=>sum+number(fd.get(prefix+'-'+key)),0);
}
export function snapshotProgress(history,scope,basis,start,end,state=null) {
  const accounts=selectedAccounts(scope),all=Object.keys(history.snapshots||{}).filter(date=>date>=start&&date<=end).sort();
  const dates=all.filter(date=>date>=start&&date<=end&&snapshotValue(history.snapshots[date],scope,basis)!==null);
  const latest=all.at(-1),missing=latest?accounts.filter(a=>snapshotValue(history.snapshots[latest],a,basis)===null):accounts;
  const paused=accounts.filter(a=>{const c=history.settings?.capture?.[a];return c&&(c.needsReconciliation||(state&&c.sourceSignature!==sourceSignature({holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}},a)));});
  const unknownCash=all.filter(date=>accounts.some(a=>history.snapshots[date]?.accounts?.[a]?.cashVerified===false));
  return {dates,latest,missing,unknownCash,paused,dailyEnabled:history.settings?.dailyEnabled===true,configured:accounts.every(a=>!!history.settings?.capture?.[a]),transactions:Object.keys(history.trades||{}).length};
}
