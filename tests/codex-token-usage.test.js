const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "scripts", "codex-token-usage.js");

function readScriptForDistribution() {
  return fs.readFileSync(SCRIPT_PATH, "utf8").replace(/\r\n/g, "\n");
}

function loadHelpers() {
  const source = readScriptForDistribution();
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
      addEventListener() {},
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
  return sandbox.window.__codexTokenUsageScriptTest;
}

test("index checksum matches distributed script bytes", () => {
  const index = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"),
  );
  const script = index.scripts.find((item) => item.id === "codex-token-usage");
  const hash = crypto
    .createHash("sha256")
    .update(readScriptForDistribution(), "utf8")
    .digest("hex");

  assert.ok(script, "codex-token-usage script entry exists");
  assert.equal(script.sha256, hash);
});

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
    outputTokens: 345,
    totalTokens: 1545,
    cachedTokens: 800,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    hasBreakdown: true,
    contextUsed: 1545,
    contextLimit: 0,
  });
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

  assert.equal(text, "总计 1,250 · 输入 1,000 · 输出 250 · 缓存命中 600 · 缓存命中率 60.0% · 耗时 12.3s");
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

  assert.equal(text, "总计 46,205 · 输入 - · 输出 - · 上下文 46,205/258,400 (17.9%) · 耗时 -");
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
  assert.equal(helpers.formatBadgeText(last), "总计 127,552 · 输入 127,057 · 输出 495 · 缓存命中 125,824 · 缓存命中率 99.0% · 上下文 127,552/258,400 (49.4%) · 耗时 42.0s");
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
  assert.equal(helpers.formatBadgeText(last), "总计 3,350 · 输入 3,000 · 输出 350 · 缓存命中 1,800 · 缓存命中率 60.0% · 调用 2 次 · 耗时 24.0s");
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

test("parseElapsedMs reads Codex processed duration text", () => {
  const helpers = loadHelpers();

  assert.equal(helpers.parseElapsedMs("已处理 2m 7s"), 127000);
  assert.equal(helpers.parseElapsedMs("已处理 45s"), 45000);
  assert.equal(helpers.parseElapsedMs("Processed 1m 5s"), 65000);
});
