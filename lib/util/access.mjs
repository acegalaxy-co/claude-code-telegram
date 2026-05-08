/**
 * Access control parsing and checks.
 *
 * Layers:
 *   - chatAllowSet:   TELEGRAM_ALLOWED_CHAT_IDS (set of strings) — primary gate
 *   - userAllowSet:   TELEGRAM_ALLOWED_USER_IDS (optional second gate, group-safe)
 *   - userBlockSet:   TELEGRAM_BLOCKED_USER_IDS (always denies, even if chat allowed)
 *   - adminSet:       TELEGRAM_ADMIN_CHAT_IDS  — chats permitted to run /audit
 *   - projectAcl:     TELEGRAM_PROJECT_ACL JSON map { chat_id: ["proj1", ...] }
 *
 * All IDs are compared as strings to avoid bigint/precision drift.
 */

function parseIdSet(input) {
  if (!input) return null;
  const arr = Array.isArray(input) ? input : String(input).split(/[,\s]+/).filter(Boolean);
  if (!arr.length) return null;
  return new Set(arr.map(String));
}

function parseProjectAcl(input) {
  if (!input) return null;
  let raw;
  try { raw = JSON.parse(String(input)); }
  catch { return { error: "TELEGRAM_PROJECT_ACL is not valid JSON" }; }
  if (typeof raw !== "object" || Array.isArray(raw) || raw === null) {
    return { error: "TELEGRAM_PROJECT_ACL must be a JSON object {chat_id:[projects]}" };
  }
  const out = new Map();
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) return { error: `TELEGRAM_PROJECT_ACL[${k}] must be an array` };
    out.set(String(k), new Set(v.map(String)));
  }
  return { acl: out };
}

export function buildAccessConfig(env = process.env) {
  const chatAllow = parseIdSet(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const allowAnonymous = String(env.TELEGRAM_ALLOW_ANY_CHAT || "").toLowerCase() === "true";
  const userAllow = parseIdSet(env.TELEGRAM_ALLOWED_USER_IDS);
  const userBlock = parseIdSet(env.TELEGRAM_BLOCKED_USER_IDS);
  const admins = parseIdSet(env.TELEGRAM_ADMIN_CHAT_IDS);
  const aclResult = parseProjectAcl(env.TELEGRAM_PROJECT_ACL);
  return {
    chatAllow,
    allowAnonymous,
    userAllow,
    userBlock,
    admins,
    projectAcl: aclResult?.acl || null,
    aclError: aclResult?.error || null,
  };
}

/**
 * Returns null if allowed, else a string reason for denial.
 * `kind` lets the caller pick the right audit event.
 */
export function checkMessageAccess(cfg, { chatId, userId }) {
  const cid = String(chatId);
  const uid = userId != null ? String(userId) : null;
  if (uid && cfg.userBlock?.has(uid)) {
    return { ok: false, kind: "auth.deny.user", reason: "user_id in TELEGRAM_BLOCKED_USER_IDS" };
  }
  if (cfg.chatAllow && !cfg.chatAllow.has(cid)) {
    return { ok: false, kind: "auth.deny.chat", reason: "chat_id not in TELEGRAM_ALLOWED_CHAT_IDS" };
  }
  if (cfg.userAllow && (!uid || !cfg.userAllow.has(uid))) {
    return { ok: false, kind: "auth.deny.user", reason: "user_id not in TELEGRAM_ALLOWED_USER_IDS" };
  }
  return { ok: true };
}

export function isAdmin(cfg, chatId) {
  if (!cfg.admins) return false;
  return cfg.admins.has(String(chatId));
}

export function projectAllowed(cfg, chatId, projectName) {
  if (!cfg.projectAcl) return true;
  const allowed = cfg.projectAcl.get(String(chatId));
  if (!allowed) return false;
  return allowed.has(String(projectName));
}

/**
 * Returns an array of warning strings describing weak/missing security config.
 */
export function securityWarnings(cfg) {
  const out = [];
  if (cfg.aclError) out.push(`TELEGRAM_PROJECT_ACL ignored: ${cfg.aclError}`);
  if (!cfg.chatAllow && cfg.allowAnonymous) {
    out.push("TELEGRAM_ALLOW_ANY_CHAT=true — bot accepts ANY chat. NOT recommended for production.");
  }
  if (cfg.chatAllow && !cfg.userAllow) {
    out.push("TELEGRAM_ALLOWED_USER_IDS not set — anyone in an allowed group chat can drive the bot. Recommended in shared chats.");
  }
  if (!cfg.admins) {
    out.push("TELEGRAM_ADMIN_CHAT_IDS not set — /audit command disabled.");
  }
  return out;
}
