# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## 项目概述

基于 **RSS + LLM** 的新闻简报生成工具。从多个 RSS 源拉取新闻 → 时间/关键词/排除关键词过滤 → LLM 主编视角深加工 → 输出 Markdown + JSON 文件。

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
- **过滤管线** (`fetch/common.js`)：时间窗口 → 关键词匹配 → 排除关键词剔除 → URL 去重（含历史去重）→ 排序截断
- **编辑层** (`src/summarize.js`)：`buildSystemPrompt(editorial)` 动态生成 LLM 角色设定，`buildUserPrompt(items, config)` 注入读者画像、排除话题、关注方向。支持 yaml `editorial:` 段控制 persona/tone/interests/excludeTopics/lowAttentionHandling 等
- **LLM 层** (`llm.js`)：唯一接触 LangChain SDK 的地方，`ChatOpenAI` 连接任意 OpenAI 兼容服务，temperature 默认 0.6（可通过 `LLM_TEMPERATURE` 环境变量覆盖），换模型只改 `.env`
- **输出** (`output.js`)：Markdown 带 YAML frontmatter + JSON 数据文件，精确到秒命名。支持 TL;DR 速读区、三段式关键变化（发生了什么/为什么重要/编辑怎么看）、今日短讯区

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

- **主题配置**: `config/topics/<topic-id>.yaml` — sources、filter（keywords/lookbackHours/maxItems）、dedup、output.dir、editorial（可选，控制 LLM 写作风格和筛选）
- **环境变量**: `.env` — `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_TEMPERATURE`、`NEWS_BRIEFS_ROOT`，以及可选的 `LLM_INPUT_PRICE_PER_1M_TOKENS` / `LLM_OUTPUT_PRICE_PER_1M_TOKENS`（审计成本估算用）
- YAML 中的 `${ENV_VAR}` 会被自动替换为 `process.env` 对应值，未定义则报错
- `output.dir` 使用 `${NEWS_BRIEFS_ROOT}/子文件夹名` 格式，根目录由 env 统一管理
- 详细 schema 见 `config/CONFIG_GUIDE.md`

### editorial 段（可选）

```yaml
editorial:
  persona: "私人内参编辑"           # LLM 人设
  tone: "口语化、有立场、敢下判断"   # 写作风格
  interests: [读者关心的方向]        # LLM 优先呈现
  excludeTopics: [读者不要的话题]    # LLM 阶段软过滤
  excludeKeywords: [关键词列表]      # fetch 阶段硬过滤（大小写不敏感）
  lowAttentionHandling: brief        # brief | drop | expand
  tldr:
    enabled: true
    maxItems: 5
  keyDevelopmentsLimit:
    high: 5
    medium: 3
  mergeContextIntoOverview: true     # 合并旧版 context 段到 overview
```

整个 `editorial` 段可省略，缺失时走代码内默认值，向后兼容。

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
| `src/fetch/common.js` | 过滤管线（时间/关键词/排除关键词/去重/排序） |
| `src/summarize.js` | LLM prompt 构建（动态 system prompt + editorial 注入） |
| `src/llm.js` | LLM 调用封装（LangChain, temperature 0.6） |
| `src/output.js` | Markdown + JSON 输出（TL;DR/三段/短讯/frontmatter） |
| `src/state/seen-store.js` | URL 去重持久化（原子写入） |
| `src/utils/auditor.js` | 审计日志系统 |
| `config/CONFIG_GUIDE.md` | 完整配置字段说明（含 editorial 段文档） |

## 开发规范

- ES Module (`import`/`export`)，不混入 CommonJS
- 纯 JS + JSDoc 类型注释，不使用 TypeScript
- 中文注释
- camelCase 变量，kebab-case 文件名
- 配置驱动：路径、密钥、模型名全走 yaml 或 `.env`，零硬编码
- 健壮性优先：单源失败不中断、字段缺失不崩溃、原子写入防文件损坏
- 不要重写现有能跑通的代码，只做必要重构
- 遇到不确定的设计决策停下来问人类

## 文档管理

- 项目根目录只保留两个 `.md` 文件：`CLAUDE.md`（给 AI 看）和 `README.md`（给人看）
- 确保这两个文件内容和项目功能同步，新增功能或改动代码后，判断是否需要在两个文件中体现：CLAUDE.md 侧重架构/规范变更，README.md 侧重用户可见的功能/配置变更。小改动不必动文档
- 其他文档放在 `docs/` 或 `config/` 下，不在根目录散落
