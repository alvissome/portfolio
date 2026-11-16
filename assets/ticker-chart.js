export function chartWindow(points,range){
  if(range==='5D')return points.slice(-5);
  if(!points.length)return [];
  const end=new Date(points.at(-1).date+'T00:00:00Z'),day=end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth()-(range==='1M'?1:6));
  const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
  end.setUTCDate(Math.min(day,last));
  return points.filter(p=>p.date>=end.toISOString().slice(0,10));
}

export function openPriceChart(button,load){
  const symbol=button.dataset.priceChart,doc=button.ownerDocument;
  const dialog=doc.createElement('dialog');
  dialog.className='ticker-chart';
  dialog.setAttribute('aria-label',symbol+' price history');
  dialog.innerHTML='<header><strong></strong><button type="button" aria-label="Close price chart">×</button></header><p data-status role="status">Loading daily closes…</p><section hidden><nav aria-label="Chart period"></nav><p data-performance></p><svg viewBox="0 0 400 145" role="img"></svg><div class="chart-dates"><span></span><span></span></div><input type="range" min="0" aria-label="Inspect daily closing price"><output></output><small></small></section>';
  const get=s=>dialog.querySelector(s);
  get('strong').textContent=symbol+' price history';
  get('button').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{dialog.remove();if(button.isConnected)button.focus();},{once:true});
  doc.body.append(dialog);
  dialog.showModal();
  const number=new Intl.NumberFormat('en-SG',{maximumFractionDigits:4});
  const date=d=>new Intl.DateTimeFormat('en-SG',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(d+'T00:00:00Z'));
  Promise.resolve().then(()=>load(symbol)).then(history=>{
    if(!dialog.isConnected)return;
    const points=(history?.points||[]).filter(p=>Number.isFinite(p.close)&&p.close>0&&/^\d{4}-\d{2}-\d{2}$/.test(p.date));
    if(!points.length){
      get('[data-status]').textContent=history?.unavailable?'Daily prices are unavailable for this listing. The worker will retry.':'Waiting for the first price history. Check again after the research worker runs.';
      return;
    }
    const latest=points.at(-1);
    get('[data-status]').textContent='Latest close '+date(latest.date)+(history.unavailable?' · Last refresh failed. Showing saved prices.':'');
    get('section').hidden=false;
    get('small').textContent=history.source+' · Daily closes in '+history.currency;
    const svg=get('svg'),slider=get('input'),tabs=get('nav');
    for(const period of ['5D','1M','6M']){
      const tab=doc.createElement('button');tab.type='button';tab.textContent=period;
      tab.onclick=()=>draw(period);tabs.append(tab);
    }
    function draw(period){
      for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab.textContent===period));
      const rows=chartWindow(points,period),count=rows.length;
      const prices=rows.map(p=>p.close),low=Math.min(...prices),high=Math.max(...prices);
      const x=i=>count===1?200:5+i*390/(count-1);
      const y=i=>high===low?70:134-(prices[i]-low)*120/(high-low);
      const change=latest.close-prices[0],pct=change/prices[0]*100,sign=change>0?'+':'';
      get('[data-performance]').textContent=number.format(latest.close)+' '+history.currency+'  ·  '+(count<2?'One available close':sign+number.format(change)+' ('+sign+pct.toFixed(2)+'%)');
      svg.style.color=change<0?'#b83d43':'#15815b';
      svg.setAttribute('aria-label',symbol+' closing prices from '+date(rows[0].date)+' to '+date(latest.date));
      const coordinates=rows.map((_,i)=>x(i)+','+y(i)).join(' ');
      svg.innerHTML='<polygon fill="currentColor" opacity=".08" points="'+x(0)+',144 '+coordinates+' '+x(count-1)+',144"/><polyline fill="none" stroke="currentColor" stroke-width="2" points="'+coordinates+'"/><circle r="4" fill="currentColor"/>';
      get('.chart-dates span').textContent=date(rows[0].date);get('.chart-dates span:last-child').textContent=date(latest.date);
      slider.max=count-1;slider.disabled=count<2;
      function inspect(i){
        slider.value=i;const label=date(rows[i].date)+' · '+number.format(prices[i])+' '+history.currency;
        slider.setAttribute('aria-valuetext',label);get('output').textContent=label;
        const marker=get('circle');marker.setAttribute('cx',x(i));marker.setAttribute('cy',y(i));
      }
      slider.oninput=()=>inspect(Number(slider.value));
      svg.onpointermove=svg.onpointerdown=e=>{
        const box=svg.getBoundingClientRect(),fraction=((e.clientX-box.left)/box.width*400-5)/390;
        inspect(Math.max(0,Math.min(count-1,Math.round(fraction*(count-1)))));
      };
      inspect(count-1);
    }
    draw('6M');
  }).catch(()=>{get('[data-status]').textContent='Could not load saved prices. Reopen the chart to retry.';});
  return dialog;
}
