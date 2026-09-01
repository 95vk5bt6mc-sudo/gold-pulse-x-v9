name: R22 Auto Installer

on:
  push:
    branches: [main]
    paths:
      - ".github/workflows/R22-AUTO.yml"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: r22-auto-installer
  cancel-in-progress: false

jobs:
  install-r22:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Patch LINE priority quota pacing
        shell: bash
        run: |
          set -Eeuo pipefail

          python3 <<'PY'
          from pathlib import Path
          import re

          p = Path("lib/line.ts")

          if not p.exists():
              raise SystemExit("ERROR: lib/line.ts not found")

          s = p.read_text()

          if "getLineQuotaSnapshot" not in s:
              raise SystemExit("ERROR: getLineQuotaSnapshot() not found")

          if "quotaDecision" not in s:
              raise SystemExit("ERROR: quotaDecision() not found")

          # ---------------------------------------------------------
          # Enforce reserve default = 45
          # ---------------------------------------------------------

          s = re.sub(
              r'integerEnv\("LINE_MONTHLY_RESERVE_MESSAGES",\s*\d+,\s*0,\s*10000\)',
              'integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 45, 0, 10000)',
              s
          )

          # ---------------------------------------------------------
          # Locate quotaDecision()
          # Supports single-line and multiline function signatures.
          # ---------------------------------------------------------

          match = re.search(
              r"function\s+quotaDecision\s*\(\s*"
              r"snapshot\s*:\s*LineQuotaSnapshot\s*,\s*"
              r"priority\s*:\s*LinePriority\s*"
              r"\)\s*\{",
              s,
              re.MULTILINE
          )

          if not match:
              raise SystemExit(
                  "ERROR: quotaDecision() signature not found"
              )

          start = match.start()

          next_function = re.search(
              r"\nfunction\s+deterministicUuid\s*\(",
              s[match.end():],
              re.MULTILINE
          )

          if not next_function:
              raise SystemExit(
                  "ERROR: deterministicUuid() boundary not found"
              )

          end = match.end() + next_function.start()

          # ---------------------------------------------------------
          # PRIORITY PACING POLICY
          #
          # TEST:
          #   hard pace only
          #
          # CONFIRMED:
          #   hard pace + LINE_CONFIRMED_PACE_BURST
          #   default +3
          #
          # STRONG:
          #   hard pace + LINE_STRONG_PACE_BURST
          #   default +5
          #
          # ALL priorities:
          #   - cannot exceed monthly quota
          #   - cannot consume reserve
          #   - obey daily caps when LINE daily usage is available
          # ---------------------------------------------------------

          replacement = '''function quotaDecision(
            snapshot: LineQuotaSnapshot,
            priority: LinePriority
          ) {
            if (
              !snapshot.checked ||
              !snapshot.limited ||
              snapshot.remaining == null
            ) {
              return {
                allowed: true,
                reason: "quota-unlimited-or-unavailable"
              };
            }

            if (snapshot.remaining <= 0) {
              return {
                allowed: false,
                reason: "monthly-quota-exhausted"
              };
            }

            // Reserve is protected for ALL priorities.
            if (
              snapshot.survivalMode ||
              snapshot.remaining <= snapshot.reserve
            ) {
              return {
                allowed: false,
                reason: "reserve-protected"
              };
            }

            const dailyCap = integerEnv(
              "LINE_DAILY_PUSH_CAP",
              12,
              1,
              10000
            );

            const strongDailyBurst = integerEnv(
              "LINE_STRONG_DAILY_BURST",
              2,
              0,
              1000
            );

            const dailyLimit =
              priority === "strong"
                ? dailyCap + strongDailyBurst
                : dailyCap;

            if (
              snapshot.dailyUsed != null &&
              snapshot.dailyUsed >= dailyLimit
            ) {
              return {
                allowed: false,
                reason:
                  priority === "strong"
                    ? "strong-daily-cap-used"
                    : "daily-cap-used"
              };
            }

            const hardPacedBudget =
              snapshot.monthlyLimit != null
                ? Math.floor(
                    snapshot.monthlyLimit *
                    (
                      snapshot.businessDaysElapsed /
                      snapshot.businessDaysTotal
                    )
                  )
                : null;

            const confirmedPaceBurst = integerEnv(
              "LINE_CONFIRMED_PACE_BURST",
              3,
              0,
              1000
            );

            const strongPaceBurst = integerEnv(
              "LINE_STRONG_PACE_BURST",
              5,
              0,
              1000
            );

            const paceBurst =
              priority === "strong"
                ? strongPaceBurst
                : priority === "confirmed"
                  ? confirmedPaceBurst
                  : 0;

            // Maximum total usage before entering reserve.
            const spendableLimit =
              snapshot.monthlyLimit != null
                ? Math.max(
                    0,
                    snapshot.monthlyLimit - snapshot.reserve
                  )
                : null;

            const rawPriorityPacedBudget =
              hardPacedBudget != null
                ? hardPacedBudget + paceBurst
                : null;

            const priorityPacedBudget =
              rawPriorityPacedBudget != null &&
              spendableLimit != null
                ? Math.min(
                    rawPriorityPacedBudget,
                    spendableLimit
                  )
                : rawPriorityPacedBudget;

            if (
              priorityPacedBudget != null &&
              snapshot.totalUsage != null &&
              snapshot.totalUsage >= priorityPacedBudget
            ) {
              if (priority === "strong") {
                return {
                  allowed: false,
                  reason: "strong-pace-burst-used"
                };
              }

              if (priority === "confirmed") {
                return {
                  allowed: false,
                  reason: "confirmed-pace-burst-used"
                };
              }

              return {
                allowed: false,
                reason: "test-hard-pace-used"
              };
            }

            if (priority === "strong") {
              return {
                allowed: true,
                reason: "strong-within-priority-pace"
              };
            }

            if (priority === "confirmed") {
              return {
                allowed: true,
                reason: "confirmed-within-priority-pace"
              };
            }

            if (
              snapshot.remainingPercent != null &&
              snapshot.remainingPercent <= 25
            ) {
              return {
                allowed: false,
                reason: "test-reserve-protected"
              };
            }

            return {
              allowed: true,
              reason: "test-within-hard-pace"
            };
          }
          '''

          s = s[:start] + replacement + s[end:]

          # ---------------------------------------------------------
          # Sanity checks
          # ---------------------------------------------------------

          required = [
              'reason: "test-within-hard-pace"',
              'reason: "confirmed-within-priority-pace"',
              'reason: "strong-within-priority-pace"',
              'reason: "test-hard-pace-used"',
              'reason: "confirmed-pace-burst-used"',
              'reason: "strong-pace-burst-used"',
              '"LINE_CONFIRMED_PACE_BURST"',
              '"LINE_STRONG_PACE_BURST"',
              "export async function sendLineText",
              "getLineQuotaSnapshot"
          ]

          for token in required:
              if token not in s:
                  raise SystemExit(
                      f"ERROR: required quota token missing: {token}"
                  )

          obsolete = [
              'reason: "confirmed-pace-budget-used"',
              'reason: "test-budget-protected"',
              'reason: "hard-monthly-pace-used"'
          ]

          for token in obsolete:
              if token in s:
                  raise SystemExit(
                      f"ERROR: obsolete quota logic remains: {token}"
                  )

          p.write_text(s)

          # ---------------------------------------------------------
          # .env.example
          # ---------------------------------------------------------

          env = Path(".env.example")
          e = env.read_text() if env.exists() else ""

          def set_env(text, key, value):
              pattern = rf"^{re.escape(key)}=.*$"

              if re.search(pattern, text, re.MULTILINE):
                  return re.sub(
                      pattern,
                      f"{key}={value}",
                      text,
                      flags=re.MULTILINE
                  )

              if text and not text.endswith("\n"):
                  text += "\n"

              return text + f"{key}={value}\n"

          e = set_env(
              e,
              "LINE_MONTHLY_RESERVE_MESSAGES",
              "45"
          )

          e = set_env(
              e,
              "LINE_DAILY_PUSH_CAP",
              "12"
          )

          e = set_env(
              e,
              "LINE_STRONG_DAILY_BURST",
              "2"
          )

          e = set_env(
              e,
              "LINE_CONFIRMED_PACE_BURST",
              "3"
          )

          e = set_env(
              e,
              "LINE_STRONG_PACE_BURST",
              "5"
          )

          env.write_text(e)

          # ---------------------------------------------------------
          # Health version
          # ---------------------------------------------------------

          health = Path("app/api/health/route.js")

          if health.exists():
              h = health.read_text()

              h = re.sub(
                  r'version:\s*"R2\.[^"]+"',
                  'version: "R2.3-PRIORITY-PACE-1"',
                  h
              )

              h = h.replace(
                  "monthlyReserveDefault: 30",
                  "monthlyReserveDefault: 45"
              )

              health.write_text(h)

          print("✅ Priority quota pacing installed")
          print("✅ TEST hard pace: +0")
          print("✅ CONFIRMED pace burst: +3")
          print("✅ STRONG pace burst: +5")
          print("✅ Monthly reserve: 45")
          print("✅ Reserve protected for ALL priorities")
          PY

      - name: Verify patched source
        shell: bash
        run: |
          set -Eeuo pipefail

          test -f lib/line.ts

          grep -q \
            'test-within-hard-pace' \
            lib/line.ts

          grep -q \
            'confirmed-within-priority-pace' \
            lib/line.ts

          grep -q \
            'strong-within-priority-pace' \
            lib/line.ts

          grep -q \
            'LINE_CONFIRMED_PACE_BURST' \
            lib/line.ts

          grep -q \
            'LINE_STRONG_PACE_BURST' \
            lib/line.ts

          grep -q \
            'export async function sendLineText' \
            lib/line.ts

          if grep -q \
            'confirmed-pace-budget-used' \
            lib/line.ts
          then
            echo "ERROR: old confirmed pace logic detected"
            exit 1
          fi

          if grep -q \
            'test-budget-protected' \
            lib/line.ts
          then
            echo "ERROR: old TEST budget logic detected"
            exit 1
          fi

          echo "✅ Priority pacing source verified"

      - name: TypeScript check
        shell: bash
        run: |
          set -Eeuo pipefail

          if [ -x node_modules/.bin/tsc ]; then
            node_modules/.bin/tsc \
              --noEmit \
              --pretty false
          else
            echo "ℹ️ TypeScript compiler not installed; skipped"
          fi

      - name: Regression tests
        shell: bash
        run: |
          set -Eeuo pipefail

          for t in \
            scripts/test-v11-r2-signal-policy.mjs \
            scripts/test-v11-intelligence.mjs \
            scripts/test-v11-r1-five-candle-truth.mjs
          do
            if [ -f "$t" ]; then
              echo "▶ Running $t"
              node "$t"
            else
              echo "ℹ️ Missing optional test: $t"
            fi
          done

      - name: Production build
        env:
          NEXT_TELEMETRY_DISABLED: "1"
        run: npm run build

      - name: Verify priority pacing policy
        shell: bash
        run: |
          set -Eeuo pipefail

          python3 <<'PY'
          from pathlib import Path

          s = Path("lib/line.ts").read_text()

          required = [
              'test-within-hard-pace',
              'confirmed-within-priority-pace',
              'strong-within-priority-pace',
              'test-hard-pace-used',
              'confirmed-pace-burst-used',
              'strong-pace-burst-used',
              'LINE_CONFIRMED_PACE_BURST',
              'LINE_STRONG_PACE_BURST'
          ]

          for token in required:
              if token not in s:
                  raise SystemExit(
                      f"ERROR: {token} missing"
                  )

          forbidden = [
              'confirmed-pace-budget-used',
              'test-budget-protected',
              'hard-monthly-pace-used'
          ]

          for token in forbidden:
              if token in s:
                  raise SystemExit(
                      f"ERROR: obsolete logic detected: {token}"
                  )

          print("✅ Final priority pacing policy verified")
          PY

      - name: Commit and push priority pacing
        shell: bash
        run: |
          set -Eeuo pipefail

          git config \
            user.name \
            "github-actions[bot]"

          git config \
            user.email \
            "41898282+github-actions[bot]@users.noreply.github.com"

          git add \
            lib/line.ts \
            .env.example

          if [ -f app/api/health/route.js ]; then
            git add app/api/health/route.js
          fi

          git diff --cached --check

          if git diff --cached --quiet; then
            echo "✅ Priority quota pacing already installed."
            exit 0
          fi

          git commit \
            -m "Install R2.3 LINE priority quota pacing"

          git push \
            origin \
            HEAD:main

      - name: Done
        run: |
          echo "============================================"
          echo "✅ R2.3 LINE PRIORITY PACING READY"
          echo "✅ TEST pace: hard pace only"
          echo "✅ CONFIRMED: hard pace +3"
          echo "✅ STRONG: hard pace +5"
          echo "✅ Monthly reserve: 45"
          echo "✅ Daily base cap: 12"
          echo "✅ STRONG daily burst: +2"
          echo "✅ Reserve protected for ALL priorities"
          echo "============================================"
