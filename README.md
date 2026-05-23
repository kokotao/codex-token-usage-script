# Codex Token Usage Script

Codex++ 用户脚本插件。它会在 Codex 每次对话响应完成后，在当前会话页面显示本次响应使用的 token 和耗时。

GitHub 地址：

```text
https://github.com/kokotao/codex-token-usage-script
```

## 功能

- 显示总 token、输入 token、输出 token。
- 显示缓存 token，包括 `cached_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`。
- 显示本次请求耗时，单位为秒。
- 支持 JSON 响应和 SSE 文本响应中的 `usage` 字段。
- 以 Codex++ 用户脚本形式运行，不需要修改 Codex App 文件。

## 安装方式

### 方式一：手动安装

1. 打开 Codex++ 管理工具。
2. 进入“用户脚本”页面，查看本地用户脚本目录。
3. 将 `scripts/codex-token-usage.js` 放入用户脚本目录。
4. 在 Codex++ 中重新加载用户脚本，或重启 Codex++。

macOS 默认目录通常是：

```text
~/.config/Codex++/user_scripts
```

### 方式二：脚本市场

如果你维护自己的 Codex++ 脚本市场，可以将本仓库的 `index.json` 合并到市场清单，或直接引用：

```text
https://raw.githubusercontent.com/kokotao/codex-token-usage-script/main/index.json
```

## 显示示例

```text
Tokens 1,250 · 输入 1,000 · 输出 250 · 缓存 600 · 耗时 12.3s
```
<img width="1590" height="1200" alt="53cc1e7d683b12b70492bad352c23074" src="https://github.com/user-attachments/assets/5429c882-78e7-461e-bc52-8be222346ba2" />

## 开发验证

```bash
npm test
npm run check:index
```

## 注意

Codex 页面结构和 API 响应字段可能随版本变化。插件会尽量从常见的 Responses API、Chat Completions 和 SSE 片段里提取 `usage`，如果上游页面或字段变化，可能需要更新选择器或解析逻辑。
