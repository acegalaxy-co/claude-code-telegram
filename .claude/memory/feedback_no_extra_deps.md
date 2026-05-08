---
name: no new dependencies without explicit approval
description: Keep the npm dependency tree minimal. Adding a dep needs a strong reason and user sign-off.
type: feedback
---

Current deps: only `dotenv`. Telegram API is hand-rolled `fetch`. Whisper is hand-rolled multipart `fetch`.

Do NOT add: `node-telegram-bot-api`, `axios`, `lodash`, `zod`, ORM, logging frameworks, anything.

**Why:** This is a security-sensitive bridge that holds bot tokens + spawns shells. Every transitive dep is supply-chain risk. The current footprint is auditable in one afternoon; doubling it isn't.

**How to apply:** If you think you need a new dep, ask the user first with: (1) what problem it solves, (2) why hand-rolling won't work, (3) the dep's transitive count and last-publish date. Default answer is no.
