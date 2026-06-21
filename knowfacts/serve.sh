#!/usr/bin/env bash
# KnowFacts Factory — เปิด local server (ต้องเปิดผ่าน http:// ไม่ใช่ file://)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8090}"
echo "KnowFacts Factory → http://localhost:$PORT"
python3 -m http.server "$PORT"
