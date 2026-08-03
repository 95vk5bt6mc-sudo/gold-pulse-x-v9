import fs from "node:fs";
import path from "node:path";

const required = [
  "app/page.js",
  "app/api/gold/route.js",
  "app/api/scan/route.js",
  "app/api/notify/route.js",
  "lib/alerts.ts",
  "lib/line.ts",
  "lib/core/pulse-engine.js",
  "scripts/test-v10.mjs",
  "scripts/test-v10-integration.mjs",
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
if (pkg.version !== "10.0.0") {
  console.error(`❌ package version must be 10.0.0 (found ${pkg.version})`);
  bad = true;
} else {
  console.log("✅ package version 10.0.0");
}

if (pkg.scripts?.prebuild || fs.existsSync(path.join(process.cwd(), "setup.cjs"))) {
  console.error("❌ Generator architecture detected");
  bad = true;
} else {
  console.log("✅ Real repository: no setup.cjs/prebuild generator");
}

const route = fs.readFileSync(path.join(process.cwd(), "app/api/gold/route.js"), "utf8");
for (const marker of ["evaluatePulseFallback", 'entryTier = "PULSE"', "const tp1Distance = targetMove;"]) {
  if (!route.includes(marker)) {
    console.error(`❌ missing v10 route marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ route marker: ${marker}`);
  }
}

if (bad) process.exit(1);
