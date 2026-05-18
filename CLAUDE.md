# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## 项目概述

基于 **RSS + LLM** 的新闻简报生成工具。从多个 RSS 源拉取新闻 → 时间/关键词过滤 → LLM 主编视角深加工 → 输出 Markdown + JSON 文件。

**RSS 是主力抓取方式**。web/html/playwright/api 适配器保留但仅作补充，不推荐新源使用。

## 常用命令

```bash
npm run brief <topic-id>     # 生成简报
npm run probe <topic-id>     # 探测所有源的可用性（PASS/EMPTY/TIMEOUT/ERROR）
npm run audit -- <command>   # 审计日志查询（list/show/candidates/diff/query/prune）
npm test                     # 运行单元测试（Node 内置 node:test）
```

## 架构：4 阶段流水线

```
index.js (CLI 入口, 串联 4 步)
  → config.js   (1. 加载 config/topics/<id>.yaml → ${ENV} 替换 → 校验)
  → fetch.js    (2. 按 type 路由到 5 个 adapter 并发抓取 → 过滤管线)
  → summarize.js (3. 拼 prompt → llm.js 调 LLM → JSON 解析)
  → output.js   (4. 写 .md (Obsidian 兼容) + .json 到 output.dir)
```

- **抓取调度** (`fetch/index.js`)：按 `source.type` 路由到对应 adapter，按类型独立并发池（rss:8, html/api:5, web/playwright:2），单源失败不中断
- **过滤管线** (`fetch/common.js`)：时间窗口 → 关键词 → URL 去重（含历史去重）→ 排序截断
- **LLM 层** (`llm.js` + `summarize.js`)：唯一接触 LangChain SDK 的地方，`ChatOpenAI` 连接任意 OpenAI 兼容服务，换模型只改 `.env`
- **输出** (`output.js`)：Markdown 带 YAML frontmatter + JSON 数据文件，精确到秒命名

## 抓取适配器

5 个 adapter 通过注册表路由，`type` 未声明时默认 `rss`：

| 适配器 | type | 说明 |
|--------|------|------|
| `fetch/rss.js` | `rss` | **主力**，rss-parser + 可选 Readability 正文回抓 |
| `fetch/html.js` | `html` | 静态站，undici + cheerio 选择器 |
| `fetch/api.js` | `api` | JSON API，通过 yaml `responseShape` 映射字段 |
| `fetch/playwright.js` | `playwright` | JS 渲染站，无头 Chromium |
| `fetch/web.js` | `web` | 通用网页，Playwright + AI 提取（最慢最贵） |

**原则：新源优先找 RSS feed**。很多网站有隐藏的 RSS 接口（WordPress `/feed`、Reuters、AP News 等），参考 `docs/rss-sources-reference.md`。

## 配置系统

- **主题配置**: `config/topics/<topic-id>.yaml` — sources、filter（keywords/lookbackHours/maxItems）、dedup、output.dir
- **环境变量**: `.env` — `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`，以及可选的 `LLM_INPUT_PRICE_PER_1M_TOKENS` / `LLM_OUTPUT_PRICE_PER_1M_TOKENS`（审计成本估算用）
- YAML 中的 `${ENV_VAR}` 会被自动替换为 `process.env` 对应值
- 详细 schema 见 `config/CONFIG_GUIDE.md`

## 辅助工具

- **probe** (`test/probe/probe.js`)：逐源探测可用性，按类型控制并发（web:1, rss:3），PASS 缓存 3 天，支持 `--source`/`--all`/`--reset`/`--full`
- **audit CLI** (`src/cli/audit.js`)：6 个子命令，查询 `logs/audit/` 下的 JSONL 审计日志，支持运行对比、jq 查询、过期清理
- **auditor** (`src/utils/auditor.js`)：每次运行自动生成 JSONL 审计日志 + summary.json，按源追踪、含成本估算

## 关键文件速查

| 文件 | 角色 |
|------|------|
| `src/index.js` | CLI 入口，4 步调度 + 异常兜底 |
| `src/config.js` | YAML 加载、env 替换、校验 |
| `src/fetch/index.js` | 适配器调度 + 按类型并发池 |
| `src/fetch/rss.js` | RSS 适配器（主力） |
| `src/fetch/common.js` | 过滤管线 |
| `src/summarize.js` | LLM prompt 构建 + 响应处理 |
| `src/llm.js` | LLM 调用封装（LangChain） |
| `src/output.js` | Markdown + JSON 输出 |
| `src/state/seen-store.js` | URL 去重持久化（原子写入） |
| `src/utils/auditor.js` | 审计日志系统 |
| `config/CONFIG_GUIDE.md` | 完整配置字段说明 |

## 开发规范

- ES Module (`import`/`export`)，不混入 CommonJS
- 纯 JS + JSDoc 类型注释，不使用 TypeScript
- 中文注释
- camelCase 变量，kebab-case 文件名
- 配置驱动：路径、密钥、模型名全走 yaml 或 `.env`，零硬编码
- 健壮性优先：单源失败不中断、字段缺失不崩溃、原子写入防文件损坏
- 不要重写现有能跑通的代码，只做必要重构
- 遇到不确定的设计决策停下来问人类
