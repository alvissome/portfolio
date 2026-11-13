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
    return h('select',{'aria-label':'Buying category for '+symbol,value:categoryFor(categories,symbol),
      title:'Shared by ticker across holdings and watchlist',disabled:!onChange,
      className:'strategy-category-select',onChange:e=>onChange?.(symbol,e.target.value),
      onClick:e=>e.stopPropagation(),onMouseDown:e=>e.stopPropagation(),onDragStart:e=>e.preventDefault()},
      h('option',{value:''},'Unassigned'),...Object.entries(STRATEGY_CATEGORIES).map(([value,label])=>h('option',{key:value,value},label)));
  };
}
