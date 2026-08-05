import fs from "node:fs";
import path from "node:path";

const required = [
  "app/page.js",
  "app/api/gold/route.js",
  "app/api/health/route.js",
  "app/api/scan/route.js",
  "lib/alerts.ts",
  "lib/config.ts",
  "lib/intelligence/five-minute-intelligence.js",
  "scripts/test-v11-intelligence.mjs",
  ".github/workflows/gold-pulse-scan.yml",
  ".env.example"
];

let bad = false;
for (const item of required) {
  const exists = fs.existsSync(path.join(process.cwd(), item));
  console.log(`${exists ? "✅" : "❌"} ${item}`);
  if (!exists) bad = true;
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (pkg.version !== "11.0.0") {
  console.error(`❌ package version must be 11.0.0 (found ${pkg.version})`);
  bad = true;
} else {
  console.log("✅ package version 11.0.0");
}

const route = fs.readFileSync("app/api/gold/route.js", "utf8");
for (const marker of [
  "analyzeFiveMinuteIntelligence",
  "applyFiveMinuteIntelligenceOverlay",
  "fiveMinuteIntelligence",
  "patternIntelligenceEnabled: true"
]) {
  if (!route.includes(marker)) {
    console.error(`❌ missing route marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ route marker: ${marker}`);
  }
}

const health = fs.readFileSync("app/api/health/route.js", "utf8");
if (!health.includes("patternIntelligence") || !health.includes("cron-job.org")) {
  console.error("❌ health diagnostics missing patternIntelligence or cron-job.org");
  bad = true;
} else {
  console.log("✅ health diagnostics expose patternIntelligence and cron-job.org");
}

const intelligence = fs.readFileSync("lib/intelligence/five-minute-intelligence.js", "utf8");
for (const marker of [
  "5M Candle DNA Weighted KNN",
  "REGULAR_BULLISH",
  "REGULAR_BEARISH",
  "BEARISH_TRAP",
  "BULLISH_TRAP",
  "CHOCH_BULLISH",
  "CHOCH_BEARISH",
  "applyFiveMinuteIntelligenceOverlay"
]) {
  if (!intelligence.includes(marker)) {
    console.error(`❌ missing intelligence marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ intelligence marker: ${marker}`);
  }
}

const workflow = fs.readFileSync(".github/workflows/gold-pulse-scan.yml", "utf8");
if (/\bschedule\s*:/.test(workflow)) {
  console.error("❌ GitHub automatic schedule must remain disabled; cron-job.org is primary");
  bad = true;
} else {
  console.log("✅ GitHub workflow remains manual-only");
}

if (bad) process.exit(1);

