(() => {
  "use strict";

  const SCRIPT_ID = "codex-token-usage";
  const BADGE_CLASS = "codex-token-usage-badge";
  const STYLE_ID = "codex-token-usage-style";
  const RECENT_LIMIT = 20;

  if (window.__codexTokenUsageScriptInstalled) return;
  window.__codexTokenUsageScriptInstalled = true;

  const state = {
    lastMetric: null,
    recent: [],
  };

  function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
  }

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const inputTokens = normalizeNumber(raw.input_tokens ?? raw.prompt_tokens);
    const outputTokens = normalizeNumber(raw.output_tokens ?? raw.completion_tokens);
    const totalTokens = normalizeNumber(raw.total_tokens || inputTokens + outputTokens);
    const cachedTokens = normalizeNumber(
      raw.cached_tokens ??
        raw.prompt_tokens_details?.cached_tokens ??
        raw.input_tokens_details?.cached_tokens,
    );
    const cacheReadTokens = normalizeNumber(raw.cache_read_input_tokens);
    const cacheCreationTokens = normalizeNumber(raw.cache_creation_input_tokens);
    if (!inputTokens && !outputTokens && !totalTokens && !cachedTokens && !cacheReadTokens && !cacheCreationTokens) {
      return null;
    }
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedTokens,
      cacheReadTokens,
      cacheCreationTokens,
    };
  }

  function findUsageInObject(value, depth = 0) {
    if (!value || depth > 8) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const usage = findUsageInObject(item, depth + 1);
        if (usage) return usage;
      }
      return null;
    }
    if (typeof value !== "object") return null;

    const direct = normalizeUsage(value.usage);
    if (direct) return direct;

    const self = normalizeUsage(value);
    if (self) return self;

    for (const key of ["response", "data", "body", "message", "result", "event"]) {
      const usage = findUsageInObject(value[key], depth + 1);
      if (usage) return usage;
    }
    return null;
  }

  function extractJsonFragmentsFromSse(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
  }

  function extractUsage(payload) {
    if (typeof payload === "string") {
      try {
        const parsed = JSON.parse(payload);
        const usage = findUsageInObject(parsed);
        if (usage) return usage;
      } catch (_) {
        // Treat non-JSON text as a possible SSE stream below.
      }
      for (const fragment of extractJsonFragmentsFromSse(payload)) {
        try {
          const usage = findUsageInObject(JSON.parse(fragment));
          if (usage) return usage;
        } catch (_) {
          // Ignore malformed stream fragments.
        }
      }
      return null;
    }
    return findUsageInObject(payload);
  }

  function formatNumber(value) {
    return normalizeNumber(value).toLocaleString("en-US");
  }

  function formatSeconds(elapsedMs) {
    return `${(Math.max(0, normalizeNumber(elapsedMs)) / 1000).toFixed(1)}s`;
  }

  function formatBadgeText(metric) {
    const usage = metric?.usage || {};
    const cacheParts = [];
    if (usage.cachedTokens) cacheParts.push(`缓存 ${formatNumber(usage.cachedTokens)}`);
    if (usage.cacheReadTokens) cacheParts.push(`缓存读 ${formatNumber(usage.cacheReadTokens)}`);
    if (usage.cacheCreationTokens) cacheParts.push(`缓存写 ${formatNumber(usage.cacheCreationTokens)}`);
    return [
      `Tokens ${formatNumber(usage.totalTokens)}`,
      `输入 ${formatNumber(usage.inputTokens)}`,
      `输出 ${formatNumber(usage.outputTokens)}`,
      ...cacheParts,
      `耗时 ${formatSeconds(metric?.elapsedMs)}`,
    ].join(" · ");
  }

  function nowMs() {
    return window.performance?.now ? window.performance.now() : Date.now();
  }

  function isCodexApiUrl(url) {
    const text = String(url || "");
    return /\/(responses|chat\/completions|conversation|thread|api)\b/i.test(text) || /codex/i.test(text);
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input?.url) return input.url;
    return String(input || "");
  }

  function rememberMetric(metric) {
    if (!metric?.usage) return;
    state.lastMetric = {
      ...metric,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
    };
    state.recent.unshift(state.lastMetric);
    state.recent = state.recent.slice(0, RECENT_LIMIT);
    window.__codexTokenUsage = {
      last: state.lastMetric,
      recent: state.recent.slice(),
    };
    scheduleRender();
  }

  function parseResponseText(text, elapsedMs, url) {
    const usage = extractUsage(text);
    if (usage) rememberMetric({ usage, elapsedMs, url });
  }

  function installFetchObserver() {
    if (typeof window.fetch !== "function" || window.fetch.__codexTokenUsageWrapped) return;
    const originalFetch = window.fetch.bind(window);
    function wrappedFetch(input, init) {
      const url = requestUrl(input);
      const started = nowMs();
      return originalFetch(input, init).then((response) => {
        if (isCodexApiUrl(url) && response?.clone) {
          response
            .clone()
            .text()
            .then((text) => parseResponseText(text, nowMs() - started, url))
            .catch(() => {});
        }
        return response;
      });
    }
    wrappedFetch.__codexTokenUsageWrapped = true;
    window.fetch = wrappedFetch;
  }

  function installXhrObserver() {
    const Xhr = window.XMLHttpRequest;
    if (!Xhr || Xhr.prototype.__codexTokenUsageWrapped) return;
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    Xhr.prototype.open = function open(method, url, ...rest) {
      this.__codexTokenUsageUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function send(...args) {
      const started = nowMs();
      this.addEventListener?.("loadend", () => {
        const url = this.__codexTokenUsageUrl;
        if (!isCodexApiUrl(url)) return;
        try {
          parseResponseText(this.responseText || "", nowMs() - started, url);
        } catch (_) {
          // Ignore unreadable XHR bodies.
        }
      });
      return originalSend.apply(this, args);
    };
    Xhr.prototype.__codexTokenUsageWrapped = true;
  }

  function ensureStyle() {
    if (document.getElementById?.(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 8px 0 0;
        padding: 4px 8px;
        border: 1px solid rgba(99, 102, 241, .26);
        border-radius: 7px;
        background: rgba(99, 102, 241, .08);
        color: inherit;
        font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: .86;
      }
    `;
    document.head?.appendChild(style);
  }

  function latestAssistantNode() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="assistant"]',
      'article:has([data-message-author-role="assistant"])',
      "main article",
      "main [class*='message']",
    ];
    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => node instanceof Element);
        if (nodes.length) return nodes[nodes.length - 1];
      } catch (_) {
        // Some Chromium builds do not support every selector shape.
      }
    }
    return document.querySelector("main") || document.body;
  }

  function renderMetric(metric = state.lastMetric) {
    if (!metric) return;
    ensureStyle();
    const target = latestAssistantNode();
    if (!target) return;
    let badge = target.querySelector?.(`:scope > .${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement("div");
      badge.className = BADGE_CLASS;
      target.appendChild(badge);
    }
    badge.dataset.metricId = metric.id || "";
    badge.textContent = formatBadgeText(metric);
  }

  function scheduleRender() {
    clearTimeout(window.__codexTokenUsageRenderTimer);
    window.__codexTokenUsageRenderTimer = setTimeout(() => renderMetric(), 120);
  }

  function installDomObserver() {
    if (!window.MutationObserver || window.__codexTokenUsageDomObserver) return;
    window.__codexTokenUsageDomObserver = new MutationObserver(() => {
      if (state.lastMetric) scheduleRender();
    });
    const start = () => {
      const root = document.querySelector("main") || document.body || document.documentElement;
      if (root) window.__codexTokenUsageDomObserver.observe(root, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }

  installFetchObserver();
  installXhrObserver();
  installDomObserver();

  if (window.__CODEX_TOKEN_USAGE_SCRIPT_TEST__) {
    window.__codexTokenUsageScriptTest = {
      extractUsage,
      formatBadgeText,
      normalizeUsage,
    };
  }
})();
