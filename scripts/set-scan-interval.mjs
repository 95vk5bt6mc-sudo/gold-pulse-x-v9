import fs from "node:fs";
import path from "node:path";

const minutes = Number(process.argv[2]);
if (![5, 10, 15].includes(minutes)) {
  console.error("Usage: node scripts/set-scan-interval.mjs 5|10|15");
  process.exit(1);
}
const file = path.join(process.cwd(), ".github", "workflows", "gold-pulse-scan.yml");
let text = fs.readFileSync(file, "utf8");
const cron = minutes === 5 ? "3-59/5 8-23 * * *" : minutes === 10 ? "3-59/10 8-23 * * *" : "3-59/15 8-23 * * *";
text = text.replace(/cron:\s*"[^"]+"/, `cron: "${cron}"`);
fs.writeFileSync(file, text);
console.log(`GitHub Actions scan interval set to ${minutes} minutes during 08:00–24:00 Asia/Bangkok (${cron}, timezone Asia/Bangkok). Commit and push the workflow file.`);
