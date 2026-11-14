const prefixes={USD:'US$',SGD:'S$',HKD:'HK$',AUD:'A$',CAD:'C$',NZD:'NZ$',GBP:'£',EUR:'€',JPY:'¥',CNY:'CN¥'};
export function money(value,currency='SGD'){
 if(value==null||!Number.isFinite(Number(value)))return '—';
 return (prefixes[currency]||currency+' $')+Number(value).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function amount(value){
 if(value==null||String(value).trim()==='')return null;
 const raw=String(value).trim().replace(/^(?:[A-Za-z]{0,3}[$£€¥]|[A-Z]{3}\s+[$£€¥]?)\s*/,'').replace(/,/g,'');
 return /^\d+(?:\.\d*)?$/.test(raw)&&Number.isFinite(Number(raw))?Number(raw):null;
}
export const quantityText=value=>value==null||!Number.isFinite(value)?'':value.toLocaleString('en-SG',{maximumFractionDigits:0});
