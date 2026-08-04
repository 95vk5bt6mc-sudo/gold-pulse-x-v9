#!/usr/bin/env bash
set -Eeuo pipefail
say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f package.json ]] || fail "เปิด Terminal ที่ระดับเดียวกับ package.json ก่อน"
[[ -d .git ]] || fail "โฟลเดอร์นี้ไม่ใช่ Git repository"
CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
[[ "$CURRENT_VERSION" == "10.2.1" || "$CURRENT_VERSION" == "10.3.0" ]] || fail "รองรับ v10.2.1 เท่านั้น (พบ $CURRENT_VERSION)"
[[ "$CURRENT_VERSION" == "10.3.0" ]] && { ok "ระบบเป็น v10.3.0 อยู่แล้ว"; exit 0; }

DIRTY=$(git status --porcelain | grep -vE '^\?\? v103\.sh$|^ M v103\.sh$|^A  v103\.sh$|^ D v103\.sh$' || true)
[[ -z "$DIRTY" ]] || fail "มีไฟล์อื่นยังไม่ Commit:\n$DIRTY"

say "0/7 ซิงก์ main"
git pull --ff-only origin main || fail "git pull ไม่สำเร็จ"
if grep -Eq '^[[:space:]]*schedule:' .github/workflows/gold-pulse-scan.yml; then
  fail "GitHub schedule ยังเปิดอยู่ ต้องเหลือ workflow_dispatch เพื่อไม่ให้ซ้ำกับ cron-job.org"
fi

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=".git/GOLD-PULSE-before-v10.3-$STAMP.tar.gz"
say "1/7 สำรองระบบเดิม: $BACKUP"
tar -czf "$BACKUP" package.json README.md CHANGELOG.md .env.example \
  app/api/gold/route.js app/api/health/route.js app/api/scan/route.js \
  lib/config.ts lib/alerts.ts 2>/dev/null || true

say "2/7 ติดตั้ง Classic configuration"
cat > lib/config.ts <<'EOF_CONFIG'
export type LineDeliveryMode = "push" | "broadcast" | "disabled";
function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}
function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}
export function getRuntimeConfig() {
  const lineEnabled = booleanEnv("LINE_ALERTS_ENABLED", true);
  const hasLineToken = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const classicMode = booleanEnv("CLASSIC_98_PRO_MODE", true);
  const lineMode: LineDeliveryMode = !lineEnabled || !hasLineToken
    ? "disabled" : process.env.LINE_TARGET_ID ? "push" : "broadcast";
  return {
    version: "10.3.0",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode, alertsEnabled: lineEnabled, activeSignalMode: classicMode,
    classicMode, adaptiveMode: false,
    signalProfile: classicMode ? "CLASSIC_98_PRO" : "CUSTOM",
    alertMinProbability: integerEnv("ALERT_MIN_PROBABILITY", 61, 50, 90),
    alertMinScore: integerEnv("ALERT_MIN_SCORE", 58, 50, 95),
    confirmedMinProbability: integerEnv("CONFIRMED_MIN_PROBABILITY", 64, 55, 95),
    confirmedMinScore: integerEnv("CONFIRMED_MIN_SCORE", 62, 55, 98),
    opportunityMinProbability: integerEnv("OPPORTUNITY_MIN_PROBABILITY", 57, 50, 90),
    opportunityMinScore: integerEnv("OPPORTUNITY_MIN_SCORE", 62, 55, 98),
    scoutMinProbability: integerEnv("SCOUT_MIN_PROBABILITY", 59, 50, 90),
    scoutMinScore: integerEnv("SCOUT_MIN_SCORE", 66, 55, 98),
    pulseMinProbability: 99, pulseMinScore: 99,
    minimumDirectionalEdge: integerEnv("MINIMUM_DIRECTIONAL_EDGE", 10, 6, 30),
    minimumConfirmations: integerEnv("MINIMUM_CONFIRMATIONS", 2, 2, 4),
    scoutMinimumConfirmations: integerEnv("SCOUT_MINIMUM_CONFIRMATIONS", 3, 2, 4),
    deliverySlotMinutes: integerEnv("DELIVERY_SLOT_MINUTES", 30, 15, 60),
    dailyAlertCap: integerEnv("DAILY_ALERT_SAFETY_CAP", 24, 5, 48),
    riskHighBlocked: true, targetIsEstimateNotGuarantee: true,
    targetSignalIntervalMinutes: 30, technicalMinimumGapMinutes: 2,
    adaptiveStateConfigured: false, adaptiveStateRequired: false,
    adaptiveStateMode: "disabled-classic"
  } as const;
}
EOF_CONFIG

say "3/7 ติดตั้ง Classic alert gate"
cat > lib/alerts.ts <<'EOF_ALERTS'
import { getRuntimeConfig } from "./config";
import { sendLineText } from "./line";
type AnyRecord = Record<string, any>;
const numberText = (value: unknown, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
export function evaluateAlert(payload: AnyRecord) {
  const config = getRuntimeConfig();
  const d = payload?.tradeDecision || {};
  const probability = Number(d.targetProbability || 0);
  const score = Number(d.signalScore || d.entryQuality || 0);
  const direction = String(d.direction || "WAIT").toUpperCase();
  const tier = String(d.entryTier || "WAIT").toUpperCase();
  const confirmations = Number(d.confirmationCount || 0);
  const directionalEdge = Number(d?.probabilityMap?.directionalEdge || 0);
  const waitProbability = Number(d?.probabilityMap?.wait || 0);
  const opportunity = tier === "OPPORTUNITY";
  const scout = tier === "SCOUT";
  const confirmed = tier === "CONFIRMED" || tier === "STRONG";
  const pulse = tier === "PULSE";
  const minimumProbability = confirmed ? config.confirmedMinProbability :
    scout ? config.scoutMinProbability : opportunity ? config.opportunityMinProbability : config.alertMinProbability;
  const minimumScore = confirmed ? config.confirmedMinScore :
    scout ? config.scoutMinScore : opportunity ? config.opportunityMinScore : config.alertMinScore;
  const minimumConfirmations = scout ? config.scoutMinimumConfirmations : config.minimumConfirmations;
  const reasons: string[] = [];
  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  if (d?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (pulse) reasons.push("pulse-disabled-classic-mode");
  if (d?.qa?.checks?.riskAccepted === false) reasons.push("risk-high-blocked");
  if (probability < minimumProbability) reasons.push("probability-below-gate");
  if (score < minimumScore) reasons.push("score-below-gate");
  if (confirmations < minimumConfirmations) reasons.push("confirmations-below-gate");
  if ((opportunity || scout) && directionalEdge < config.minimumDirectionalEdge) reasons.push("directional-edge-below-gate");
  if (scout && waitProbability > 52) reasons.push("wait-probability-too-high-for-scout");
  if (d?.qa?.checks?.setupValid === false) reasons.push("setup-invalid");
  return { eligible: reasons.length === 0, reasons, probability, score, direction, tier,
    confirmations, directionalEdge, waitProbability,
    appliedGate: { tier, minimumProbability, minimumScore, minimumConfirmations }, config };
}
function fingerprint(payload: AnyRecord, slotMinutes: number): string {
  const d = payload?.tradeDecision || {};
  const slot = Math.floor(Date.now() / (slotMinutes * 60 * 1000));
  return ["gold-pulse-v10.3-classic", payload.symbol || "XAU/USD", slot, d.direction || "WAIT"].join("|");
}
export function buildSignalText(payload: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  return [
    `${icon} GOLD PULSE X v10.3 CLASSIC 9.8 PRO`, "",
    `${d.direction} · ${d.entryTier || "CONFIRMED"} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Confirmations ${Number(d.confirmationCount || 0)}/4 · Edge ${Number(d?.probabilityMap?.directionalEdge || 0)}`,
    `5M trend ${d.mainTrend || "—"} · Forecast ${d.forecastAgreement || "—"}`, "",
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · TP2 ${numberText(d?.takeProfit?.tp2)} · TP3 ${numberText(d?.takeProfit?.tp3)}`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward TP2 1:${numberText(d?.riskReward?.tp2)}`, "",
    "Classic 9.8 Pro: 5M trend + forecast first; PULSE disabled; no time-based relaxation.",
    "⚠️ Model estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว และไม่รับประกันกำไร",
    "⚠️ ตรวจราคาโบรกเกอร์ spread และจำกัดความเสี่ยงก่อนเข้า"
  ].join("\n");
}
export async function sendSignalAlert(payload: AnyRecord) {
  const evaluation = evaluateAlert(payload);
  if (!evaluation.eligible) return { sent: false, duplicate: false,
    reason: evaluation.reasons.join(",") || "not-eligible", evaluation };
  const result = await sendLineText(buildSignalText(payload), fingerprint(payload, evaluation.config.deliverySlotMinutes));
  return { sent: result.delivered, duplicate: result.duplicate,
    reason: result.ok ? (result.duplicate ? "slot-duplicate" : "sent") : result.detail || `line-http-${result.status}`,
    mode: result.mode, status: result.status, retryKey: result.retryKey, evaluation };
}
EOF_ALERTS

say "4/7 ปิด PULSE และทำ Opportunity/Scout ให้เข้มขึ้น"
python3 - <<'PY_PATCH'
from pathlib import Path
import json, re
p = Path("app/api/gold/route.js")
s = p.read_text()
s = s.replace('import { evaluatePulseFallback } from "../../../lib/core/pulse-engine";\n', '')
s = s.replace('version: "10.2.0"', 'version: "10.3.0"')
s = s.replace('trendProbabilityGap >= 8 &&', 'trendProbabilityGap >= 10 &&')
s = s.replace('trendDirectionalProbability >= 30 &&', 'trendDirectionalProbability >= 34 &&')
s = s.replace('trendDirectionalProbability >= waitProbability - 12 || trendProbabilityGap >= 14',
              'trendDirectionalProbability >= waitProbability - 8 || trendProbabilityGap >= 16')
s = s.replace('trendDirectionalProbability >= 22 &&', 'trendDirectionalProbability >= 28 &&')
s = s.replace('trendOppositeProbability - trendDirectionalProbability <= 10 &&',
              'trendOppositeProbability - trendDirectionalProbability <= 8 &&')
s = s.replace('waitProbability <= 55;', 'waitProbability <= 50;')
s = s.replace('directionalEdge >= 14 &&', 'directionalEdge >= 18 &&')
s = s.replace('leaderProbability >= 32 &&', 'leaderProbability >= 38 &&', 1)
s = s.replace('const rangeScout = mainTrend === "WAIT" &&',
              'const rangeScout = false && mainTrend === "WAIT" &&')
pattern = re.compile(r'\n  // v10\.2 ADAPTIVE QUALITY PULSE path:.*?\n  if \(forecastDirection === "WAIT"\) \{.*?\n  \}\n\n  const forecastConflict', re.S)
s, count = pattern.subn('\n  // v10.3 CLASSIC 9.8 PRO: PULSE fallback disabled.\\n\\n  const forecastConflict', s)
if count != 1:
    raise SystemExit(f"PULSE block match count={count}; หยุดเพื่อป้องกันไฟล์เสีย")
s = s.replace('let pulseFallback = false;', 'const pulseFallback = false;')
s = s.replace('let pulseSource = "NONE";', 'const pulseSource = "DISABLED_CLASSIC";')
s = s.replace('let pulseResult = null;', 'const pulseResult = null;')
s = s.replace('v10.2 ADAPTIVE QUALITY', 'v10.3 CLASSIC 9.8 PRO')
p.write_text(s)
pkg = json.loads(Path("package.json").read_text())
pkg["name"] = "gold-pulse-x-v10-3-classic-98-pro"
pkg["version"] = "10.3.0"
Path("package.json").write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")
for name in ("README.md", "FILELIST.txt"):
    q = Path(name)
    if q.exists():
        t = q.read_text().replace("v10.2.1", "v10.3.0")
        t = t.replace("ADAPTIVE QUALITY 30 LITE", "CLASSIC 9.8 PRO")
        t = t.replace("ADAPTIVE_QUALITY_30_LITE", "CLASSIC_98_PRO")
        q.write_text(t)
ch = Path("CHANGELOG.md")
if ch.exists():
    entry = (
        "# v10.3.0 — CLASSIC 9.8 PRO\n\n"
        "- Restores v9.8-style 5M trend and forecast-first logic.\n"
        "- Disables PULSE and time-based adaptive relaxation.\n"
        "- Tightens OPPORTUNITY and SCOUT evidence.\n"
        "- Uses cron-job.org every 5 minutes; no Redis required.\n"
        "- Uses LINE retry-key as a best-effort 30-minute delivery guard.\n"
        "- Signal count and profitability are not guaranteed.\n\n"
    )
    text = ch.read_text()
    if not text.startswith("# v10.3.0"):
        ch.write_text(entry + text)
PY_PATCH

say "5/7 ตรวจ Syntax, Static Check และ Build"
node --check app/api/gold/route.js
npm run check
npm run build

say "6/7 Commit และ Push"
git add -A
git reset -- v103.sh 2>/dev/null || true
git commit -m "Upgrade to v10.3 Classic 9.8 Pro"
git push origin main

say "7/7 ลบตัวติดตั้งชั่วคราว"
if [[ -f v103.sh ]]; then
  rm -f v103.sh
  git add -A
  git commit -m "Remove temporary v10.3 installer" || true
  git push origin main || true
fi

ok "SUCCESS: v10.3 CLASSIC 9.8 PRO pushed to GitHub."
printf '%s\n' \
  "รอ Vercel 1–3 นาที แล้วตรวจ /api/health" \
  "คาดหวัง version 10.3.0 และ signalProfile CLASSIC_98_PRO" \
  "cron-job.org ยังคงทุก 5 นาที ไม่ต้องแก้"
