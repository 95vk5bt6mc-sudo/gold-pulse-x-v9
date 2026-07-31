export function normalizeCandle(item) {
  const candle = { datetime: String(item?.datetime || ""), open: Number(item?.open), high: Number(item?.high), low: Number(item?.low), close: Number(item?.close) };
  const valid = candle.datetime && [candle.open,candle.high,candle.low,candle.close].every(Number.isFinite) && candle.low <= Math.min(candle.open,candle.close) && candle.high >= Math.max(candle.open,candle.close);
  return valid ? candle : null;
}
export function normalizeSeries(values=[]) {
  const map = new Map();
  for (const value of values) { const candle = normalizeCandle(value); if (candle) map.set(candle.datetime,candle); }
  return [...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
}
