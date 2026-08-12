#!/usr/bin/env bash
set -Eeuo pipefail

FILE="app/api/scan/route.js"
OLD_VERSION='version: "10.2.1"'
NEW_VERSION='version: "11.0.0"'
OLD_UA='GOLD-PULSE-v10.2.1-ADAPTIVE-LITE-SCAN'
NEW_UA='GOLD-PULSE-v11.0-R1-FIVE-CANDLE-TRUTH-SCAN'

echo "=== GOLD PULSE X — v11 R1 METADATA PATCH ==="

[[ -d .git ]] || { echo "ERROR: ไม่พบ Git repository"; exit 1; }
[[ -f "$FILE" ]] || { echo "ERROR: ไม่พบ $FILE"; exit 1; }

git fetch origin main

# Safety: refuse unrelated local changes.
if [[ -n "$(git status --porcelain | grep -vE '^\?\? PATCH-V11-METADATA\.sh$' || true)" ]]; then
  echo "ERROR: มี local changes อื่นค้างอยู่ — ยังไม่แก้อะไร"
  git status --short
  exit 1
fi

cp "$FILE" "/tmp/route.js.before-v11-metadata"

python3 - <<'PY'
from pathlib import Path
p = Path("app/api/scan/route.js")
s = p.read_text()

old_version = 'version: "10.2.1"'
new_version = 'version: "11.0.0"'
old_ua = 'GOLD-PULSE-v10.2.1-ADAPTIVE-LITE-SCAN'
new_ua = 'GOLD-PULSE-v11.0-R1-FIVE-CANDLE-TRUTH-SCAN'

if new_version in s and new_ua in s:
    print("Metadata already updated.")
else:
    if old_version not in s:
        raise SystemExit("ERROR: ไม่พบ version เดิมที่คาดไว้")
    if old_ua not in s:
        raise SystemExit("ERROR: ไม่พบ user-agent เดิมที่คาดไว้")
    s = s.replace(old_version, new_version, 1)
    s = s.replace(old_ua, new_ua, 1)
    p.write_text(s)
    print("Metadata patched.")
PY

node --check "$FILE"

echo
echo "=== DIFF ==="
git diff -- "$FILE"

# Guard: only this file may be changed.
CHANGED="$(git diff --name-only)"
[[ "$CHANGED" == "$FILE" ]] || {
  echo "ERROR: พบการเปลี่ยนแปลงนอก $FILE — หยุด"
  exit 1
}

git add "$FILE"
git diff --cached --check

if git diff --cached --quiet; then
  echo "ไม่มี change ใหม่ให้ commit"
else
  git commit -m "Align scan metadata with v11.0 R1"
fi

git push origin HEAD:main

rm -f -- "$0" 2>/dev/null || true

echo
echo "✅ PATCH COMPLETE"
echo "แก้เฉพาะ scan metadata เท่านั้น"
