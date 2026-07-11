#!/bin/bash
# Double-click this file (macOS) to launch the prototype in your browser.
# It serves the folder over http://localhost so the physiologie.cc figures
# load (opening prototype.html directly via file:// blocks them as mixed
# content, because the source site is http-only).
cd "$(dirname "$0")" || exit 1
PORT=8756
URL="http://localhost:$PORT/prototype.html"
echo "──────────────────────────────────────────────"
echo "  physiologie · reskin — prototype"
echo "  Serving at: $URL"
echo "  Leave this window open. Press Ctrl+C to stop."
echo "──────────────────────────────────────────────"
( sleep 1; open "$URL" ) &
python3 -m http.server "$PORT"
