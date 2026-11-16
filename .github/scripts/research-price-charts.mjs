const validSymbol=s=>typeof s==='string' && /^[A-Z0-9][A-Z0-9.^=-]{0,29}$/i.test(s);
export async function refreshCharts(collection,data,reused,fetchHistory,now=new Date(),deadline=Infinity){
  const stored=Object.values(data.holdings||{});
  const holdings=stored.length?stored:Object.entries(data.classifications||{}).map(([ticker,fields])=>({...fields,ticker}));
  const symbols=[...new Set([...holdings.filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>h.ticker),
    ...(data.watchlist||[]).map(w=>w.symbol)].filter(validSymbol))];
  if(!symbols.length)return 0;
  const schedule=collection.doc('tickerChartSchedule');
  const previous=(await schedule.get()).data()?.nextCheck||{};
  const due=symbols.filter(s=>!(previous[s]>+now)).sort((a,b)=>(previous[a]||0)-(previous[b]||0));
  if(!due.length)return 0;
  const nextCheck=Object.fromEntries(symbols.filter(s=>previous[s]).map(s=>[s,previous[s]]));
  let updated=0;
  for(const symbol of due){
    if(Date.now()>=deadline)break;
    const history=reused.get(symbol) || await fetchHistory(symbol);
    const bars=history?.bars?.filter(b=>Date.parse(b.date)>=+now-200*86400000);
    const ref=collection.doc('tickerChart-'+symbol);
    const checkedAt=now.toISOString();
    if(bars?.length && history.instrument?.currency){
      await ref.set({symbol,checkedAt,currency:history.instrument.currency,source:history.history.source,
        points:bars.map(({date,close})=>({date,close})),unavailable:false});
      updated++;
      nextCheck[symbol]=+now+86400000;
    }else{
      await ref.set({symbol,checkedAt,unavailable:true},{merge:true});
      nextCheck[symbol]=+now+6*3600000;
    }
  }
  await schedule.set({nextCheck});
  return updated;
}
