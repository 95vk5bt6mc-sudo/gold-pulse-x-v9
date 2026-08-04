#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f package.json ]] || fail "เปิด Terminal ที่ระดับเดียวกับ package.json ก่อน"
[[ -d .git ]] || fail "โฟลเดอร์นี้ไม่ใช่ Git repository"

CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
if [[ "$CURRENT_VERSION" == "10.3.1" ]]; then
  ok "ระบบเป็น v10.3.1 CLASSIC 9.8 PRO PLUS อยู่แล้ว"
  exit 0
fi
[[ "$CURRENT_VERSION" == "10.3.0" ]] || fail "ตัวอัปเดตนี้รองรับ v10.3.0 เท่านั้น (พบ $CURRENT_VERSION)"

DIRTY=$(git status --porcelain | grep -vE '^\?\? v1031\.sh$|^ M v1031\.sh$|^A  v1031\.sh$|^ D v1031\.sh$' || true)
[[ -z "$DIRTY" ]] || fail "มีไฟล์อื่นยังไม่ Commit กรุณา Commit หรือยกเลิกก่อน:\n$DIRTY"

say "1/7 ซิงก์ branch main ล่าสุด"
git pull --ff-only origin main

say "2/7 สำรองไฟล์เดิมไว้ใน .git"
STAMP=$(date +%Y%m%d-%H%M%S)
tar -czf ".git/GOLD-PULSE-before-v10.3.1-$STAMP.tar.gz" \
  package.json README.md CHANGELOG.md \
  app/api/gold/route.js app/api/health/route.js \
  lib/config.ts lib/alerts.ts 2>/dev/null || true

say "3/7 อัปเดต Classic 9.8 Pro Plus configuration"
cat > lib/config.ts <<'TS'
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
    ? "disabled"
    : process.env.LINE_TARGET_ID
      ? "push"
      : "broadcast";

  return {
    version: "10.3.1",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode,
    alertsEnabled: lineEnabled,
    activeSignalMode: classicMode,
    classicMode,
    adaptiveMode: false,
    signalProfile: classicMode ? "CLASSIC_98_PRO_PLUS" : "CUSTOM",

    // ใช้ชื่อ Environment Variable ชุดใหม่ เพื่อไม่ให้ค่าเก่า 80/70 จาก v10.2 มาทับระบบ Classic
    alertMinProbability: integerEnv("CLASSIC_BASE_MIN_PROBABILITY", 61, 55, 85),
    alertMinScore: integerEnv("CLASSIC_BASE_MIN_SCORE", 58, 52, 90),
    confirmedMinProbability: integerEnv("CLASSIC_CONFIRMED_MIN_PROBABILITY", 66, 60, 90),
    confirmedMinScore: integerEnv("CLASSIC_CONFIRMED_MIN_SCORE", 64, 58, 95),
    opportunityMinProbability: integerEnv("CLASSIC_OPPORTUNITY_MIN_PROBABILITY", 57, 52, 85),
    opportunityMinScore: integerEnv("CLASSIC_OPPORTUNITY_MIN_SCORE", 62, 56, 95),
    scoutMinProbability: integerEnv("CLASSIC_SCOUT_MIN_PROBABILITY", 59, 54, 88),
    scoutMinScore: integerEnv("CLASSIC_SCOUT_MIN_SCORE", 66, 60, 96),
    pulseMinProbability: 99,
    pulseMinScore: 99,
    minimumDirectionalEdge: integerEnv("CLASSIC_MINIMUM_DIRECTIONAL_EDGE", 10, 8, 25),
    minimumConfirmations: integerEnv("CLASSIC_MINIMUM_CONFIRMATIONS", 2, 2, 4),
    scoutMinimumConfirmations: integerEnv("CLASSIC_SCOUT_MINIMUM_CONFIRMATIONS", 3, 3, 4),

    rangeMinimumEdge: integerEnv("CLASSIC_RANGE_MINIMUM_EDGE", 14, 10, 30),
    mixedMinimumEdge: integerEnv("CLASSIC_MIXED_MINIMUM_EDGE", 12, 10, 30),
    counterTrendMinimumEdge: integerEnv("CLASSIC_COUNTER_TREND_MINIMUM_EDGE", 16, 12, 35),
    deliverySlotMinutes: integerEnv("CLASSIC_DELIVERY_SLOT_MINUTES", 30, 15, 60),

    riskHighBlocked: true,
    targetIsEstimateNotGuarantee: true,
    adaptiveStateConfigured: false,
    adaptiveStateRequired: false,
    adaptiveStateMode: "disabled-classic"
  } as const;
}
TS

say "4/7 อัปเดตตัวกรองแจ้งเตือน Market Context"
cat > lib/alerts.ts <<'TS'
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
  const mode = String(d.mode || "NONE").toUpperCase();
  const confirmations = Number(d.confirmationCount || 0);
  const directionalEdge = Number(d?.probabilityMap?.directionalEdge || 0);
  const waitProbability = Number(d?.probabilityMap?.wait || 0);
  const marketRegime = String(payload?.smartFree?.marketRegime || "MIXED").toUpperCase();

  const opportunity = tier === "OPPORTUNITY";
  const scout = tier === "SCOUT";
  const confirmed = tier === "CONFIRMED" || tier === "STRONG";
  const pulse = tier === "PULSE";

  const minimumProbability = confirmed
    ? config.confirmedMinProbability
    : scout
      ? config.scoutMinProbability
      : opportunity
        ? config.opportunityMinProbability
        : config.alertMinProbability;

  const minimumScore = confirmed
    ? config.confirmedMinScore
    : scout
      ? config.scoutMinScore
      : opportunity
        ? config.opportunityMinScore
        : config.alertMinScore;

  const minimumConfirmations = scout
    ? config.scoutMinimumConfirmations
    : config.minimumConfirmations;

  const reasons: string[] = [];
  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  if (d?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (pulse) reasons.push("pulse-disabled-classic-mode");
  if (d?.qa?.checks?.riskAccepted === false) reasons.push("risk-high-blocked");
  if (d?.qa?.checks?.setupValid === false) reasons.push("setup-invalid");
  if (probability < minimumProbability) reasons.push("probability-below-gate");
  if (score < minimumScore) reasons.push("score-below-gate");
  if (confirmations < minimumConfirmations) reasons.push("confirmations-below-gate");

  if ((opportunity || scout) && directionalEdge < config.minimumDirectionalEdge) {
    reasons.push("directional-edge-below-gate");
  }
  if (scout && waitProbability > 50) reasons.push("wait-probability-too-high-for-scout");

  // ตลาด Sideway/Mixed ต้องมีหลักฐานแข็งขึ้น แต่ CONFIRMED/STRONG ไม่ถูกลงโทษซ้ำ
  if (!confirmed && marketRegime === "RANGE") {
    if (directionalEdge < config.rangeMinimumEdge) reasons.push("range-edge-too-low");
    if (confirmations < 3) reasons.push("range-confirmations-too-low");
  }
  if (!confirmed && marketRegime === "MIXED") {
    if (directionalEdge < config.mixedMinimumEdge) reasons.push("mixed-edge-too-low");
    if (confirmations < 3) reasons.push("mixed-confirmations-too-low");
  }
  if (mode === "COUNTER_TREND") {
    if (directionalEdge < config.counterTrendMinimumEdge) reasons.push("counter-trend-edge-too-low");
    if (confirmations < 3) reasons.push("counter-trend-confirmations-too-low");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    tier,
    mode,
    marketRegime,
    confirmations,
    directionalEdge,
    waitProbability,
    appliedGate: {
      tier,
      minimumProbability,
      minimumScore,
      minimumConfirmations,
      minimumDirectionalEdge: opportunity || scout ? config.minimumDirectionalEdge : null
    },
    config
  };
}

function fingerprint(payload: AnyRecord, slotMinutes: number): string {
  const d = payload?.tradeDecision || {};
  const slot = Math.floor(Date.now() / (slotMinutes * 60 * 1000));
  return [
    "gold-pulse-v10.3.1-classic",
    payload.symbol || "XAU/USD",
    slot,
    d.direction || "WAIT"
  ].join("|");
}

export function buildSignalText(payload: AnyRecord, evaluation: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  return [
    `${icon} GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS`,
    "",
    `${d.direction} · ${d.entryTier || "CONFIRMED"} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Confirmations ${Number(d.confirmationCount || 0)}/4 · Edge ${Number(d?.probabilityMap?.directionalEdge || 0)}`,
    `Market ${evaluation.marketRegime} · 5M trend ${d.mainTrend || "—"}`,
    "",
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · TP2 ${numberText(d?.takeProfit?.tp2)} · TP3 ${numberText(d?.takeProfit?.tp3)}`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward TP2 1:${numberText(d?.riskReward?.tp2)}`,
    "",
    "Classic 9.8 Pro Plus: ใช้ 5M trend + forecast เป็นแกน, ปิด PULSE และเพิ่มตัวกรอง Sideway/Mixed/Counter-trend",
    "⚠️ Model estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว และไม่รับประกันกำไร",
    "⚠️ ตรวจราคาโบรกเกอร์ spread และจำกัดความเสี่ยงก่อนเข้า"
  ].join("\n");
}

export async function sendSignalAlert(payload: AnyRecord) {
  const evaluation = evaluateAlert(payload);
  if (!evaluation.eligible) {
    return {
      sent: false,
      duplicate: false,
      reason: evaluation.reasons.join(",") || "not-eligible",
      evaluation
    };
  }

  const result = await sendLineText(
    buildSignalText(payload, evaluation),
    fingerprint(payload, evaluation.config.deliverySlotMinutes)
  );

  return {
    sent: result.delivered,
    duplicate: result.duplicate,
    reason: result.ok
      ? (result.duplicate ? "slot-duplicate" : "sent")
      : result.detail || `line-http-${result.status}`,
    mode: result.mode,
    status: result.status,
    retryKey: result.retryKey,
    evaluation
  };
}
TS

say "5/7 อัปเดต Health และเวอร์ชันใน Gold API"
cat > app/api/health/route.js <<'JS'
import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const ready = config.marketDataConfigured &&
    config.apiSecretConfigured &&
    config.lineConfigured;

  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS",
    version: config.version,
    provider: config.provider,
    marketDataConfigured: config.marketDataConfigured,
    scanSecretConfigured: config.apiSecretConfigured,
    lineConfigured: config.lineConfigured,
    lineWebhookSecretConfigured: config.lineSecretConfigured,
    lineTargetConfigured: config.lineTargetConfigured,
    lineMode: config.lineMode,
    automaticLineAlerts: config.alertsEnabled,
    signalProfile: config.signalProfile,
    alertRules: {
      baseMinimumProbability: config.alertMinProbability,
      baseMinimumScore: config.alertMinScore,
      confirmedMinimumProbability: config.confirmedMinProbability,
      confirmedMinimumScore: config.confirmedMinScore,
      opportunityMinimumProbability: config.opportunityMinProbability,
      opportunityMinimumScore: config.opportunityMinScore,
      scoutMinimumProbability: config.scoutMinProbability,
      scoutMinimumScore: config.scoutMinScore,
      pulseDisabled: true,
      minimumDirectionalEdge: config.minimumDirectionalEdge,
      minimumConfirmations: config.minimumConfirmations,
      scoutMinimumConfirmations: config.scoutMinimumConfirmations,
      riskHighBlocked: true
    },
    classicQualityFilters: {
      adaptiveCadenceEnabled: false,
      pulseFallbackEnabled: false,
      rangeMinimumEdge: config.rangeMinimumEdge,
      mixedMinimumEdge: config.mixedMinimumEdge,
      counterTrendMinimumEdge: config.counterTrendMinimumEdge,
      deliveryGuardSlotMinutes: config.deliverySlotMinutes,
      persistentStateRequired: false,
      note: "Quality-first filtering. No signal is forced by time or target count."
    },
    scheduler: "cron-job.org | every 5 minutes | endpoint active 08:00-24:00 Asia/Bangkok",
    smartFree: {
      timezone: "Asia/Bangkok",
      activeHours: "08:00-24:00",
      scanIntervalMinutes: 5,
      plannedScansPerDay: 192,
      estimatedServerCreditsPerDay: 384,
      estimatedDashboardCreditsPerDay: 192,
      estimatedCombinedCreditsPerDay: 576,
      freeDailyCreditLimit: 800,
      estimatedReserveCredits: 224
    },
    checkedAt: new Date().toISOString()
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
JS

python3 - <<'PY'
from pathlib import Path
import json

p = Path("app/api/gold/route.js")
s = p.read_text()
s = s.replace('version: "10.3.0"', 'version: "10.3.1"')
s = s.replace('v10.3 CLASSIC 9.8 PRO', 'v10.3.1 CLASSIC 9.8 PRO PLUS')
p.write_text(s)

pkg = json.loads(Path("package.json").read_text())
pkg["name"] = "gold-pulse-x-v10-3-1-classic-98-pro-plus"
pkg["version"] = "10.3.1"
Path("package.json").write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")

ch = Path("CHANGELOG.md")
text = ch.read_text() if ch.exists() else ""
entry = """# v10.3.1 — CLASSIC 9.8 PRO PLUS

- Fixes stale v10.2 ALERT_MIN_* environment values overriding Classic thresholds.
- Uses dedicated CLASSIC_* environment keys with balanced built-in defaults.
- Adds RANGE, MIXED and COUNTER_TREND quality filters.
- Keeps v9.8 forecast-first logic and PULSE disabled.
- Keeps cron-job.org every 5 minutes and requires no Redis.
- Does not force a signal count or guarantee profitability.

"""
if not text.startswith("# v10.3.1"):
    ch.write_text(entry + text)
PY

say "6/7 ตรวจ Syntax, Static Check และ Production Build"
node --check app/api/gold/route.js
node --check app/api/health/route.js
npm run check
npm run build

say "7/7 Commit, Push และลบตัวติดตั้งชั่วคราว"
git add -A
git commit -m "Upgrade to v10.3.1 Classic 9.8 Pro Plus"
git push origin main

if git ls-files --error-unmatch v1031.sh >/dev/null 2>&1; then
  git rm -f v1031.sh
  git commit -m "Remove temporary v10.3.1 installer"
  git push origin main
else
  rm -f v1031.sh
fi

ok "SUCCESS: v10.3.1 CLASSIC 9.8 PRO PLUS pushed to GitHub."
printf '%s\n' \
  "รอ Vercel 1–3 นาที แล้วตรวจ /api/health" \
  "ต้องเห็น: version 10.3.1 | signalProfile CLASSIC_98_PRO_PLUS | scheduler cron-job.org"
