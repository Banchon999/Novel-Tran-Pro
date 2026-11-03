#!/bin/bash
# รันชุดทดสอบ: syntax ทุกไฟล์ JS + e2e (mock AI, ไม่เสียเงิน) · ใช้: bash tests/e2e/run.sh
cd "$(dirname "$0")/../.." || exit 1
ok=1
for f in js/*.js sw.js; do node --check "$f" || { echo "SYNTAX FAIL $f"; ok=0; }; done
PORT=${PORT:-8099}
python3 -m http.server "$PORT" >/dev/null 2>&1 & SRV=$!
sleep 1
# playwright: ใช้ตัวที่ติดตั้งในเครื่อง (global) ถ้าไม่มีใน node_modules
[ -z "$PLAYWRIGHT_PATH" ] && [ -d /opt/node22/lib/node_modules/playwright ] && export PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright
PORT=$PORT node tests/e2e/e2e.js > tests/e2e/last.out 2>&1 || ok=0
kill $SRV 2>/dev/null
echo "e2e PASS: $(grep -c '^PASS' tests/e2e/last.out)"; grep -E '^FAIL|Error' tests/e2e/last.out
[ $ok = 1 ] && echo "ALL OK" || echo "SOMETHING FAILED"
[ $ok = 1 ]
