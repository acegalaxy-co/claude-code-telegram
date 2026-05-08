---
name: audit log never carries raw prompt or absolute path
description: Strict rule for what audit events may contain. Violating this is a security regression.
type: feedback
---

Audit events MUST NOT include:
- Raw prompt content (use `audit.hashPrompt()` → SHA-256 prefix + length).
- Absolute filesystem paths or `cwd` (use logical `project` name).
- Untruncated error messages (cap at 200 chars; drop stack).
- API keys, tokens, or any value resembling a secret.

**Why:** The audit log is owner-readable on prod (mode 0600), but it's still durable evidence. We don't want any single file to leak prompt content, filesystem layout, or secrets if it's later viewed/copied. Past leaks fixed in 2.1.1 (cwd in `dispatch`, full error in `error` events).

**How to apply:** When adding any new `audit.write()` call, double-check the fields. If unsure whether a value is sensitive, don't log it. The `security-reviewer` agent enforces this on diffs.
