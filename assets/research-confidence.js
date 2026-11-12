import {compareSupportLevels} from './research-core.js';

/** Confidence describes a dated reconstruction, never investment success.
 * Exclusions and study month are private study policy, not ticker constants. */
export function assessBackdatedSupportFit({symbol,referenceSupports,calculatedSupports,referenceAsOf,asOf,studyMonth,
  excludedSymbols=[],technicalReviewed=false,nearbyCutoffsStable=false,modelVersion,modelGitSha=null}) {
  const base={symbol,studyMonth,referenceAsOf,asOf,modelVersion,modelGitSha,referenceKey:JSON.stringify([symbol,referenceAsOf,referenceSupports]),
    basis:'Backdated SL reconstruction',technicalReviewed,nearbyCutoffsStable};
  if(excludedSymbols.includes(symbol))return {...base,confidence:'excluded',reason:'Excluded from this study target.'};
  if(!/^\d{4}-\d{2}$/.test(studyMonth??'')||!referenceAsOf?.startsWith(studyMonth)||!Array.isArray(referenceSupports)||!referenceSupports.length)
    return {...base,confidence:'not_assessed',reason:'No eligible published levels in the selected study month.'};
  const gap=Math.abs(Date.parse(asOf)-Date.parse(referenceAsOf))/86400000;
  if(!Number.isFinite(gap)||gap>3)return {...base,confidence:'not_assessed',reason:'A backdated or nearby-session result is required.'};
  let fit;try{fit=compareSupportLevels(referenceSupports,calculatedSupports,.02);}catch{return {...base,confidence:'not_assessed',reason:'Support data needs review.'};}
  const fullFit=fit.missingCount===0&&fit.extraCount===0;
  const confidence=fullFit&&technicalReviewed&&nearbyCutoffsStable?'high':fit.matchedCount/fit.referenceCount>=.6?'mid':'low';
  return {...base,confidence,matchedCount:fit.matchedCount,referenceCount:fit.referenceCount,missingCount:fit.missingCount,extraCount:fit.extraCount,
    fullFit,tolerancePct:2,reason:confidence==='high'?'All levels and level count fit; technical explanation and nearby-session stability reviewed.':
      confidence==='mid'?'Most published levels fit; gaps or unverified selection rules remain.':'Insufficient backdated agreement with the published levels.'};
}
