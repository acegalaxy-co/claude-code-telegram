/**
 * Minimal Telegram Bot API client (long-polling, native fetch).
 * No external HTTP libs. Node 20+ has fetch built-in.
 *
 * Hardening (v1.5):
 *   - sendMessage chunks at 3800 chars (Telegram limit 4096; leave room for HTML).
 *   - HTML parse_mode → plain-text fallback if Telegram complains about tags.
 *   - sendChatAction "typing" exposed (mid-task indicator).
 *   - getUpdates uses URL params + AbortSignal timeout (server-side long-poll).
 */

const API = "https://api.telegram.org";
const POLL_TIMEOUT_SEC = 25;
const MAX_MSG_LEN = 3800;

export function createTelegramClient(token) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  const base = `${API}/bot${token}`;

  async function call(method, params, { signal } = {}) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(`Telegram ${method}: ${json.description} (${json.error_code})`);
      err.code = json.error_code;
      err.description = json.description;
      throw err;
    }
    return json.result;
  }

  async function getUpdates(offset, timeout = POLL_TIMEOUT_SEC) {
    // GET with URL params + 5s grace beyond server-side timeout.
    const url = `${base}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=${encodeURIComponent(JSON.stringify(["message", "callback_query"]))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    const json = await res.json();
    if (!json.ok) throw new Error(`getUpdates: ${json.description} (${json.error_code})`);
    return json.result;
  }

  /**
   * Send a message. Long text is chunked; HTML parse failures auto-fall-back to plain.
   * Returns the LAST sent message object (so callers can edit/reply).
   */
  async function sendMessage(chatId, text, opts = {}) {
    if (!text) return null;
    const chunks = chunkText(text, MAX_MSG_LEN);
    let last = null;
    for (const chunk of chunks) {
      const body = {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      };
      if (opts.replyTo) body.reply_to_message_id = opts.replyTo;
      if (opts.parseMode) body.parse_mode = opts.parseMode;
      if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
      try {
        last = await call("sendMessage", body);
      } catch (e) {
        // HTML parse fail → retry plain text on the same chunk.
        if (opts.parseMode && /parse|tag|entit/i.test(e.description || e.message || "")) {
          const plainBody = { chat_id: chatId, text: chunk, disable_web_page_preview: true };
          if (opts.replyTo) plainBody.reply_to_message_id = opts.replyTo;
          last = await call("sendMessage", plainBody);
        } else {
          throw e;
        }
      }
    }
    return last;
  }

  function sendTyping(chatId) {
    return call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  async function answerCallbackQuery(callbackQueryId, text) {
    return call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async function deleteMessage(chatId, messageId) {
    try { return await call("deleteMessage", { chat_id: chatId, message_id: messageId }); }
    catch { /* ignore — message may already be gone */ }
  }

  async function editMessage(chatId, messageId, text, opts = {}) {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, MAX_MSG_LEN),
      disable_web_page_preview: true,
    };
    if (opts.parseMode) body.parse_mode = opts.parseMode;
    if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
    try {
      return await call("editMessageText", body);
    } catch (e) {
      if (opts.parseMode && /parse|tag|entit/i.test(e.description || e.message || "")) {
        return call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, MAX_MSG_LEN), disable_web_page_preview: true });
      }
      throw e;
    }
  }

  async function getMe() { return call("getMe", {}); }

  async function setMyCommands(commands, scope = undefined) {
    const body = { commands };
    if (scope) body.scope = scope;
    return call("setMyCommands", body);
  }

  return { getUpdates, sendMessage, editMessage, getMe, answerCallbackQuery, deleteMessage, sendTyping, setMyCommands };
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + max, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + max * 0.5) end = nl + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}
