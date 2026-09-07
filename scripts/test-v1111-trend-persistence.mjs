import assert from "node:assert/strict";
import fs from "node:fs";
const s = fs.readFileSync("app/api/gold/route.js","utf8");
for (const m of [
  "function buildTrendPersistence(",
  "function applyTrendPersistenceHardGate(",
  "3x5m-not-confirmed",
  "3x5m-confirmed",
  "TREND PERSISTENCE HARD GATE - WAIT",
  'entryTier = "PERSISTENCE_BLOCK"',
  "const trendPersistence = buildTrendPersistence(m5Closed);",
  "const persistenceDecision = applyTrendPersistenceHardGate",
  "finalizeSignalDecision(persistenceDecision,"
]) assert.ok(s.includes(m), "missing: " + m);
assert.ok(s.includes("confirmedBars >= 3"));
assert.ok(s.includes('mtDir === dir'));
console.log("✅ v11.1.1 persistence source tests passed");
