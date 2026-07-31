const store=globalThis.__goldPulseV8State||{lastKey:null,lastSentAt:0,lastScanAt:null,lastResult:null};
globalThis.__goldPulseV8State=store;
export function signalKey(payload){ const d=payload?.tradeDecision||payload?.oneMinute?.analysis?.tradeDecision; return [d?.direction,d?.entryTier,Number(d?.entry||0).toFixed(2)].join(":"); }
export function canSend(key,cooldownMs=15*60*1000){ return Boolean(key)&&!(store.lastKey===key&&Date.now()-store.lastSentAt<cooldownMs); }
export function markSent(key){ store.lastKey=key; store.lastSentAt=Date.now(); }
export function markScan(result){ store.lastScanAt=new Date().toISOString(); store.lastResult=result; }
export function snapshot(){ return {...store}; }
