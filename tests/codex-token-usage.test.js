const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHelpers() {
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
    },
    elapsedMs: 12345,
  });

  assert.equal(text, "Tokens 1,250 · 输入 1,000 · 输出 250 · 缓存 600 · 耗时 12.3s");
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

  assert.equal(text, "Tokens 46,205 · 输入 - · 输出 - · 上下文 46,205/258,400 · 耗时 -");
});
