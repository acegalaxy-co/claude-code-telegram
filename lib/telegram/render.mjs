/**
 * Render Claude / Codex / Gemini / DeepSeek stream events as Telegram-friendly
 * HTML blocks. Mirrors the Claude Code CLI native UI:
 *   • One tool_use → one HTML block on completion (with IN/OUT in <pre>).
 *   • Final assistant text + footer (cost · duration · tools).
 *   • A status indicator while tools are running ("⏳ Read — file.ts"),
 *     emitted at most every STATUS_INTERVAL_MS and de-duplicated.
 *
 * The bridge collects events into a `RenderState` then drains:
 *   - sendStatusUpdate(state, sender)   — periodic, while running.
 *   - flushFinal(state, sender)         — once on completion.
 */

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}

/**
 * Render one tool block (HTML).
 * Mirrors FW renderToolBlock — unchanged shape so users get a familiar UX.
 */
export function renderToolBlock(toolName, input, resultText, isError = false) {
  const safeInput = input || {};
  const desc = safeInput.description || safeInput.file_path || safeInput.pattern || "";
  const inLine = safeInput.command
    || safeInput.file_path
    || safeInput.pattern
    || safeInput.url
    || JSON.stringify(safeInput).slice(0, 200);
  const icon = isError ? "🔴" : "🟢";
  const parts = [`${icon} <b>${escapeHtml(toolName)}</b>${desc ? "  <i>" + escapeHtml(desc) + "</i>" : ""}`];
  if (inLine) parts.push(`<pre>IN  ${escapeHtml(truncate(String(inLine), 400))}</pre>`);
  if (resultText) parts.push(`<pre>OUT ${escapeHtml(truncate(String(resultText).trim(), 800))}</pre>`);
  return parts.join("\n");
}

/**
 * Render the periodic status indicator while tools are running.
 * Returns null when nothing meaningful changed since the previous call.
 */
export function renderStatus(state) {
  const last = state.tools[state.tools.length - 1];
  if (!last) return "⏳ <i>thinking…</i>";
  const hint = last.input?.description
    || last.input?.file_path
    || last.input?.pattern
    || last.input?.command
    || "";
  const hintStr = hint ? ` — ${String(hint).slice(0, 60)}` : "";
  return `⏳ <i>${escapeHtml(last.name)}${escapeHtml(hintStr)}</i>`;
}

/**
 * Render the final assistant text + footer (cost · duration · tools).
 */
export function renderFinal({ assistantText, tools, cost, durMs }) {
  const footer = [];
  if (typeof cost === "number") footer.push(`$${cost.toFixed(5)}`);
  if (typeof durMs === "number") footer.push(`${(durMs / 1000).toFixed(1)}s`);
  if (tools && tools.length) footer.push(`${tools.length} tool${tools.length === 1 ? "" : "s"}`);
  const txt = (assistantText || "").trim();
  const out = [];
  if (txt) out.push(`💬 ${escapeHtml(txt)}`);
  if (footer.length) out.push(`<i>— ${footer.join(" · ")}</i>`);
  if (!out.length) out.push("(no response)");
  return out.join("\n\n");
}

/**
 * Build a fresh per-dispatch state for the renderer.
 */
export function newRenderState() {
  return {
    tools: [],          // [{ id, name, input, result, isError }]
    assistantText: "",
    cost: null,
    durMs: null,
  };
}

/**
 * Fold a Claude/Codex/etc event into RenderState. Idempotent shape per CLI:
 * runners normalize to { type: 'assistant'|'user'|'result', message: {content:[...]} }.
 */
export function applyEventToState(state, ev) {
  if (!ev || typeof ev !== "object") return;
  if (ev.type === "assistant" && ev.message?.content) {
    for (const p of ev.message.content) {
      if (p.type === "text" && p.text) state.assistantText += p.text;
      else if (p.type === "tool_use" && p.name) {
        state.tools.push({ id: p.id, name: p.name, input: p.input || {}, result: null });
      }
    }
  } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
    for (const p of ev.message.content) {
      if (p.type === "tool_result" && p.tool_use_id) {
        const t = state.tools.find((x) => x.id === p.tool_use_id);
        if (t) {
          const c = p.content;
          t.result = typeof c === "string"
            ? c
            : (Array.isArray(c) ? c.map((x) => x.text || "").join("\n") : JSON.stringify(c));
          t.isError = !!p.is_error;
        }
      }
    }
  } else if (ev.type === "result") {
    if (typeof ev.total_cost_usd === "number") state.cost = ev.total_cost_usd;
    if (typeof ev.duration_ms === "number") state.durMs = ev.duration_ms;
    if (ev.result && !state.assistantText) state.assistantText = ev.result;
  }
}
