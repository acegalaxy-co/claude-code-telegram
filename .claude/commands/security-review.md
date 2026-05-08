---
description: Security review of pending changes (focus on bridge attack surface)
---

Review uncommitted (or current branch vs main) changes for security regressions specific to this bridge.

Run `git diff` (uncommitted) or `git diff main...HEAD` (branch). For each changed file under `lib/`, check against the threat model:

## Required checks

For every diff hunk, ask:

1. **Does this introduce a new way for user input to reach `spawn()`?**
   - Is the input validated against an allowlist?
   - Are args passed as an array (not string)?
   - Is `shell: true` used? (It must NOT be.)

2. **Does this add a new `audit.write()` call?**
   - Does it include raw prompt content? (Forbidden — hash + length only.)
   - Does it include absolute `cwd` or filesystem paths? (Forbidden — use logical `project` name.)
   - Are error messages truncated (≤200 chars)?

3. **Does this add a new env var?**
   - Is it documented in [.env.example](.env.example)?
   - If it's security-relevant, does `securityWarnings()` in [lib/util/access.mjs](lib/util/access.mjs) check it?
   - Does the startup banner mention it?

4. **Does this change project resolution?**
   - Path traversal still blocked (`/`, `..`, leading `.`)?
   - `projectAllowed()` ACL check applied on EVERY code path that sets `s.project` or `s.cwd`?

5. **Does this change access/auth ordering?**
   - Block list checked before allowlists?
   - Per-message check happens BEFORE any `dispatch()` or `spawn()`?

6. **Does this change the redact step?**
   - Both text path AND voice transcript path go through `redactSecrets()`?
   - New input source (e.g., a forwarded message field) — also redacted before logging?

7. **Does this change file write paths?**
   - New files containing secrets/audit data created with mode `0o600`?
   - No file written under user-controlled path components?

8. **Does this change Telegram callback handling?**
   - Callback `data` parsed with explicit allowlist of known prefixes (not regex eval)?
   - Pending store TTL respected (no leftover state across users)?

## Output format

Produce a verdict per file:

- ✅ Safe — what was checked and why nothing flagged.
- ⚠️ Concern — specific line, what's risky, suggested fix.
- 🛑 Blocker — security regression, must not merge.

Then a final overall verdict + recommendation (merge / fix and re-review / abandon).

Don't speculate about issues outside the diff. Don't rewrite the code unless the user asks; just flag.
