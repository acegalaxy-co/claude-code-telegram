---
name: admin chat / user IDs (current prod)
description: Single-admin setup for the running prod bot.
type: reference
---

Prod is configured with a single admin:
- `TELEGRAM_ALLOWED_CHAT_IDS=5336610935`
- `TELEGRAM_ALLOWED_USER_IDS=5336610935`
- `TELEGRAM_ADMIN_CHAT_IDS=5336610935`

That ID belongs to Kane (`@kanechr`). Brute-force alerts and `/audit` access flow to that chat only.

If the user adds more allowed users or admins, update this memory.
