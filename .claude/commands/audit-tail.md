---
description: Tail the prod audit log + summarize recent security events
---

Pull the last N lines of the production audit log (`/home/kane/ai-control/cc-bot/.audit.log` on `aws-prod`) and produce a short summary.

Steps:

1. Ask the user how many lines (default 100).

2. Fetch:
   ```sh
   ssh aws-prod 'tail -n <N> /home/kane/ai-control/cc-bot/.audit.log'
   ```

3. Parse JSONL and group by `kind`. Report:
   - Total events + time window covered.
   - Counts per kind (sorted desc).
   - Any `auth.deny.*` entries — list them in full (chat, user, reason, time).
   - Any `alert.bruteforce` entries — these are critical, surface prominently.
   - Any `error` entries — surface name + truncated message.
   - For `dispatch` events, group by `cli` × `project`, show count.

4. **DO NOT** reproduce raw `promptHash` values in chat unless the user asks — they're correlation IDs, useful but noisy.

5. **DO NOT** copy the audit log file off the server. It's owner-readable for a reason; we summarize, we don't exfiltrate.

If the user wants live tail (`-f`), use `ssh aws-prod 'tail -f /home/kane/ai-control/cc-bot/.audit.log'` in a background bash and stream events as they arrive. Stop on user signal.
