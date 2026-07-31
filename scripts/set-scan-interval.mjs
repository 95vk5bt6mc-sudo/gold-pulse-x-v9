import fs from "node:fs";
import path from "node:path";

const minutes = Number(process.argv[2]);
if (![5, 10, 15].includes(minutes)) {
  console.error("Usage: node scripts/set-scan-interval.mjs 5|10|15");
  process.exit(1);
}
const file = path.join(process.cwd(), ".github", "workflows", "gold-pulse-scan.yml");
let text = fs.readFileSync(file, "utf8");
const cron = minutes === 5 ? "3-59/5 * * * *" : minutes === 10 ? "3-59/10 * * * *" : "3-59/15 * * * *";
text = text.replace(/cron:\s*"[^"]+"/, `cron: "${cron}"`);
fs.writeFileSync(file, text);
console.log(`GitHub Actions scan interval set to ${minutes} minutes (${cron}). Commit and push the workflow file.`);
