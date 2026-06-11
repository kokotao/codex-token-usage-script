const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHelpers(overrides = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "codex-token-usage.js"),
    "utf8",
  );
  let currentNow = 1000;
  const sessionStorage = {
    values: Object.create(null),
    getItem(key) {
      return this.values[key] ?? null;
    },
    setItem(key, value) {
      this.values[key] = String(value);
    },
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    document: {
      readyState: "complete",
      listeners: {},
      createElement() {
        return {
          className: "",
          dataset: {},
          style: {},
          appendChild() {},
          set textContent(value) {
            this._textContent = value;
          },
          get textContent() {
            return this._textContent || "";
          },
        };
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    location: { href: "https://chatgpt.com/codex" },
    performance: { now: () => currentNow },
    window: {
      __CODEX_TOKEN_USAGE_SCRIPT_TEST__: true,
      addEventListener() {},
      location: { href: "https://chatgpt.com/codex" },
      performance: { now: () => currentNow },
      sessionStorage,
      queueMicrotask(fn) {
        Promise.resolve().then(fn);
      },
      ...overrides,
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.MutationObserver = sandbox.MutationObserver;
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;
  sandbox.window.setInterval = sandbox.setInterval;
  sandbox.window.clearInterval = sandbox.clearInterval;
  sandbox.window.console = console;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    ...sandbox.window.__codexTokenUsageScriptTest,
    advanceTime(ms) {
      currentNow += ms;
    },
  };
}

function loadWindow(overrides = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "codex-token-usage.js"),
    "utf8",
  );
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    document: {
      readyState: "complete",
      listeners: {},
      createElement() {
        return { dataset: {}, style: {}, appendChild() {} };
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    location: { href: "https://chatgpt.com/codex" },
    performance: { now: () => 1000 },
    window: {
      __CODEX_TOKEN_USAGE_SCRIPT_TEST__: true,
      addEventListener() {},
      location: { href: "https://chatgpt.com/codex" },
      performance: { now: () => 1000 },
      ...overrides,
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.MutationObserver = sandbox.MutationObserver;
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;
  sandbox.window.setInterval = sandbox.setInterval;
  sandbox.window.clearInterval = sandbox.clearInterval;
  sandbox.window.console = console;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window;
}

function detailedUsage(totalTokens = 1320) {
  return {
    inputTokens: totalTokens - 120,
    outputTokens: 120,
    totalTokens,
    cachedTokens: 900,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    hasBreakdown: true,
    contextUsed: totalTokens,
    contextLimit: 0,
  };
}

test("extractUsage finds Responses API usage from JSON", () => {
  const helpers = loadHelpers();
  const usage = helpers.extractUsage({
    response: {
      usage: {
        input_tokens: 1200,
        output_tokens: 345,
        total_tokens: 1545,
        input_tokens_details: { cached_tokens: 800 },
      },
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(usage)), {
    inputTokens: 1200,
    inputTotalTokens: 1200,
    outputTokens: 345,
    outputTotalTokens: 345,
    totalTokens: 1545,
    requestTotalTokens: 1545,
    cachedTokens: 800,
    cachedReadTokens: 800,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalEstimated: false,
    hasBreakdown: true,
    contextUsed: 1545,
    contextLimit: 0,
  });
});

test("script exposes version and reinstalls over older injected version", () => {
  const win = loadWindow({
    __codexTokenUsageScriptInstalled: true,
    __codexTokenUsageVersion: "0.1.3",
    __codexTokenUsageMessageObserver: "0.1.3",
  });

  assert.equal(win.__codexTokenUsageVersion, "0.1.7");
  assert.equal(win.__codexTokenUsageMessageObserver, "0.1.7");
  assert.equal(Array.isArray(win.__codexTokenUsageDebug), true);
  assert.equal(win.__codexTokenUsageDebug.length, 0);
  assert.equal(win.__codexTokenUsage.version, "0.1.7");
  assert.equal(typeof win.__codexTokenUsageScriptTest?.processPayload, "function");
});

test("extractUsage finds usage from SSE text", () => {
  const helpers = loadHelpers();
  const usage = helpers.extractUsage(
    [
      "event: response.completed",
      'data: {"response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15,"cache_read_input_tokens":4}}}',
      "",
    ].join("\n"),
  );

  assert.equal(usage.inputTokens, 10);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.cacheReadTokens, 4);
});

test("processPayload aggregates all token_count events from one SSE stream", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("thread-a");
  const calls = [
    { input: 219064, output: 821, cached: 1920 },
    { input: 227050, output: 1192, cached: 0 },
    { input: 22720, output: 719, cached: 5504 },
    { input: 31484, output: 511, cached: 22400 },
    { input: 37206, output: 583, cached: 31104 },
    { input: 49027, output: 2765, cached: 36736 },
    { input: 51864, output: 366, cached: 48512 },
  ];
  const stream = calls
    .map(
      (call) =>
        [
          "event: token_count",
          `data: {"type":"token_count","info":{"model_context_window":258400,"last_token_usage":{"input_tokens":${call.input},"cached_input_tokens":${call.cached},"output_tokens":${call.output},"total_tokens":${call.input + call.output}}}}`,
          "",
        ].join("\n"),
    )
    .join("\n");

  helpers.processPayload(stream, "network", "thread-a", 330000);

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 638415);
  assert.equal(last.usage.outputTokens, 6957);
  assert.equal(last.usage.totalTokens, 645372);
  assert.equal(last.usage.cachedTokens, 146176);
  assert.equal(last.usage.contextLimit, 258400);
  assert.equal(last.callCount, 7);
});

test("processPayload aggregates all usage entries from one post-message array", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("local:019e80d6-ffb9-7193-a84c-ce6374eae5c9");
  const payload = [
    {
      elapsedMs: 24430.100000023842,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 30223,
        outputTokens: 316,
        totalTokens: 30539,
        cachedTokens: 29568,
        contextUsed: 30539,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 36040,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 29649,
        outputTokens: 392,
        totalTokens: 30041,
        cachedTokens: 3456,
        contextUsed: 30041,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 4336.300000011921,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 207485,
        outputTokens: 1522,
        totalTokens: 209007,
        cachedTokens: 3840,
        contextUsed: 209007,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 446080.1999999881,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 213158,
        outputTokens: 237,
        totalTokens: 213395,
        cachedTokens: 210304,
        contextUsed: 213395,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 151140.40000003576,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 211198,
        outputTokens: 1065,
        totalTokens: 212263,
        cachedTokens: 208768,
        contextUsed: 212263,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 180124.30000001192,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 209649,
        outputTokens: 857,
        totalTokens: 210506,
        cachedTokens: 208256,
        contextUsed: 210506,
        contextLimit: 258400,
      },
    },
    {
      elapsedMs: 0,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: 209157,
        outputTokens: 466,
        totalTokens: 209623,
        cachedTokens: 207232,
        contextUsed: 209623,
        contextLimit: 258400,
      },
    },
  ];

  helpers.processPayload(payload, "post-message", "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9", 446080);

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 1110519);
  assert.equal(last.usage.outputTokens, 4855);
  assert.equal(last.usage.totalTokens, 1115374);
  assert.equal(last.usage.cachedTokens, 871424);
  assert.equal(last.usage.contextUsed, 209623);
  assert.equal(last.usage.contextLimit, 258400);
  assert.equal(last.callCount, 7);

  const stored = helpers.getStoredDetails();
  assert.equal(stored[0].callCount, 7);
  assert.equal(stored[0].usage.totalTokens, 1115374);
  assert.equal(stored.every((item) => item.callCount >= 1), true);
});

test("extractUsage finds Codex latestTokenUsageInfo shape", () => {
  const helpers = loadHelpers();
  const usage = helpers.extractUsage({
    modelContextWindow: 258400,
    lastTokenUsage: {
      inputTokens: 3200,
      outputTokens: 900,
      totalTokens: 4100,
      cachedInputTokens: 1200,
    },
  });

  assert.equal(usage.inputTokens, 3200);
  assert.equal(usage.outputTokens, 900);
  assert.equal(usage.totalTokens, 4100);
  assert.equal(usage.cachedTokens, 1200);
  assert.equal(usage.contextLimit, 258400);
});

test("extractUsage finds token_count event shape", () => {
  const helpers = loadHelpers();
  const usage = helpers.extractUsage({
    type: "token_count",
    info: {
      model_context_window: 200000,
      last_token_usage: {
        total_tokens: 54321,
      },
    },
  });

  assert.equal(usage.totalTokens, 54321);
  assert.equal(usage.contextLimit, 200000);
  assert.equal(usage.hasBreakdown, false);
});

test("extractUsage prefers last token_count call usage over cumulative total usage", () => {
  const helpers = loadHelpers();
  const usage = helpers.extractUsage({
    type: "token_count",
    info: {
      model_context_window: 200000,
      total_token_usage: {
        input_tokens: 5000,
        cached_input_tokens: 3200,
        output_tokens: 700,
        total_tokens: 5700,
      },
      last_token_usage: {
        input_tokens: 1200,
        cached_input_tokens: 800,
        output_tokens: 100,
        total_tokens: 1300,
      },
    },
  });

  assert.equal(usage.inputTokens, 1200);
  assert.equal(usage.outputTokens, 100);
  assert.equal(usage.totalTokens, 1300);
  assert.equal(usage.cachedTokens, 800);
  assert.equal(usage.contextLimit, 200000);
});

test("rememberMetric aggregates repeated token_count last-call updates", () => {
  const helpers = loadHelpers();

  helpers.rememberMetric({
    usage: helpers.extractUsage({
      type: "token_count",
      info: {
        model_context_window: 200000,
        total_token_usage: { input_tokens: 5000, output_tokens: 700, total_tokens: 5700 },
        last_token_usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 100, total_tokens: 1300 },
      },
    }),
    elapsedMs: 10000,
    source: "token-count",
    conversationId: "abc",
  });
  helpers.rememberMetric({
    usage: helpers.extractUsage({
      type: "token_count",
      info: {
        model_context_window: 200000,
        total_token_usage: { input_tokens: 7000, output_tokens: 950, total_tokens: 7950 },
        last_token_usage: { input_tokens: 1800, cached_input_tokens: 900, output_tokens: 220, total_tokens: 2020 },
      },
    }),
    elapsedMs: 18000,
    source: "token-count",
    conversationId: "abc",
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 3000);
  assert.equal(last.usage.outputTokens, 320);
  assert.equal(last.usage.totalTokens, 3320);
  assert.equal(last.usage.cachedTokens, 1700);
  assert.equal(last.usage.contextLimit, 200000);
  assert.equal(last.callCount, 2);
});

test("normalizeContextReading converts context meter fallback", () => {
  const helpers = loadHelpers();
  const metric = helpers.normalizeContextReading({
    used: 46205,
    limit: 258400,
    source: "message",
    conversationId: "abc",
  });

  assert.equal(metric.usage.totalTokens, 46205);
  assert.equal(metric.usage.contextLimit, 258400);
  assert.equal(metric.usage.hasBreakdown, false);
  assert.equal(metric.conversationId, "abc");
});

test("formatBadgeText includes tokens, cache, and seconds", () => {
  const helpers = loadHelpers();
  const text = helpers.formatBadgeText({
    usage: {
      inputTokens: 1000,
      outputTokens: 250,
      totalTokens: 1250,
      cachedTokens: 600,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
    },
    elapsedMs: 12345,
  });

  assert.equal(text, "本轮调用合计 1,250 · 输入 1,000 · 输出 250 · 缓存读 600 · 缓存命中率 60.0% · 耗时 12.3s");
});

test("formatBadgeText formats elapsed time as seconds minutes or hours", () => {
  const helpers = loadHelpers();
  const baseMetric = {
    usage: {
      inputTokens: 1000,
      outputTokens: 250,
      totalTokens: 1250,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
    },
  };

  assert.match(helpers.formatBadgeText({ ...baseMetric, elapsedMs: 59900 }), /耗时 59\.9s$/);
  assert.match(helpers.formatBadgeText({ ...baseMetric, elapsedMs: 65000 }), /耗时 1\.1min$/);
  assert.match(helpers.formatBadgeText({ ...baseMetric, elapsedMs: 3900000 }), /耗时 1\.1h$/);
});

test("formatBadgeText labels unknown breakdown from fallback", () => {
  const helpers = loadHelpers();
  const text = helpers.formatBadgeText({
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 46205,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: false,
      contextUsed: 46205,
      contextLimit: 258400,
    },
    elapsedMs: 0,
  });

  assert.equal(text, "本轮调用合计 46,205 · 输入 - · 输出 - · 上下文 46,205/258,400 (17.9%) · 耗时 -");
});

test("mergeMetric keeps detailed usage when context-only update arrives later", () => {
  const helpers = loadHelpers();
  const detailed = {
    usage: {
      inputTokens: 127057,
      outputTokens: 495,
      totalTokens: 127552,
      cachedTokens: 125824,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 127552,
      contextLimit: 0,
    },
    elapsedMs: 42000,
    source: "post-message",
  };
  const contextOnly = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 127552,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: false,
      contextUsed: 127552,
      contextLimit: 258400,
    },
    elapsedMs: 0,
    source: "message",
    conversationId: "abc",
  };

  const merged = helpers.mergeMetric(detailed, contextOnly);

  assert.equal(merged.usage.inputTokens, 127057);
  assert.equal(merged.usage.outputTokens, 495);
  assert.equal(merged.usage.cachedTokens, 125824);
  assert.equal(merged.usage.contextLimit, 258400);
  assert.equal(merged.elapsedMs, 42000);
  assert.equal(merged.conversationId, "abc");
});

test("rememberMetric keeps detailed usage after context-only update", () => {
  const helpers = loadHelpers();
  helpers.rememberMetric({
    usage: {
      inputTokens: 127057,
      outputTokens: 495,
      totalTokens: 127552,
      cachedTokens: 125824,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 127552,
      contextLimit: 0,
    },
    elapsedMs: 42000,
    source: "post-message",
  });
  helpers.rememberMetric({
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 127552,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: false,
      contextUsed: 127552,
      contextLimit: 258400,
    },
    elapsedMs: 0,
    source: "message",
    conversationId: "abc",
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 127057);
  assert.equal(last.usage.outputTokens, 495);
  assert.equal(last.usage.cachedTokens, 125824);
  assert.equal(last.usage.contextLimit, 258400);
  assert.equal(helpers.formatBadgeText(last), "本轮调用合计 127,552 · 输入 127,057 · 输出 495 · 缓存读 125,824 · 缓存命中率 99.0% · 上下文 127,552/258,400 (49.4%) · 调用 1 次 · 耗时 42.0s");
});

test("rememberMetric aggregates multiple model calls in one Codex turn", () => {
  const helpers = loadHelpers();

  helpers.rememberMetric({
    usage: {
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedTokens: 600,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 1100,
      contextLimit: 0,
    },
    elapsedMs: 10000,
    source: "post-message",
    conversationId: "abc",
  });
  helpers.rememberMetric({
    usage: {
      inputTokens: 2000,
      outputTokens: 250,
      totalTokens: 2250,
      cachedTokens: 1200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 2250,
      contextLimit: 0,
    },
    elapsedMs: 24000,
    source: "websocket",
    conversationId: "abc",
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 3000);
  assert.equal(last.usage.outputTokens, 350);
  assert.equal(last.usage.totalTokens, 3350);
  assert.equal(last.usage.cachedTokens, 1800);
  assert.equal(last.callCount, 2);
  assert.equal(helpers.formatBadgeText(last), "本轮调用合计 3,350 · 输入 3,000 · 输出 350 · 缓存读 1,800 · 缓存命中率 60.0% · 调用 2 次 · 耗时 24.0s");
});

test("rememberMetric keeps long-running assistant calls in the same turn", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("thread-a");

  helpers.rememberMetric({ usage: detailedUsage(100963), elapsedMs: 17000, source: "network" });
  helpers.advanceTime(91000);
  helpers.rememberMetric({ usage: detailedUsage(100893), elapsedMs: 106000, source: "network" });
  helpers.advanceTime(123000);
  helpers.rememberMetric({ usage: detailedUsage(105649), elapsedMs: 213000, source: "network" });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.totalTokens, 307505);
  assert.equal(last.callCount, 3);
});

test("rememberMetric aggregates cached post-message usage entries for one reply", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("local:019e80d6-ffb9-7193-a84c-ce6374eae5c9");
  const entries = [
    { inputTokens: 199237, outputTokens: 542, totalTokens: 199779, cachedTokens: 196992, elapsedMs: 40886.10000002384 },
    { inputTokens: 197914, outputTokens: 590, totalTokens: 198504, cachedTokens: 195456, elapsedMs: 42635 },
    { inputTokens: 196232, outputTokens: 925, totalTokens: 197157, cachedTokens: 10112, elapsedMs: 84791.19999998808 },
    { inputTokens: 195594, outputTokens: 613, totalTokens: 196207, cachedTokens: 193920, elapsedMs: 0 },
  ];

  entries.forEach((entry) => {
    helpers.rememberMetric({
      elapsedMs: entry.elapsedMs,
      source: "post-message",
      conversationId: "local:019e80d6-ffb9-7193-a84c-ce6374eae5c9",
      usage: {
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        cachedTokens: entry.cachedTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        hasBreakdown: true,
        contextUsed: entry.totalTokens,
        contextLimit: 258400,
      },
    });
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 788977);
  assert.equal(last.usage.outputTokens, 2670);
  assert.equal(last.usage.totalTokens, 791647);
  assert.equal(last.usage.cachedTokens, 596480);
  assert.equal(last.callCount, 4);
});

test("transient empty conversation id does not split an active turn", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("local:019e8762-c921-7ed3-a343-e705e10e9dab");

  helpers.rememberMetric({
    elapsedMs: 12000,
    source: "post-message",
    conversationId: "local:019e8762-c921-7ed3-a343-e705e10e9dab",
    usage: {
      inputTokens: 24390,
      outputTokens: 352,
      totalTokens: 24742,
      cachedTokens: 23424,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 24742,
      contextLimit: 258400,
    },
  });

  helpers.setActiveConversationId("");

  helpers.rememberMetric({
    elapsedMs: 32000,
    source: "post-message",
    conversationId: "local:019e8762-c921-7ed3-a343-e705e10e9dab",
    usage: {
      inputTokens: 26171,
      outputTokens: 364,
      totalTokens: 26535,
      cachedTokens: 23936,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 26535,
      contextLimit: 258400,
    },
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 50561);
  assert.equal(last.usage.outputTokens, 716);
  assert.equal(last.usage.totalTokens, 51277);
  assert.equal(last.callCount, 2);
});

test("project id becoming available does not split an active turn", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("thread-a");

  helpers.rememberMetric({
    elapsedMs: 12000,
    source: "post-message",
    conversationId: "thread-a",
    usage: {
      inputTokens: 24390,
      outputTokens: 352,
      totalTokens: 24742,
      cachedTokens: 23424,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 24742,
      contextLimit: 258400,
    },
  });

  helpers.setActiveProjectId("project-a");

  helpers.rememberMetric({
    elapsedMs: 32000,
    source: "post-message",
    conversationId: "thread-a",
    usage: {
      inputTokens: 26171,
      outputTokens: 364,
      totalTokens: 26535,
      cachedTokens: 23936,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 26535,
      contextLimit: 258400,
    },
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 50561);
  assert.equal(last.usage.outputTokens, 716);
  assert.equal(last.usage.totalTokens, 51277);
  assert.equal(last.callCount, 2);
});

test("user send starts a fresh turn on the next network request", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(105649), elapsedMs: 213000, source: "network" });

  helpers.dispatchDocumentEvent("keydown", {
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", ariaLabel: "", textContent: "next request" },
  });
  assert.equal(helpers.getDisplayMetric().usage.totalTokens, 105649);

  helpers.markTurnStarted();
  helpers.rememberMetric({ usage: detailedUsage(2450), elapsedMs: 15000, source: "network" });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.totalTokens, 2450);
  assert.equal(last.callCount, 1);
});

test("rememberMetric deduplicates the same model call across observers", () => {
  const helpers = loadHelpers();
  const usage = {
    inputTokens: 1200,
    outputTokens: 120,
    totalTokens: 1320,
    cachedTokens: 900,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    hasBreakdown: true,
    contextUsed: 1320,
    contextLimit: 0,
  };

  helpers.rememberMetric({ usage, elapsedMs: 9000, source: "message", conversationId: "abc" });
  helpers.rememberMetric({ usage, elapsedMs: 11000, source: "post-message", conversationId: "abc" });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 1200);
  assert.equal(last.usage.outputTokens, 120);
  assert.equal(last.usage.totalTokens, 1320);
  assert.equal(last.callCount, 1);
  assert.equal(last.elapsedMs, 11000);
  assert.equal(helpers.formatBadgeText(last), "本轮调用合计 1,320 · 输入 1,200 · 输出 120 · 缓存读 900 · 缓存命中率 75.0% · 调用 1 次 · 耗时 11.0s");
});

test("formatBadgeText labels estimated total and split request/context metrics", () => {
  const helpers = loadHelpers();
  const usage = helpers.normalizeUsage({
    input_tokens: 1200,
    output_tokens: 120,
    cached_input_tokens: 900,
    contextLimit: 258400,
  });

  const text = helpers.formatBadgeText({
    usage,
    callCount: 1,
    elapsedMs: 11000,
  });

  assert.equal(usage.totalEstimated, true);
  assert.equal(usage.requestTotalTokens, 1320);
  assert.equal(usage.inputTotalTokens, 1200);
  assert.equal(usage.outputTotalTokens, 120);
  assert.equal(text, "本轮调用合计 1,320(估算) · 输入 1,200 · 输出 120 · 缓存读 900 · 缓存命中率 75.0% · 上下文 1,320/258,400 (0.5%) · 调用 1 次 · 耗时 11.0s");
});

test("formatBadgeText uses effective input total when cached input exceeds reported input", () => {
  const helpers = loadHelpers();
  const usage = helpers.normalizeUsage({
    input_tokens: 1000,
    cached_input_tokens: 8000,
    output_tokens: 100,
    total_tokens: 9100,
  });

  const text = helpers.formatBadgeText({
    usage,
    callCount: 1,
    elapsedMs: 11000,
  });

  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.inputTotalTokens, 9000);
  assert.equal(text, "本轮调用合计 9,100 · 输入 9,000 · 输出 100 · 缓存读 8,000 · 缓存命中率 88.9% · 调用 1 次 · 耗时 11.0s");
});

test("identical token counts from separate calls are not deduplicated without matching identity", () => {
  const helpers = loadHelpers();
  helpers.setActiveConversationId("thread-a");
  const usage = detailedUsage(1320);

  helpers.rememberMetric({ usage, elapsedMs: 9000, source: "network", conversationId: "thread-a" });
  helpers.advanceTime(1500);
  helpers.rememberMetric({ usage: { ...usage }, elapsedMs: 11000, source: "network", conversationId: "thread-a" });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.callCount, 2);
  assert.equal(last.usage.totalTokens, 2640);
});

test("context-only update from another conversation does not merge into last metric", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network", conversationId: "thread-a" });
  helpers.setActiveConversationId("thread-b");
  helpers.rememberMetric({
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 5000,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: false,
      contextUsed: 5000,
      contextLimit: 258400,
    },
    elapsedMs: 12000,
    source: "context-meter",
    conversationId: "thread-b",
  });

  helpers.setActiveConversationId("thread-a");
  const metric = helpers.getDisplayMetric();
  assert.equal(metric.usage.totalTokens, 1320);
  assert.equal(metric.usage.contextLimit, 0);
});

test("export returns scoped calls and stored details", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });

  const snapshot = helpers.exportUsage();
  assert.equal(snapshot.version, "0.1.7");
  assert.equal(snapshot.activeProjectId, "project-a");
  assert.equal(snapshot.activeConversationId, "thread-a");
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.calls[0].usage.totalTokens, 1320);
  assert.equal(Array.isArray(snapshot.storedDetails), true);
});

test("export includes recent ledger event summaries", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });

  const snapshot = helpers.exportUsage();
  assert.equal(Array.isArray(snapshot.ledgerEvents), true);
  assert.equal(snapshot.ledgerEvents.length, 1);
  assert.equal(snapshot.ledgerEvents[0].kind, "usage");
  assert.equal(snapshot.ledgerEvents[0].source, "network");
  assert.equal(snapshot.ledgerEvents[0].rawSummary.totalTokens, 1320);
});

test("display metric can be rebuilt from ledger when derived caches are cleared", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({
    usage: {
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedTokens: 600,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 1100,
      contextLimit: 0,
    },
    elapsedMs: 10000,
    source: "post-message",
    conversationId: "thread-a",
    projectId: "project-a",
  });
  helpers.rememberMetric({
    usage: {
      inputTokens: 2000,
      outputTokens: 250,
      totalTokens: 2250,
      cachedTokens: 1200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 2250,
      contextLimit: 258400,
    },
    elapsedMs: 24000,
    source: "websocket",
    conversationId: "thread-a",
    projectId: "project-a",
  });

  helpers.resetDerivedStatePreservingLedger();

  const metric = helpers.getDisplayMetric();
  assert.equal(metric.usage.inputTokens, 3000);
  assert.equal(metric.usage.outputTokens, 350);
  assert.equal(metric.usage.totalTokens, 3350);
  assert.equal(metric.callCount, 2);
});

test("history restore rebuilds latest turn from bridge when cache is empty", async () => {
  const helpers = loadHelpers({
    __codexSessionDeleteBridge: async (path, payload) => {
      assert.equal(path, "/thread-usage-history");
      assert.equal(payload.session_id, "thread-a");
      return {
        status: "ok",
        session_id: "thread-a",
        history: [
          {
            source: "rollout-history",
            conversation_id: "thread-a",
            turn_id: "turn-1",
            observed_at: "2026-06-02T05:00:00Z",
            usage: {
              inputTokens: 1000,
              outputTokens: 100,
              totalTokens: 1100,
              cachedTokens: 600,
              contextUsed: 1100,
              contextLimit: 258400,
              hasBreakdown: true,
            },
          },
          {
            source: "rollout-history",
            conversation_id: "thread-a",
            turn_id: "turn-1",
            observed_at: "2026-06-02T05:00:02Z",
            usage: {
              inputTokens: 1200,
              outputTokens: 120,
              totalTokens: 1320,
              cachedTokens: 900,
              contextUsed: 1320,
              contextLimit: 258400,
              hasBreakdown: true,
            },
          },
          {
            source: "rollout-history",
            conversation_id: "thread-a",
            turn_id: "turn-2",
            observed_at: "2026-06-02T05:01:00Z",
            usage: {
              inputTokens: 2000,
              outputTokens: 250,
              totalTokens: 2250,
              cachedTokens: 1200,
              contextUsed: 2250,
              contextLimit: 258400,
              hasBreakdown: true,
            },
          },
        ],
      };
    },
  });

  helpers.setActiveConversationId("thread-a");
  await helpers.restoreHistoryForConversation("thread-a", { force: true });

  const metric = helpers.getDisplayMetric();
  assert.equal(metric.usage.totalTokens, 2250);
  assert.equal(metric.callCount, 1);

  const turns = helpers.getTurnsForActiveConversation();
  assert.equal(turns.length, 2);
  assert.equal(turns[0].usage.totalTokens, 2420);
  assert.equal(turns[0].callCount, 2);
  assert.equal(turns[1].usage.totalTokens, 2250);
});

test("history restore does not crash when bridge has no history", async () => {
  const helpers = loadHelpers({
    __codexSessionDeleteBridge: async () => ({
      status: "failed",
      message: "not found",
      history: [],
    }),
  });

  helpers.setActiveConversationId("thread-a");
  const restored = await helpers.restoreHistoryForConversation("thread-a", { force: true });

  assert.equal(restored, null);
  assert.equal(helpers.getDisplayMetric(), null);
});

test("turn history can be rebuilt from ledger when derived caches are cleared", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network", conversationId: "thread-a", projectId: "project-a" });

  helpers.dispatchDocumentEvent("keydown", {
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", ariaLabel: "", textContent: "next" },
  });
  helpers.markTurnStarted();
  helpers.rememberMetric({ usage: detailedUsage(2450), elapsedMs: 15000, source: "network", conversationId: "thread-a", projectId: "project-a" });

  helpers.resetDerivedStatePreservingLedger();

  const turns = helpers.getTurnsForActiveConversation();
  assert.equal(turns.length, 2);
  assert.equal(turns[0].usage.totalTokens, 1320);
  assert.equal(turns[1].usage.totalTokens, 2450);
});

test("rememberMetric applies context-only update to aggregated turn without adding a call", () => {
  const helpers = loadHelpers();

  helpers.rememberMetric({
    usage: {
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedTokens: 600,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 1100,
      contextLimit: 0,
    },
    elapsedMs: 10000,
    source: "post-message",
    conversationId: "abc",
  });
  helpers.rememberMetric({
    usage: {
      inputTokens: 2000,
      outputTokens: 250,
      totalTokens: 2250,
      cachedTokens: 1200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: true,
      contextUsed: 2250,
      contextLimit: 0,
    },
    elapsedMs: 24000,
    source: "websocket",
    conversationId: "abc",
  });
  helpers.rememberMetric({
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 5000,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hasBreakdown: false,
      contextUsed: 5000,
      contextLimit: 258400,
    },
    elapsedMs: 26000,
    source: "context-meter",
    conversationId: "abc",
  });

  const last = helpers.getTokenUsage().last;
  assert.equal(last.usage.inputTokens, 3000);
  assert.equal(last.usage.outputTokens, 350);
  assert.equal(last.usage.totalTokens, 3350);
  assert.equal(last.usage.contextUsed, 5000);
  assert.equal(last.usage.contextLimit, 258400);
  assert.equal(last.callCount, 2);
});

test("running status is scoped to the active conversation", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.markTurnStarted();

  let status = helpers.getDisplayMetric();
  assert.equal(status.status, "running");
  assert.equal(status.conversationId, "thread-a");
  assert.equal(helpers.formatBadgeText(status), "运行中 · 正在统计本次回复 token...");

  helpers.setActiveConversationId("thread-b");
  assert.equal(helpers.getDisplayMetric(), null);
});

test("completed conversation metric is not hidden by an empty running turn", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(105649), elapsedMs: 213000, source: "network" });
  helpers.advanceTime(121000);
  helpers.markTurnStarted();

  const metric = helpers.getDisplayMetric();
  assert.equal(metric.status, undefined);
  assert.equal(metric.usage.totalTokens, 105649);
  assert.equal(metric.callCount, 1);
});

test("completed metric stays visible when next turn has only an empty running state", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });

  helpers.dispatchDocumentEvent("keydown", {
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", ariaLabel: "", textContent: "next" },
  });
  helpers.markTurnStarted();

  const metric = helpers.getDisplayMetric();
  assert.equal(metric.status, undefined);
  assert.equal(metric.usage.totalTokens, 1320);
  assert.equal(metric.callCount, 1);
});

test("typing or pressing enter does not show running before an API request", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.dispatchDocumentEvent("keydown", {
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", ariaLabel: "", textContent: "hello" },
  });

  assert.equal(helpers.getDisplayMetric(), null);
});

test("conversation switch does not display previous conversation metric", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });
  assert.equal(helpers.getDisplayMetric().conversationId, "thread-a");

  helpers.setActiveConversationId("thread-b");
  assert.equal(helpers.getDisplayMetric(), null);
});

test("conversation switch restores cached metric for that conversation", () => {
  const helpers = loadHelpers();

  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });
  helpers.setActiveConversationId("thread-b");
  helpers.rememberMetric({ usage: detailedUsage(2450), elapsedMs: 15000, source: "network" });

  assert.equal(helpers.getDisplayMetric().usage.totalTokens, 2450);
  helpers.setActiveConversationId("thread-a");
  assert.equal(helpers.getDisplayMetric().usage.totalTokens, 1320);
});

test("same conversation id is isolated across projects", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });

  helpers.setActiveProjectId("project-b");
  helpers.setActiveConversationId("thread-a");
  assert.equal(helpers.getDisplayMetric(), null);

  helpers.rememberMetric({ usage: detailedUsage(2450), elapsedMs: 15000, source: "network" });
  assert.equal(helpers.getDisplayMetric().usage.totalTokens, 2450);

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  assert.equal(helpers.getDisplayMetric().usage.totalTokens, 1320);
});

test("same conversation keeps turns isolated while displaying the latest turn", () => {
  const helpers = loadHelpers();

  helpers.setActiveProjectId("project-a");
  helpers.setActiveConversationId("thread-a");
  helpers.rememberMetric({ usage: detailedUsage(1320), elapsedMs: 11000, source: "network" });
  const firstTurn = helpers.getDisplayMetric();

  helpers.dispatchDocumentEvent("keydown", {
    key: "Enter",
    shiftKey: false,
    target: { tagName: "TEXTAREA", ariaLabel: "", textContent: "next" },
  });
  helpers.markTurnStarted();
  helpers.rememberMetric({ usage: detailedUsage(2450), elapsedMs: 15000, source: "network" });

  const latest = helpers.getDisplayMetric();
  assert.equal(latest.usage.totalTokens, 2450);
  assert.notEqual(latest.turnId, firstTurn.turnId);

  const turns = helpers.getTurnsForActiveConversation();
  assert.equal(turns.length, 2);
  assert.equal(turns[0].usage.totalTokens, 1320);
  assert.equal(turns[1].usage.totalTokens, 2450);
});

test("parseElapsedMs reads Codex processed duration text", () => {
  const helpers = loadHelpers();

  assert.equal(helpers.parseElapsedMs("已处理 2m 7s"), 127000);
  assert.equal(helpers.parseElapsedMs("已处理 45s"), 45000);
  assert.equal(helpers.parseElapsedMs("Processed 1m 5s"), 65000);
});
