---
description: Release a new version (bump, commit, push, publish, redeploy prod)
---

You are releasing a new version of `@acegalaxy/claude-code-telegram`.

Inputs from the user (ask if not provided):
- New version (semver). If unsure: feat → bump minor; fix/security → bump patch.
- One-paragraph CHANGELOG body (or generate from git log since last tag).

Steps — execute in order, do not skip:

1. **Verify clean state**: `git status` should show only intentional changes. If `.claude/scheduled_tasks.lock` shows as modified or untracked, abort — that file is gitignored and shouldn't be staged.

2. **Syntax check**: `node --check lib/bridge.mjs lib/util/audit.mjs lib/util/access.mjs` (and any other edited `.mjs`).

3. **Bump** [package.json](package.json) `version` field. Match exactly what the user gave.

4. **Prepend CHANGELOG entry** under today's date in [CHANGELOG.md](CHANGELOG.md). Use `## [X.Y.Z] - YYYY-MM-DD` heading. Inside, group by `### Added`, `### Fixed`, `### Changed` as needed. Do NOT modify older sections — pre-existing markdown lint warnings there are not your problem.

5. **Commit**: conventional commit style. `feat(<scope>):` / `fix(<scope>):` / `chore:`. Body explains WHY. Always include the Co-Authored-By trailer for Claude Opus 4.7.

6. **Push**: `git push origin main`.

7. **Publish**: `npm publish`. Must succeed before redeploy.

8. **Verify registry**: `npm view @acegalaxy/claude-code-telegram versions --json | tail -3` — confirm the new version appears.

9. **Redeploy prod**:
   ```sh
   ssh aws-prod 'sudo npm i -g @acegalaxy/claude-code-telegram@<v> && pm2 restart cc-bot && sleep 3 && pm2 logs cc-bot --lines 12 --nostream'
   ```
   If `ETARGET no matching version`: wait ~30s, retry with `sudo npm cache clean --force && sudo npm i -g ...@<v> --registry=https://registry.npmjs.org/`.

10. **Verify deploy**: logs must show `🛡 Security: ... ✓` line and `📜 Registered 13 bot commands`. If the bot count is wrong, the new code didn't load — investigate.

11. **Report back**: version, commit SHA, npm tarball size, prod pid + uptime.

If any step fails, STOP and report — do not skip ahead. A failed publish or deploy is recoverable; a failed verify means prod might be running broken code.
