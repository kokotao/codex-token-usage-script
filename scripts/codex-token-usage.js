(() => {
  "use strict";

  const SCRIPT_ID = "codex-token-usage";
  const BADGE_CLASS = "codex-token-usage-badge";
  const STYLE_ID = "codex-token-usage-style";
  const RECENT_LIMIT = 20;
  const CONTEXT_POLL_INTERVAL_MS = 1000;

  if (window.__codexTokenUsageScriptInstalled) return;
  window.__codexTokenUsageScriptInstalled = true;

  const state = {
    lastMetric: null,
    lastMetricKey: "",
    recent: [],
    turnStartedAt: 0,
    contextPollTimer: 0,
  };

  function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
  }

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const inputTokens = normalizeNumber(raw.input_tokens ?? raw.inputTokens ?? raw.prompt_tokens ?? raw.promptTokens);
    const outputTokens = normalizeNumber(
      raw.output_tokens ?? raw.outputTokens ?? raw.completion_tokens ?? raw.completionTokens,
    );
    const totalTokens = normalizeNumber(
      raw.total_tokens ?? raw.totalTokens ?? raw.usedTokens ?? raw.used_tokens ?? raw.used ?? inputTokens + outputTokens,
    );
    const cachedTokens = normalizeNumber(
      raw.cached_tokens ??
        raw.cachedTokens ??
        raw.cached_input_tokens ??
        raw.cachedInputTokens ??
        raw.prompt_tokens_details?.cached_tokens ??
        raw.promptTokensDetails?.cachedTokens ??
        raw.input_tokens_details?.cached_tokens ??
        raw.inputTokensDetails?.cachedTokens,
    );
    const cacheReadTokens = normalizeNumber(raw.cache_read_input_tokens ?? raw.cacheReadInputTokens);
    const cacheCreationTokens = normalizeNumber(raw.cache_creation_input_tokens ?? raw.cacheCreationInputTokens);
    const contextLimit = normalizeNumber(raw.modelContextWindow ?? raw.model_context_window ?? raw.contextWindow ?? raw.context_window ?? raw.limit);
    if (
      !inputTokens &&
      !outputTokens &&
      !totalTokens &&
      !cachedTokens &&
      !cacheReadTokens &&
      !cacheCreationTokens &&
      !contextLimit
    ) {
      return null;
    }
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedTokens,
      cacheReadTokens,
      cacheCreationTokens,
      hasBreakdown: !!(inputTokens || outputTokens || cachedTokens || cacheReadTokens || cacheCreationTokens),
      contextUsed: totalTokens,
      contextLimit,
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

    const tokenStatus = value.last || value.lastUsage || value.lastTokenUsage || value.last_token_usage;
    if (tokenStatus && (value.modelContextWindow || value.model_context_window || value.contextWindow || value.context_window)) {
      const statusUsage = normalizeUsage({
        ...tokenStatus,
        modelContextWindow: value.modelContextWindow ?? value.model_context_window,
        contextWindow: value.contextWindow ?? value.context_window,
      });
      if (statusUsage) return statusUsage;
    }

    for (const key of ["usage", "last", "lastUsage", "lastTokenUsage", "last_token_usage"]) {
      const direct = normalizeUsage(value[key]);
      if (direct) return direct;
    }

    const self = normalizeUsage(value);
    if (self) return self;

    for (const key of [
      "response",
      "data",
      "body",
      "message",
      "result",
      "event",
      "params",
      "tokenUsage",
      "token_usage",
      "contextUsage",
      "context_usage",
      "info",
    ]) {
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
    const parts = [`Tokens ${formatNumber(usage.totalTokens)}`];
    if (usage.hasBreakdown || usage.inputTokens || usage.outputTokens) {
      parts.push(`输入 ${formatNumber(usage.inputTokens)}`, `输出 ${formatNumber(usage.outputTokens)}`, ...cacheParts);
    } else {
      parts.push("输入 -", "输出 -");
    }
    if (usage.contextLimit) {
      parts.push(`上下文 ${formatNumber(usage.contextUsed || usage.totalTokens)}/${formatNumber(usage.contextLimit)}`);
    }
    parts.push(`耗时 ${Number.isFinite(metric?.elapsedMs) && metric.elapsedMs > 0 ? formatSeconds(metric.elapsedMs) : "-"}`);
    return parts.join(" · ");
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

  function metricKey(metric) {
    const usage = metric?.usage || {};
    return [
      metric?.conversationId || "",
      metric?.source || "",
      usage.totalTokens || 0,
      usage.inputTokens || 0,
      usage.outputTokens || 0,
      usage.cachedTokens || 0,
      usage.cacheReadTokens || 0,
      usage.cacheCreationTokens || 0,
      usage.contextLimit || 0,
    ].join(":");
  }

  function markTurnStarted(started = nowMs()) {
    state.turnStartedAt = started;
  }

  function elapsedSinceTurnStarted() {
    return state.turnStartedAt ? nowMs() - state.turnStartedAt : 0;
  }

  function rememberMetric(metric) {
    if (!metric?.usage) return;
    const nextKey = metricKey(metric);
    if (nextKey && nextKey === state.lastMetricKey) {
      scheduleRender();
      return;
    }
    state.lastMetricKey = nextKey;
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
    if (usage) rememberMetric({ usage, elapsedMs, url, source: "network" });
  }

  function inspectPayload(payload, source, conversationId) {
    const usage = extractUsage(payload);
    if (usage) {
      rememberMetric({ usage, elapsedMs: elapsedSinceTurnStarted(), source, conversationId });
      return true;
    }
    return false;
  }

  function inspectPayloadText(text, source, conversationId) {
    return inspectPayload(text, source, conversationId);
  }

  function installFetchObserver() {
    if (typeof window.fetch !== "function" || window.fetch.__codexTokenUsageWrapped) return;
    const originalFetch = window.fetch.bind(window);
    function wrappedFetch(input, init) {
      const url = requestUrl(input);
      const started = nowMs();
      if (isCodexApiUrl(url)) markTurnStarted(started);
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
      if (isCodexApiUrl(this.__codexTokenUsageUrl)) markTurnStarted(started);
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

  function installPostMessageObserver() {
    if (window.__codexTokenUsageMessageObserver) return;
    window.addEventListener?.(
      "message",
      (event) => {
        try {
          inspectPayload(event.data, "post-message");
        } catch (_) {
          // Ignore unrelated window messages.
        }
      },
      true,
    );
    window.__codexTokenUsageMessageObserver = true;
  }

  function installWebSocketObserver() {
    if (typeof window.WebSocket !== "function" || window.__codexTokenUsageWebSocketWrapped) return;
    const NativeWebSocket = window.WebSocket;

    function TokenUsageWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      socket.addEventListener?.("message", (event) => {
        try {
          if (typeof event.data === "string") {
            inspectPayloadText(event.data, "websocket");
          } else if (event.data instanceof Blob && event.data.size <= 512000) {
            event.data.text().then((text) => inspectPayloadText(text, "websocket")).catch(() => {});
          }
        } catch (_) {
          // Keep socket delivery untouched.
        }
      });
      return socket;
    }

    try {
      TokenUsageWebSocket.prototype = NativeWebSocket.prototype;
      Object.defineProperty(TokenUsageWebSocket, "CONNECTING", { value: NativeWebSocket.CONNECTING });
      Object.defineProperty(TokenUsageWebSocket, "OPEN", { value: NativeWebSocket.OPEN });
      Object.defineProperty(TokenUsageWebSocket, "CLOSING", { value: NativeWebSocket.CLOSING });
      Object.defineProperty(TokenUsageWebSocket, "CLOSED", { value: NativeWebSocket.CLOSED });
    } catch (_) {
      // Constants are best-effort compatibility helpers.
    }

    window.WebSocket = TokenUsageWebSocket;
    window.__codexTokenUsageWebSocketWrapped = true;
  }

  function normalizeContextReading(reading) {
    if (!reading || typeof reading !== "object") return null;
    const used = normalizeNumber(reading.used ?? reading.usedTokens ?? reading.used_tokens);
    const limit = normalizeNumber(reading.limit ?? reading.contextWindow ?? reading.context_window);
    if (!used && !limit) return null;
    return {
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: used,
        cachedTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        hasBreakdown: false,
        contextUsed: used,
        contextLimit: limit,
      },
      elapsedMs: elapsedSinceTurnStarted(),
      source: reading.source || "context-meter",
      conversationId: reading.conversationId || "",
    };
  }

  function rememberContextReading(reading) {
    const metric = normalizeContextReading(reading);
    if (metric) rememberMetric(metric);
  }

  function readContextMeterMetric() {
    try {
      const meterState = window.__codexContextMeter?.getState?.();
      rememberContextReading(meterState?.lastReading);
    } catch (_) {
      // Ignore unavailable or changing third-party script state.
    }
  }

  function installContextMeterObserver() {
    const captureState = window.__codexContextMeterCaptureState;
    if (captureState && !captureState.__codexTokenUsageWrapped) {
      const originalInspectText = captureState.inspectText;
      if (typeof originalInspectText === "function") {
        captureState.inspectText = function codexTokenUsageInspectText(text, source, conversationId) {
          const started = elapsedSinceTurnStarted();
          try {
            const usage = extractUsage(text);
            if (usage) rememberMetric({ usage, elapsedMs: started, source: source || "context-capture", conversationId });
          } catch (_) {
            // Keep the upstream context meter path intact.
          }
          return originalInspectText.apply(this, arguments);
        };
      }

      const originalInspectValue = captureState.inspectValue;
      if (typeof originalInspectValue === "function") {
        captureState.inspectValue = function codexTokenUsageInspectValue(value, source, conversationId) {
          let reading = null;
          try {
            const usage = extractUsage(value);
            if (usage) rememberMetric({ usage, elapsedMs: elapsedSinceTurnStarted(), source: source || "context-value", conversationId });
          } catch (_) {
            // Continue to the original inspector.
          }
          reading = originalInspectValue.apply(this, arguments);
          rememberContextReading(reading);
          return reading;
        };
      }
      captureState.__codexTokenUsageWrapped = true;
    }

    readContextMeterMetric();
    if (!state.contextPollTimer) {
      state.contextPollTimer = window.setInterval?.(() => {
        installContextMeterObserver();
        readContextMeterMetric();
      }, CONTEXT_POLL_INTERVAL_MS);
    }
  }

  function installTurnActivityObserver() {
    if (window.__codexTokenUsageActivityObserver) return;
    const markFromEvent = (event) => {
      const target = event.target;
      const text = `${target?.tagName || ""} ${target?.ariaLabel || ""} ${target?.textContent || ""}`;
      if (
        event.type === "submit" ||
        (event.type === "keydown" && event.key === "Enter" && !event.shiftKey) ||
        /send|submit|发送|提交/i.test(text)
      ) {
        markTurnStarted();
      }
    };
    ["click", "submit", "keydown"].forEach((type) => {
      document.addEventListener?.(type, markFromEvent, true);
    });
    window.__codexTokenUsageActivityObserver = true;
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
  installPostMessageObserver();
  installWebSocketObserver();
  installContextMeterObserver();
  installTurnActivityObserver();
  installDomObserver();

  if (window.__CODEX_TOKEN_USAGE_SCRIPT_TEST__) {
    window.__codexTokenUsageScriptTest = {
      extractUsage,
      formatBadgeText,
      normalizeUsage,
      normalizeContextReading,
    };
  }
})();
