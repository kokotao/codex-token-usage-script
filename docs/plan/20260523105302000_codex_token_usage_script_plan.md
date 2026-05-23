# Codex Token Usage Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex++ user script that displays per-response token usage and elapsed seconds after a Codex conversation response finishes.

**Architecture:** A browser userscript monkey-patches `fetch` and `XMLHttpRequest`, parses completed JSON/SSE response bodies for usage metrics, tracks request duration, then renders a small badge near the latest assistant response or the conversation container. The repository also includes a Codex++ script-market `index.json`.

**Tech Stack:** Plain JavaScript userscript, Node.js built-in test runner, Codex++ script market JSON.

---

### Task 1: Script Test Harness

**Files:**
- Create: `tests/codex-token-usage.test.js`
- Create: `package.json`

- [ ] Write failing tests for usage extraction, duration formatting, and badge text.
- [ ] Run `npm test` and confirm tests fail because `scripts/codex-token-usage.js` is missing.

### Task 2: User Script Implementation

**Files:**
- Create: `scripts/codex-token-usage.js`

- [ ] Implement usage extraction from JSON and SSE-style text.
- [ ] Implement fetch/XMLHttpRequest observers and elapsed time tracking.
- [ ] Render a compact badge under the latest assistant response with input/output/cache/total/duration metrics.
- [ ] Expose pure helpers only in test mode as `window.__codexTokenUsageScriptTest`.
- [ ] Run `npm test` and confirm tests pass.

### Task 3: Market Metadata And Docs

**Files:**
- Create: `index.json`
- Create: `README.md`
- Create: `.gitignore`

- [ ] Compute SHA-256 for `scripts/codex-token-usage.js`.
- [ ] Add `index.json` with `script_url` pointing at `https://raw.githubusercontent.com/kokotao/codex-token-usage-script/main/scripts/codex-token-usage.js`.
- [ ] Document installation through Codex++ user scripts and script market.
- [ ] Run JSON validation and tests.

### Task 4: GitHub Publish

**Files:**
- No source changes expected.

- [ ] Commit all files.
- [ ] Create `kokotao/codex-token-usage-script`.
- [ ] Push `main`.
