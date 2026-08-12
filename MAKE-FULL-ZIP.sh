#!/usr/bin/env bash
set -Eeuo pipefail

echo "=== GOLD PULSE X — FULL RELEASE ZIP BUILDER ==="

[[ -d .git ]] || { echo "ERROR: ต้องรันที่ root ของ gold-pulse-x-v9"; exit 1; }
[[ -f package.json ]] || { echo "ERROR: ไม่พบ package.json"; exit 1; }

git fetch origin main

COMMIT="$(git rev-parse origin/main)"
SHORT="${COMMIT:0:7}"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
ROOT="GOLD-PULSE-X-v${VERSION}-R1-FIVE-CANDLE-TRUTH-FULL"
OUT="${ROOT}-${SHORT}.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/$ROOT"

# Export tracked files from the latest remote main only.
git archive origin/main | tar -x -C "$TMP/$ROOT"

# Remove temporary recovery/install helpers if they still exist in main.
for f in \
  RESTORE.sh SAFE.sh FIX.sh RUN.sh RESUME.sh \
  AUTO-INSTALL-GOLD-PULSE-X-v11.0-R1.sh \
  GOLD-PULSE-X-v11.0-R1-AUTO-INSTALL.zip \
  GOLD-PULSE-X-BUILD-CHECK-v2-AUTO.zip \
  RUN-ONCE-GOLD-PULSE-BUILD-CHECK-v2.sh \
  GOLD-PULSE-X-R1-BUILD-DIAG-AUTO.zip \
  RUN-ONCE-GOLD-PULSE-BUILD-DIAG.sh
do
  rm -f "$TMP/$ROOT/$f" 2>/dev/null || true
done

cat > "$TMP/$ROOT/RELEASE-MANIFEST.txt" <<EOF
GOLD PULSE X FULL RELEASE
Version: ${VERSION}
Release: R1 FIVE-CANDLE TRUTH
Source branch: main
Source commit: ${COMMIT}
Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

Included:
- app/
- lib/
- scripts/
- public/
- .github/
- package.json / package-lock.json
- Next.js / TypeScript / Vercel config
- README / CHANGELOG / SECURITY
- BUILD-REPORT-v11.0-R1-FIVE-CANDLE-TRUTH.md
- .env.example

Intentionally NOT included:
- .git/
- node_modules/
- .next/
- real .env files or secrets
- temporary recovery/install helper scripts

Install:
  npm ci
  npm run build

Production secrets must be restored separately in Vercel Environment Variables.
EOF

rm -f "$OUT"

python3 - "$TMP" "$ROOT" "$OUT" <<'PY'
import os, sys, zipfile
tmp, root, out = sys.argv[1:]
base = os.path.join(tmp, root)
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames.sort()
        filenames.sort()
        for name in filenames:
            p = os.path.join(dirpath, name)
            arc = os.path.relpath(p, tmp)
            z.write(p, arc)
PY

echo
echo "✅ FULL ZIP READY"
echo "File: $OUT"
echo "Source commit: $COMMIT"
echo "Size: $(du -h "$OUT" | awk '{print $1}')"
echo "SHA-256: $(sha256sum "$OUT" | awk '{print $1}')"
echo
echo "เปิด Explorer แล้วดาวน์โหลดไฟล์ ZIP ชื่อนี้ได้เลย"
