#!/usr/bin/env bash
set -Eeuo pipefail

SELF="$(basename "$0")"
LOG="/tmp/gold-pulse-r21-build.log"
FILES=(
  "lib/line.ts"
  "lib/alerts.ts"
  "app/api/notify/route.js"
  "app/api/health/route.js"
  ".env.example"
  "CHANGELOG.md"
)

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

rollback(){
  code=$?
  if [[ $code -ne 0 ]]; then
    echo ""
    echo "⚠️ R2.1 ไม่ผ่าน — กำลังคืนไฟล์เดิม"
    git restore --source=HEAD -- "${FILES[@]}" 2>/dev/null || true
    rm -f BUILD-REPORT-v11.0-R2.1-LINE-SMART-QUOTA-GUARD.md
    echo "✅ Rollback complete — ยังไม่ได้ commit/push"
  fi
}
trap rollback EXIT

[[ -d .git ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"

say "1/9 ตรวจ main และ local changes"
git fetch origin main
OTHER="$(git status --porcelain | grep -vF "$SELF" || true)"
[[ -z "$OTHER" ]] || { git status --short; fail "มี local changes อื่นค้างอยู่"; }

say "2/9 ติดตั้ง LINE Smart Monthly Quota Guard"
cat > lib/line.ts <<'EOF'
import crypto from "node:crypto";

export type LinePriority = "strong" | "confirmed" | "test";

export interface LineQuotaSnapshot {
  checked: boolean;
  limited: boolean;
  monthlyLimit: number | null;
  totalUsage: number | null;
  remaining: number | null;
  reserve: number;
  businessDaysTotal: number;
  businessDaysElapsed: number;
  businessDaysLeft: number;
  cumulativeBudget: number | null;
  budgetHeadroom: number | null;
  dailyUsed: number | null;
  remainingPercent: number | null;
  survivalMode: boolean;
  sourceStatus: {
    quota: number | null;
    consumption: number | null;
    daily: number | null;
  };
}

export interface LineSendResult {
  ok: boolean;
  delivered: boolean;
  duplicate: boolean;
  mode: "push" | "broadcast" | "disabled";
  status: number;
  retryKey?: string;
  requestId?: string | null;
  acceptedRequestId?: string | null;
  detail?: string;
  guardReason?: string;
  quota?: LineQuotaSnapshot;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function bangkokDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    ymd: `${map.year}${map.month}${map.day}`
  };
}

function businessDayProgress(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0;
  let elapsed = 0;
  for (let current = 1; current <= lastDay; current += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, current)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      total += 1;
      if (current <= day) elapsed += 1;
    }
  }
  return {
    total: Math.max(1, total),
    elapsed,
    left: Math.max(1, total - elapsed + 1)
  };
}

async function getJson(url: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body };
  } catch {
    return { status: null, ok: false, body: {} };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLineQuotaSnapshot(
  mode: "push" | "broadcast" | "disabled" = "push"
): Promise<LineQuotaSnapshot> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const reserve = integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 30, 0, 10000);
  const date = bangkokDateParts();
  const businessDays = businessDayProgress(date.year, date.month, date.day);

  if (!token || mode === "disabled") {
    return {
      checked: false,
      limited: false,
      monthlyLimit: null,
      totalUsage: null,
      remaining: null,
      reserve,
      businessDaysTotal: businessDays.total,
      businessDaysElapsed: businessDays.elapsed,
      businessDaysLeft: businessDays.left,
      cumulativeBudget: null,
      budgetHeadroom: null,
      dailyUsed: null,
      remainingPercent: null,
      survivalMode: false,
      sourceStatus: { quota: null, consumption: null, daily: null }
    };
  }

  const dailyEndpoint = mode === "broadcast"
    ? `https://api.line.me/v2/bot/message/delivery/broadcast?date=${date.ymd}`
    : `https://api.line.me/v2/bot/message/delivery/push?date=${date.ymd}`;

  const [quotaResponse, consumptionResponse, dailyResponse] = await Promise.all([
    getJson("https://api.line.me/v2/bot/message/quota", token),
    getJson("https://api.line.me/v2/bot/message/quota/consumption", token),
    getJson(dailyEndpoint, token)
  ]);

  const limited = quotaResponse.ok && quotaResponse.body?.type === "limited";
  const monthlyLimit = limited && Number.isFinite(Number(quotaResponse.body?.value))
    ? Number(quotaResponse.body.value)
    : null;
  const totalUsage = consumptionResponse.ok && Number.isFinite(Number(consumptionResponse.body?.totalUsage))
    ? Number(consumptionResponse.body.totalUsage)
    : null;
  const dailyUsed = dailyResponse.ok && dailyResponse.body?.status === "ready" && Number.isFinite(Number(dailyResponse.body?.success))
    ? Number(dailyResponse.body.success)
    : null;
  const remaining = monthlyLimit != null && totalUsage != null
    ? Math.max(0, monthlyLimit - totalUsage)
    : null;
  const standardPool = monthlyLimit == null ? null : Math.max(0, monthlyLimit - reserve);
  const cumulativeBudget = standardPool == null
    ? null
    : Math.floor(standardPool * (businessDays.elapsed / businessDays.total));
  const budgetHeadroom = cumulativeBudget != null && totalUsage != null
    ? Math.max(0, cumulativeBudget - totalUsage)
    : null;
  const remainingPercent = remaining != null && monthlyLimit != null && monthlyLimit > 0
    ? Math.round((remaining / monthlyLimit) * 1000) / 10
    : null;
  const survivalMode = remaining != null && (
    remaining <= reserve || (remainingPercent != null && remainingPercent <= 10)
  );

  return {
    checked: quotaResponse.ok && consumptionResponse.ok,
    limited,
    monthlyLimit,
    totalUsage,
    remaining,
    reserve,
    businessDaysTotal: businessDays.total,
    businessDaysElapsed: businessDays.elapsed,
    businessDaysLeft: businessDays.left,
    cumulativeBudget,
    budgetHeadroom,
    dailyUsed,
    remainingPercent,
    survivalMode,
    sourceStatus: {
      quota: quotaResponse.status,
      consumption: consumptionResponse.status,
      daily: dailyResponse.status
    }
  };
}

function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {
  if (!snapshot.checked || !snapshot.limited || snapshot.remaining == null) {
    return { allowed: true, reason: "quota-unlimited-or-unavailable" };
  }
  if (snapshot.remaining <= 0) {
    return { allowed: false, reason: "monthly-quota-exhausted" };
  }
  if (priority === "strong") {
    return { allowed: true, reason: snapshot.survivalMode ? "strong-reserve" : "strong-priority" };
  }
  if (snapshot.survivalMode || snapshot.remaining <= snapshot.reserve) {
    return { allowed: false, reason: "reserve-protected" };
  }
  if (snapshot.budgetHeadroom != null && snapshot.budgetHeadroom <= 0) {
    return { allowed: false, reason: "pace-budget-used" };
  }
  if (priority === "test") {
    if (snapshot.remainingPercent != null && snapshot.remainingPercent <= 20) {
      return { allowed: false, reason: "test-reserve-protected" };
    }
    if (snapshot.budgetHeadroom != null && snapshot.budgetHeadroom < 2) {
      return { allowed: false, reason: "test-budget-protected" };
    }
  }
  return { allowed: true, reason: "within-paced-budget" };
}

function deterministicUuid(seed: string): string {
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function postOnce(url: string, token: string, retryKey: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isMonthlyLimit(status: number, detail: string) {
  return status === 429 && /monthly limit|free messages|additional messages/i.test(detail || "");
}

export async function sendLineText(
  text: string,
  retrySeed?: string,
  options: { priority?: LinePriority } = {}
): Promise<LineSendResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target = process.env.LINE_TARGET_ID;
  const enabled = !["0", "false", "off", "no"].includes(String(process.env.LINE_ALERTS_ENABLED || "true").toLowerCase());
  if (!enabled || !token) {
    return { ok: false, delivered: false, duplicate: false, mode: "disabled", status: 503, detail: "LINE is not configured or disabled" };
  }

  const retryKey = retrySeed ? deterministicUuid(retrySeed) : crypto.randomUUID();
  const mode = target ? "push" : "broadcast";
  const priority = options.priority || "confirmed";
  const quota = await getLineQuotaSnapshot(mode);
  const guard = quotaDecision(quota, priority);
  if (!guard.allowed) {
    return {
      ok: false,
      delivered: false,
      duplicate: false,
      mode,
      status: 429,
      retryKey,
      detail: `LINE quota guard blocked: ${guard.reason}`,
      guardReason: guard.reason,
      quota
    };
  }

  const url = target
    ? "https://api.line.me/v2/bot/message/push"
    : "https://api.line.me/v2/bot/message/broadcast";
  const body = target
    ? { to: target, messages: [{ type: "text", text }], notificationDisabled: false }
    : { messages: [{ type: "text", text }], notificationDisabled: false };

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await postOnce(url, token, retryKey, body);
      const detail = await response.text();
      const duplicate = response.status === 409;
      if (response.ok || duplicate) {
        return {
          ok: true,
          delivered: response.ok,
          duplicate,
          mode,
          status: response.status,
          retryKey,
          requestId: response.headers.get("x-line-request-id"),
          acceptedRequestId: response.headers.get("x-line-accepted-request-id"),
          detail: detail || undefined,
          guardReason: guard.reason,
          quota
        };
      }

      lastError = detail || `LINE HTTP ${response.status}`;
      if (isMonthlyLimit(response.status, lastError)) {
        const refreshedQuota = await getLineQuotaSnapshot(mode);
        return {
          ok: false,
          delivered: false,
          duplicate: false,
          mode,
          status: 429,
          retryKey,
          detail: lastError,
          guardReason: "monthly-limit-or-reservation",
          quota: refreshedQuota
        };
      }
      if (response.status < 500 && response.status !== 429) {
        return {
          ok: false,
          delivered: false,
          duplicate: false,
          mode,
          status: response.status,
          retryKey,
          detail: lastError,
          guardReason: guard.reason,
          quota
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "LINE request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return {
    ok: false,
    delivered: false,
    duplicate: false,
    mode,
    status: 502,
    retryKey,
    detail: lastError,
    guardReason: guard.reason,
    quota
  };
}
EOF

say "3/9 เชื่อม priority: STRONG / CONFIRMED / TEST"
python3 - <<'PY'
from pathlib import Path

p = Path("lib/alerts.ts")
s = p.read_text()
old = '''  const result = await sendLineText(\n    buildSignalText(payload, evaluation),\n    fingerprint(payload, evaluation.config.deliverySlotMinutes)\n  );'''
new = '''  const priority = evaluation.tier === "STRONG" ? "strong" : "confirmed";\n  const result = await sendLineText(\n    buildSignalText(payload, evaluation),\n    fingerprint(payload, evaluation.config.deliverySlotMinutes),\n    { priority }\n  );'''
if old not in s:
    raise SystemExit("alerts.ts ไม่ตรงกับ R2 ที่คาดไว้")
s = s.replace(old, new, 1)
old2 = '''    retryKey: result.retryKey,\n    evaluation'''
new2 = '''    retryKey: result.retryKey,\n    guardReason: result.guardReason || null,\n    quota: result.quota || null,\n    evaluation'''
if old2 not in s:
    raise SystemExit("alerts result block ไม่ตรง")
s = s.replace(old2, new2, 1)
p.write_text(s)

p = Path("app/api/notify/route.js")
s = p.read_text()
old = '  const result = await sendLineText(textFor(body), `manual-test|${Date.now()}|${body.side}`);'
new = '  const result = await sendLineText(textFor(body), `manual-test|${Date.now()}|${body.side}`, { priority: "test" });'
if old not in s:
    raise SystemExit("notify sendLineText block ไม่ตรง")
s = s.replace(old, new, 1)
old2 = '''    status: result.status,\n    message: result.ok ? "LINE request accepted" : result.detail || "LINE request failed"\n  }, { status: result.ok ? 200 : 502 });'''
new2 = '''    status: result.status,\n    guardReason: result.guardReason || null,\n    quota: result.quota || null,\n    message: result.ok ? "LINE request accepted" : result.detail || "LINE request failed"\n  }, { status: result.ok ? 200 : (result.status === 429 ? 429 : 502) });'''
if old2 not in s:
    raise SystemExit("notify response block ไม่ตรง")
s = s.replace(old2, new2, 1)
p.write_text(s)
PY

say "4/9 เพิ่ม Health metadata และ env default"
python3 - <<'PY'
from pathlib import Path

p = Path("app/api/health/route.js")
s = p.read_text()
needle = '    decisionPolicy: {'
block = '''    lineQuotaGuard: {\n      enabled: true,\n      version: "R2.1-SMART-QUOTA-1",\n      monthlyReserveDefault: 30,\n      pacing: "business-day cumulative budget",\n      strongUsesReserve: true,\n      confirmedUsesPacedBudget: true,\n      manualTestPriority: "lowest",\n      monthlyLimitRetry: false\n    },\n'''
if 'version: "R2.1-SMART-QUOTA-1"' not in s:
    if needle not in s:
        raise SystemExit("health marker ไม่พบ")
    s = s.replace(needle, block + needle, 1)
p.write_text(s)

p = Path(".env.example")
s = p.read_text()
needle = 'LINE_ALERTS_ENABLED=true\n'
insert = '''LINE_ALERTS_ENABLED=true\n# R2.1: reserve messages for STRONG signals near monthly quota exhaustion.\nLINE_MONTHLY_RESERVE_MESSAGES=30\n'''
if 'LINE_MONTHLY_RESERVE_MESSAGES=' not in s:
    if needle not in s:
        raise SystemExit("LINE_ALERTS_ENABLED marker ไม่พบ")
    s = s.replace(needle, insert, 1)
p.write_text(s)

p = Path("CHANGELOG.md")
s = p.read_text()
entry = '''## v11.0 R2.1 — LINE Smart Quota Guard\n- Reads LINE monthly quota and consumption before push/broadcast delivery.\n- Paces CONFIRMED alerts across Bangkok business days using cumulative monthly budget.\n- Reserves 30 messages by default for STRONG alerts near quota exhaustion.\n- Manual LIVE TEST uses lowest priority and is blocked before reserve is consumed.\n- Stops retrying immediately when LINE reports monthly-limit exhaustion/reservation.\n- Returns quota/guard diagnostics instead of masking quota exhaustion as generic 502.\n- Signal Engine R2 decision logic is unchanged.\n\n'''
if '## v11.0 R2.1 — LINE Smart Quota Guard' not in s:
    s = entry + s
p.write_text(s)
PY

cat > BUILD-REPORT-v11.0-R2.1-LINE-SMART-QUOTA-GUARD.md <<'EOF'
# GOLD PULSE X v11.0 R2.1 — LINE SMART QUOTA GUARD

## Scope
LINE delivery layer only. Signal Engine R2 is unchanged.

## Behavior
- Reads official LINE current-month target limit and approximate monthly consumption.
- Uses a cumulative business-day pacing budget in Asia/Bangkok.
- Default reserve: 30 messages for STRONG signals.
- CONFIRMED signals respect pacing and reserve protection.
- Manual LIVE TEST is lowest priority and cannot consume protected reserve.
- STRONG can use the protected reserve while any quota remains.
- When LINE returns monthly-limit 429, do not retry the same rejected request three times.
- LINE 5xx/timeouts still use the existing safe X-Line-Retry-Key retry behavior.

## Notes
LINE monthly consumption returned by the API is approximate. LINE itself remains the source of truth for whether a send is accepted.
No extra paid services, databases, API keys or packages are added.
EOF

say "5/9 Syntax / TypeScript"
node --check app/api/notify/route.js
node --check app/api/health/route.js
./node_modules/.bin/tsc --noEmit --pretty false

say "6/9 Existing R2 regression tests"
node scripts/test-v11-r2-signal-policy.mjs
node scripts/test-v11-intelligence.mjs
node scripts/test-v11-r1-five-candle-truth.mjs
node scripts/static-check.mjs

say "7/9 Production build"
rm -rf .next
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=2304"
if ! timeout 1200s ./node_modules/.bin/next build --webpack >"$LOG" 2>&1; then
  tail -n 120 "$LOG" || true
  fail "Production build ไม่ผ่าน"
fi
ok "Production Build PASS"

say "8/9 Commit / Push"
if git ls-files --error-unmatch "$SELF" >/dev/null 2>&1; then
  git rm -f -- "$SELF" >/dev/null
fi

git add \
  lib/line.ts \
  lib/alerts.ts \
  app/api/notify/route.js \
  app/api/health/route.js \
  .env.example \
  CHANGELOG.md \
  BUILD-REPORT-v11.0-R2.1-LINE-SMART-QUOTA-GUARD.md

git diff --cached --check
git commit -m "Add R2.1 LINE smart quota guard"
git push origin HEAD:main

trap - EXIT
if [[ -f "$SELF" ]]; then rm -f -- "$SELF"; fi
say "9/9 COMPLETE"
echo "✅ R2.1 LINE SMART QUOTA GUARD PUSHED"
echo "✅ Signal Engine R2 unchanged"
echo "✅ Monthly quota pacing enabled"
echo "✅ 30-message STRONG reserve default"
echo "✅ Manual TEST protected"
echo "✅ Monthly-limit 429 no pointless retry"
echo "✅ TypeScript + Regression + Production Build PASS"
