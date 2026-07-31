import { normalizeSeries } from "../core/provider-contract";
export const providerId = "twelve-data";
export async function getCandles({ symbol="XAU/USD", interval="5min", outputsize=500, timezone="Asia/Bangkok", apiKey }) {
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY missing");
  const query = new URLSearchParams({symbol,interval,outputsize:String(outputsize),timezone,format:"JSON",apikey:apiKey});
  const controller = new AbortController(); const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(`https://api.twelvedata.com/time_series?${query}`,{cache:"no-store",signal:controller.signal});
    const payload=await response.json();
    if(!response.ok||payload.status==="error") throw new Error(payload.message||`Twelve Data HTTP ${response.status}`);
    return { provider:providerId, symbol, interval, candles:normalizeSeries(payload.values), fetchedAt:new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}
