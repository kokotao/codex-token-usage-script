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
