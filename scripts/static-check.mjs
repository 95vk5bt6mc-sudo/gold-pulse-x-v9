import fs from "node:fs";
import path from "node:path";

const required = [
  "app/page.js", "app/api/gold/route.js", "app/api/scan/route.js",
  "app/api/notify/route.js", "lib/alerts.ts", "lib/line.ts",
  ".github/workflows/gold-pulse-scan.yml", ".env.example"
];
let bad = false;
for (const item of required) {
  const exists = fs.existsSync(path.join(process.cwd(), item));
  console.log(`${exists ? "✅" : "❌"} ${item}`);
  if (!exists) bad = true;
}
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
if (pkg.scripts?.prebuild || fs.existsSync(path.join(process.cwd(), "setup.cjs"))) {
  console.error("❌ Generator architecture detected");
  bad = true;
} else {
  console.log("✅ Real repository: no setup.cjs/prebuild generator");
}
if (bad) process.exit(1);
