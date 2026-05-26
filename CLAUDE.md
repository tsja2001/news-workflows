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
- **多模型协作** (`src/summarize/preprocess.js` + `src/summarize/write-report.js`)：hybrid 模式下 DeepSeek 是“研究助理 + 案头主任”，负责阅读原始素材、筛选、压缩、聚合并输出 `editorialPacket`；Claude 是“最终主编”，默认只读取 `editorialPacket` 做定稿，不再阅读大批量原始素材、不新增事实、不重新扩展素材范围
- **LLM 层** (`llm.js`)：唯一接触 LangChain SDK 的地方，`ChatOpenAI` 连接任意 OpenAI 兼容服务，temperature 默认 0.6（可通过 `LLM_TEMPERATURE` 环境变量覆盖），换模型只改 `.env`
- **输出** (`output.js`)：Markdown 带 YAML frontmatter + JSON 数据文件，精确到秒命名。支持 TL;DR 速读区、三段式关键变化（发生了什么/为什么重要/编辑怎么看）、今日短讯区

## Hybrid 多模型职责边界

`llmPipeline.mode: hybrid` 推荐使用 `preprocess.outputMode: editorialPacket` + `writer.inputMode: editorialPacket`：

- **DeepSeek / preprocess**：读取过滤后的原始新闻，去重合并、剔除弱相关素材、判断主线、提取 evidence，生成 `editorialPacket`。正式主题默认 `maxPacketChars: 8000`，每条主线保留可追溯的 `itemId/source/url/fact`。
- **Claude / writer**：只基于 `editorialPacket` 输出兼容 `output.js` 的最终 report JSON，负责中文表达、标题、排序、合并压缩和强化 `editorTake`。默认 `includeRawSourceItems: false`，不得新增来源、数字、人物、时间、地点，不重新扩展素材范围。
- **审计要求**：`logs/audit` 中应记录 DeepSeek 输入条数、packet 字符数、入选/丢弃数量、Claude 输入字符数、是否附带原始素材、writer token/耗时和 fallback 状态。

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

## 日志与可观测性

运行日志要同时服务两个目标：**当场知道程序跑到哪一步**，以及**事后能定位问题**。

- **控制台进度日志**：运行 `npm run brief <topic-id>` 时，应持续输出关键阶段进度，至少覆盖配置加载、源抓取开始/完成、过滤统计、LLM 各阶段开始/完成、输出文件写入、失败回退等节点。日志要简洁，适合人实时盯运行状态。
- **文件日志**：每次运行都应写入专门的日志文件，放在 `logs/` 下按日期和 runId 组织。文件日志必须包含时间戳、topic、runId、阶段、源名称/类型、模型角色、耗时、token、错误堆栈或错误消息、关键输入输出规模等排障信息。
- **审计日志与普通日志分工**：`logs/audit/` 继续保留结构化 JSONL 审计事件，便于查询和对比；如新增普通运行日志，应记录更完整的人类可读上下文，方便直接打开文件排查。
- **错误日志要求**：捕获异常时不要只打印一句失败，要记录错误类型、message、stack（如有）、当前阶段、相关配置摘要（不能泄露密钥）、以及是否触发 fallback。
- **长期目标**：日志格式保持稳定，便于未来接入 `npm run audit`、按 runId 聚合查看、或自动生成故障诊断摘要。

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

## 测试工程规范

测试是功能开发的一部分。以后新增功能、修 bug、调整模型协作流程或改配置解析时，必须同步新增或更新对应测试，不能只靠手动跑真实任务验证。

- **测试命令**：优先运行 `npm test`。本项目测试使用 Node 内置 `node:test`，需要 Node 20+；如果本机默认 `node` 太旧，可用 `/opt/homebrew/bin/node --test src/**/*.test.js` 验证。
- **自动执行时机**：修改代码后，AI 应按影响范围主动运行测试。小改动至少跑相关 test 文件；核心流程、配置、LLM、输出、日志相关改动要跑全量测试。不能运行测试时，必须在最终回复说明原因。
- **新增功能必须有测试**：新增模块、配置项、分支逻辑、fallback、日志字段、输出字段，都要有最小覆盖测试。修 bug 时先补能复现问题的测试，再修实现。
- **LLM 测试分层**：
  - 单元测试不打真实 API。涉及 DeepSeek、Claude、b.ai、LangChain 的单元测试应 mock 调用层，验证 prompt/input/schema/role/参数/fallback。
  - 模型逻辑验证可以打真实 API，但必须使用测试环境：`ENV_FILE=.env.test` + 测试 YAML。测试环境里的 preprocess/writer 全部配置为 DeepSeek，避免测试场景误调用 Claude/b.ai。
  - 真实生产运行才使用 `.env` 中的 DeepSeek + Claude 混合配置。
- **抓取测试不打真实网络**：RSS/HTML/web/API adapter 测试应使用 fixture 或 mock adapter。调度器测试不得依赖 `example.com`、真实 Playwright 浏览器或外部网站状态。
- **YAML 测试使用测试配置**：需要 YAML 场景时，使用 `config/topics/test-hybrid.yaml` 这类测试主题；如果出现新场景，新增专门的测试 YAML。不要把正式主题 YAML 当作测试夹具直接修改或依赖。模型逻辑验证默认运行 `npm run brief:test-hybrid`。
- **测试/真实环境隔离**：`.env` 是真实运行环境，可配置 DeepSeek + Claude；`.env.test` 是测试 API 环境，只配置 DeepSeek。新增需要真实 API 的测试命令时，必须显式设置 `ENV_FILE=.env.test`。
- **核心链路测试要求**：
  - 配置解析：覆盖 env 替换、缺失 env、默认值、非法配置；
  - fetch/filter：覆盖时间、关键词、排除关键词、去重、截断；
  - hybrid summarize：覆盖 single/hybrid 路由、DeepSeek 预处理失败、Claude writer 失败、fallback 策略；
  - preprocess/write-report：覆盖中间 JSON schema、Claude 输入规模控制、是否附带原始素材；
  - output：覆盖 Markdown frontmatter、关键段落、缺字段兜底；
  - logs/audit：覆盖新增事件字段、错误信息、summary 聚合。
- **测试结果要求**：完成任务前必须知道测试状态。理想状态是全绿；如果存在非本次引入的失败，要明确列出失败测试、原因判断和是否与本次改动相关。

## 文档管理

- 项目根目录只保留两个 `.md` 文件：`CLAUDE.md`（给 AI 看）和 `README.md`（给人看）
- 确保这两个文件内容和项目功能同步，新增功能或改动代码后，判断是否需要在两个文件中体现：CLAUDE.md 侧重架构/规范变更，README.md 侧重用户可见的功能/配置变更。小改动不必动文档
- 其他文档放在 `docs/` 或 `config/` 下，不在根目录散落

## 任务规划 ⚠️

新增任务按以下流程组织（计划与完成文档**不放根目录**）：

1. **任务开始前**：在 `TASK-DOC/<YYYY-MM-DD-HH:mm>/计划.md` 创建任务计划文档
   （如 `TASK-DOC/2026-05-18-15:20-RSS解析计划.md` ,使用东八区时间），
2. **任务完成后**：在同层生成完成文档（如 `TASK-DOC/2026-05-18-16:20-RSS解析完成.md`）
   包含：
   - 做了什么（新增/修改/删除的文件清单）
   - 新功能是什么、如何使用
   - 关键决策与权衡
