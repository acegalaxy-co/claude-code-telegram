#!/usr/bin/env bash
# PostToolUse hook for Edit/Write on .mjs files — run `node --check` and report.
# Non-blocking: prints warning if syntax fails, but does not abort the session.
# Claude will see the stderr in the next turn and can fix.

set -uo pipefail

input=$(cat)

file=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
  pass
' 2>/dev/null)

case "$file" in
  *.mjs|*.js)
    if ! node --check "$file" 2>/tmp/claude-syntax-err; then
      echo "⚠️  Syntax error in $file:" >&2
      cat /tmp/claude-syntax-err >&2
      # Exit 1 (not 2) — Claude is informed but the edit isn't reverted.
      exit 1
    fi
    ;;
esac

exit 0
