export const STRATEGY_CATEGORIES = Object.freeze({anchor:'Anchor',core:'Core',selective:'Selective'});
// One-time defaults for portfolios saved before categories existed. An explicit
// empty map stays empty, including after imports, reloads and backup restore.
export const INITIAL_ANCHORS = Object.freeze(['GOOGL','META','AMZN','MSFT','NVDA','SPGI']);
const validSymbol=s=>typeof s==='string'&&/^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,39}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
export function normalizeStrategyCategories(categories){
  if(categories===undefined)return Object.fromEntries(INITIAL_ANCHORS.map(s=>[s,'anchor']));
  if(!categories||typeof categories!=='object'||Array.isArray(categories))throw Error('Invalid saved strategy categories.');
  const result={};
  for(const [symbol,category]of Object.entries(categories)){
    if(!validSymbol(symbol)||!Object.hasOwn(STRATEGY_CATEGORIES,category))throw Error('Invalid strategy category for '+symbol+'.');
    result[symbol]=category;
  }
  if(Object.values(result).filter(c=>c==='anchor').length>6)throw Error('Choose at most six Anchor companies.');
  return result;
}
export function categoryFor(categories,symbol){
  const map=normalizeStrategyCategories(categories);
  return Object.hasOwn(map,symbol)?map[symbol]:'';
}
export function chooseStrategyCategory(categories,symbol,category){
  if(!validSymbol(symbol))throw Error('Enter a valid ticker before choosing its category.');
  if(category!==''&&!Object.hasOwn(STRATEGY_CATEGORIES,category))throw Error('Choose Anchor, Core, Selective or Unassigned.');
  const next=normalizeStrategyCategories(categories);
  if(category)next[symbol]=category;else delete next[symbol];
  return normalizeStrategyCategories(next);
}
export function createStrategyCategorySelect(React){
  const h=React.createElement;
  return function StrategyCategorySelect({symbol,categories,onChange}){
    return h('select',{'aria-label':'Category for '+symbol,value:categoryFor(categories,symbol),
      title:'Shared by ticker across holdings and watchlist',disabled:!onChange,
      className:'strategy-category-select',onChange:e=>onChange?.(symbol,e.target.value),
      onClick:e=>e.stopPropagation(),onMouseDown:e=>e.stopPropagation(),onDragStart:e=>e.preventDefault()},
      h('option',{value:''},'Unassigned'),...Object.entries(STRATEGY_CATEGORIES).map(([value,label])=>h('option',{key:value,value},label)));
  };
}
export const categoryRank=category=>({anchor:0,core:1,selective:2}[category]??3);
export function selectCategoryRows(rows,categories,symbolKey,filter='all',sort='none'){
 const map=normalizeStrategyCategories(categories);
 const selected=rows.filter(row=>filter==='all'||(filter==='unassigned'?!map[row[symbolKey]]:map[row[symbolKey]]===filter));
 if(sort==='asc'||sort==='desc')selected.sort((a,b)=>{const ar=categoryRank(map[a[symbolKey]]),br=categoryRank(map[b[symbolKey]]);return ar===3||br===3?ar-br:(sort==='asc'?1:-1)*(ar-br);});
 return selected;
}
export function reconcileStrategyCategories(categories,holdings=[],watchlist=[]){
 const next=normalizeStrategyCategories(categories),active=new Set([...holdings.filter(h=>!h.exited).map(h=>h.ticker),...watchlist.map(w=>w.symbol)]);
 for(const symbol of Object.keys(next))if(!active.has(symbol))next[symbol]='selective';
 return next;
}
export function createCategoryControls(React){
 const h=React.createElement;
 return function CategoryControls({scope,filter='all',sort='none',onFilter,onSort}){
  return h('div',{className:'category-controls','aria-label':scope+' category controls'},
   h('label',null,'Category',h('select',{'aria-label':scope+' category filter',value:filter,onChange:e=>onFilter(e.target.value)},
    ...[['all','All'],...Object.entries(STRATEGY_CATEGORIES),['unassigned','Unassigned']].map(([value,label])=>h('option',{key:value,value},label)))),
   h('label',null,'Sort',h('select',{'aria-label':scope+' category sort',value:sort,onChange:e=>onSort(e.target.value)},
    ...[['none','Current order'],['asc','Anchor first'],['desc','Selective first']].map(([value,label])=>h('option',{key:value,value},label)))));
 };
}
