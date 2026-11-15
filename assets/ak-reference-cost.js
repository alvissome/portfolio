export function akReferenceCost(record,action='buy',currency){
 const key=action==='sell'?'averageSellPrice':'averageCost';
 const entries=(record?.reference?.entries||[]).filter(e=>currency===e.currency&&Number(e[key])>0&&(action==='sell'?e.source==='closed_positions':['capital_gains','dividend'].includes(e.source))).sort((a,b)=>b.asOf.localeCompare(a.asOf));
 if(!entries.length)return {value:null,label:action==='sell'?'AK average sell price unavailable — sync the closed positions sheet':'AK average cost unavailable — sync active portfolio sheets'};
 const latest=entries.filter(e=>e.asOf===entries[0].asOf);
 if(latest.some(e=>Number(e[key])!==Number(latest[0][key])))return {value:null,label:'Conflicting AK reference costs require review'};
 return {value:Number(entries[0][key]),label:(action==='sell'?'AK average sell price':'AK average cost')+' · '+entries[0].asOf};
}
