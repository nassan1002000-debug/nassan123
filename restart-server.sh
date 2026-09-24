#!/bin/bash
# إعادة تشغيل خادم التطوير إن كان ميتاً — يستخدم في كل أمر تحقق
cd /home/z/my-project
if ! curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  pkill -f "next dev" 2>/dev/null
  sleep 1
  setsid -f bun run dev > /dev/null 2>&1 < /dev/null
  for i in $(seq 1 30); do
    sleep 1
    if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
      echo "server-ready (${i}s)"
      exit 0
    fi
  done
  echo "server-FAILED"
  exit 1
else
  echo "server-alive"
fi
