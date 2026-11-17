const source='41b8e1e2-ba7f-81e3-8ac8-000ba354d2d4';
const rich=value=>(String(value||'').match(/[\s\S]{1,1000}/gu)||[]).map(content=>({text:{content}}));
async function notion(path,method,body){
  const response=await fetch('https://api.notion.com/v1/'+path,{method,signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+process.env.NOTION_PORTFOLIO_TOKEN,'Notion-Version':'2025-09-03','Content-Type':'application/json'},
    body:JSON.stringify(body)});
  if(!response.ok)throw Error('Notion HTTP '+response.status);
  return response.json();
}
export async function upsert(symbol,r,call=notion){
  const match=await call('data_sources/'+source+'/query','POST',{filter:{property:'Ticker',title:{equals:symbol}},page_size:2});
  if(match.results.length>1)throw Error('Duplicate ticker rows');
  const action={buy:'Buy',hold:'Hold',sell:'Sell'}[r.action];
  const properties={Ticker:{title:rich(symbol)},Action:{select:{name:action}},Stage:{rich_text:rich(r.stage.toUpperCase())},
    Quantity:{number:r.quantity},'Entry or sale price':{number:r.price},Currency:{rich_text:rich(r.currency)},
    Reviewed:{date:r.reviewed?{start:r.reviewed}:null},'Dashboard record':{rich_text:rich(r.record)}};
  if(properties['Dashboard record'].rich_text.length>100)throw Error('Review exceeds Notion limit');
  if(match.results.length)await call('pages/'+match.results[0].id,'PATCH',{properties});
  else await call('pages','POST',{parent:{type:'data_source_id',data_source_id:source},properties});
}
