const required = ["TWELVE_DATA_API_KEY", "GOLD_PULSE_API_SECRET"];
const line = ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"];
let failed = false;
for (const name of required) {
  const ok = Boolean(process.env[name]);
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) failed = true;
}
for (const name of line) console.log(`${process.env[name] ? "✅" : "⚠️"} ${name}`);
console.log(`${process.env.LINE_TARGET_ID ? "✅" : "ℹ️"} LINE_TARGET_ID ${process.env.LINE_TARGET_ID ? "(one-to-one push)" : "(blank = broadcast)"}`);
if (failed) process.exitCode = 1;
