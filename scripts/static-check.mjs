import fs from "node:fs";
import path from "node:path";

const required = [
  "app/page.js",
  "app/api/gold/route.js",
  "app/api/health/route.js",
  "app/api/scan/route.js",
  "app/api/notify/route.js",
  "lib/alerts.ts",
  "lib/line.ts",
  "lib/config.ts",
  "lib/core/pulse-engine.js",
  "lib/core/adaptive-quality.js",
  "lib/core/adaptive-state.ts",
  "scripts/test-v10.mjs",
  "scripts/test-v10-integration.mjs",
  "scripts/test-v10.2-adaptive.mjs",
  ".github/workflows/gold-pulse-scan.yml",
  ".env.example"
];

let bad = false;
for (const item of required) {
  const exists = fs.existsSync(path.join(process.cwd(), item));
  console.log(`${exists ? "✅" : "❌"} ${item}`);
  if (!exists) bad = true;
}

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
if (pkg.version !== "10.2.1") {
  console.error(`❌ package version must be 10.2.1 (found ${pkg.version})`);
  bad = true;
} else {
  console.log("✅ package version 10.2.1");
}

if (pkg.scripts?.prebuild || fs.existsSync(path.join(process.cwd(), "setup.cjs"))) {
  console.error("❌ Generator architecture detected");
  bad = true;
} else {
  console.log("✅ Real repository: no setup.cjs/prebuild generator");
}

const route = fs.readFileSync(path.join(process.cwd(), "app/api/gold/route.js"), "utf8");
for (const marker of [
  "evaluatePulseFallback",
  'entryTier = "PULSE"',
  "const tp1Distance = targetMove;",
  "targetProbability >= 63 && signalScore >= 58",
  "confirmationCount >= 3",
  "targetSignalIntervalMinutes: 30",
  "adaptiveCadence: true"
]) {
  if (!route.includes(marker)) {
    console.error(`❌ missing v10.2 route marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ route marker: ${marker}`);
  }
}

const alerts = fs.readFileSync(path.join(process.cwd(), "lib/alerts.ts"), "utf8");
for (const marker of [
  "evaluateAdaptiveCadence",
  "acquireAdaptiveLock",
  '"gold-pulse-v10.2.1"',
  "Adaptive quality"
]) {
  if (!alerts.includes(marker)) {
    console.error(`❌ missing adaptive alert marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ adaptive alert marker: ${marker}`);
  }
}
if (!alerts.includes("halfHourSlot") || !alerts.includes("memory-fallback")) {
  console.error("❌ missing no-Redis LINE idempotency slot");
  bad = true;
} else {
  console.log("✅ no-Redis LINE idempotency slot present");
}

const config = fs.readFileSync(path.join(process.cwd(), "lib/config.ts"), "utf8");
for (const marker of [
  'version: "10.2.1"',
  '"ADAPTIVE_QUALITY_30_LITE"',
  "adaptiveQualityFloor",
  "dailyAlertCap"
]) {
  if (!config.includes(marker)) {
    console.error(`❌ missing adaptive config marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ adaptive config marker: ${marker}`);
  }
}

const adaptiveState = fs.readFileSync(path.join(process.cwd(), "lib/core/adaptive-state.ts"), "utf8");
for (const marker of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "adaptive-state-not-configured"]) {
  if (!adaptiveState.includes(marker)) {
    console.error(`❌ missing adaptive state marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ adaptive state marker: ${marker}`);
  }
}

const workflow = fs.readFileSync(path.join(process.cwd(), ".github/workflows/gold-pulse-scan.yml"), "utf8");
if (/\bschedule\s*:/.test(workflow)) {
  console.error("❌ GitHub automatic schedule must stay disabled because cron-job.org is the primary scheduler");
  bad = true;
} else {
  console.log("✅ GitHub workflow is manual-only");
}

if (bad) process.exit(1);
