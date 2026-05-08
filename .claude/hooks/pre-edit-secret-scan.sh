#!/usr/bin/env bash
# PreToolUse hook for Edit/Write — block edits that introduce raw secret patterns.
# Reads the proposed new_string / content from stdin (Claude passes tool input as JSON).
# Exit 0 = allow, exit 2 = block with stderr message shown to Claude.

set -uo pipefail

input=$(cat)

# Extract the text being written. Both Edit (new_string) and Write (content) keys.
text=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  ti = d.get("tool_input", {})
  print(ti.get("new_string", "") + "\n" + ti.get("content", ""))
except Exception:
  pass
' 2>/dev/null)

if [ -z "$text" ]; then
  exit 0
fi

# Patterns that should never appear in committed source.
# (Bot tokens / OpenAI keys / GitHub PATs / generic JWT-shaped strings.)
patterns=(
  'sk-[A-Za-z0-9]{32,}'                                           # OpenAI / Anthropic-ish
  'ghp_[A-Za-z0-9]{30,}'                                          # GitHub PAT
  'xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+'                               # Slack bot
  'glpat-[A-Za-z0-9_-]{20,}'                                      # GitLab PAT
  'AKIA[0-9A-Z]{16}'                                              # AWS access key id
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+'  # JWT
  '[0-9]{8,12}:AA[A-Za-z0-9_-]{30,}'                              # Telegram bot token
)

for p in "${patterns[@]}"; do
  if printf '%s' "$text" | grep -Eq "$p"; then
    echo "🛑 Secret-like pattern detected (regex: $p). Refusing edit." >&2
    echo "If this is a test fixture, use an obvious placeholder like sk-TEST-xxxx." >&2
    exit 2
  fi
done

exit 0
