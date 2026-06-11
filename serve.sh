#!/bin/bash
# NovelTrans - Termux HTTP Server
# วิธีใช้: chmod +x serve.sh && ./serve.sh

PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║       NovelTrans v10 Pro Server      ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "📁 โฟลเดอร์: $DIR"
echo "🌐 URL: http://localhost:$PORT"
echo ""
echo "เปิด browser แล้วไปที่: http://localhost:$PORT"
echo "กด Ctrl+C เพื่อหยุด server"
echo ""

cd "$DIR"

# ลอง python3 ก่อน
if command -v python3 &>/dev/null; then
  echo "▶ เริ่ม Python3 server..."
  python3 -m http.server $PORT
elif command -v python &>/dev/null; then
  echo "▶ เริ่ม Python server..."
  python -m SimpleHTTPServer $PORT
else
  echo "❌ ไม่พบ Python กรุณาติดตั้ง: pkg install python"
  exit 1
fi
