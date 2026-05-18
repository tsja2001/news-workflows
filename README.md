# news-workflows

基于 **RSS 订阅 + LLM 深加工** 的新闻简报自动生成工具。从多个 RSS 源拉取新闻，经过时间/关键词/去重过滤后，交给大模型以「主编」视角深度加工，输出结构化的中文简报（Markdown + JSON）。

## 目录

- [为什么选 RSS](#为什么选-rss)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [架构：4 阶段流水线](#架构4-阶段流水线)
- [抓取适配器](#抓取适配器)
- [过滤管线](#过滤管线)
- [LLM 深加工](#llm-深加工)
- [输出模块](#输出模块)
- [辅助工具](#辅助工具)
- [历史去重](#历史去重)
- [配置参考](#配置参考)
- [技术选型](#技术选型)
- [设计原则](#设计原则)

---

## 为什么选 RSS

网页抓取面临越来越严重的反爬问题——验证码、IP 封禁、JS 挑战、内容混淆，维护成本极高且不稳定。**RSS 是媒体主动提供的结构化接口**，天然无反爬、速度快、格式统一。

| 对比 | RSS | 网页抓取 |
|------|-----|---------|
| 速度 | 30~60 秒完成全部源 | 10~50 分钟 |
| 稳定性 | 无反爬，几乎不出错 | 频繁超时、验证码 |
| LLM 成本 | 低（摘要已在 feed 中） | 高（需 AI 提取正文） |
| 维护成本 | 几乎为零 | 每个站点都需要调试 |

因此本项目**以 RSS 为主要抓取方式**。网页抓取适配器（web/html/playwright）仍然保留，但仅作为个别无 RSS 源时的补充手段。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
LLM_API_KEY=sk-your-key-here
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
```

支持任何 OpenAI 兼容接口：DeepSeek、通义千问、Moonshot/Kimi、智谱 GLM、OpenAI 等。

### 3. 配置主题

编辑 `config/topics/` 下的 YAML 文件（或新建你自己的），至少设置 `output.dir` 为你的输出目录。推荐使用 RSS 源，参考 `global-geopolitical-conflicts-rss.yaml`。

### 4. 生成简报

```bash
npm run brief <topic-id>
```

示例：

```bash
npm run brief global-geopolitical-conflicts-rss
```

### 5. 测试源可用性

```bash
npm run probe <topic-id>
```

对配置中的所有源逐一探测，输出 PASS/EMPTY/TIMEOUT/ERROR 状态，方便排查失效源。

---

## 目录结构

```
news-workflows/
├── src/
│   ├── index.js              # CLI 入口，串联 4 步流程
│   ├── config.js             # YAML 加载、${ENV} 替换、校验
│   ├── fetch.js              # 抓取入口：调度 + 过滤 + 去重
│   ├── summarize.js          # 构建 prompt，调 LLM 生成简报
│   ├── llm.js                # LLM 调用封装（LangChain）
│   ├── output.js             # 写 Markdown + JSON 到 output.dir
│   │
│   ├── fetch/                # 抓取适配器层
│   │   ├── index.js          #   调度器：按 source.type 路由 + 按类型并发池
│   │   ├── rss.js            #   RSS 适配器（主力，+ 正文回抓）
│   │   ├── html.js           #   静态 HTML 爬虫（cheerio）
│   │   ├── api.js            #   JSON API 适配器
│   │   ├── playwright.js     #   JS 渲染站爬虫
│   │   ├── web.js            #   AI 通用网页抓取（Playwright + LLM）
│   │   ├── extractor.js      #   正文提取（Readability → cheerio 降级）
│   │   ├── common.js         #   过滤管线：时间/关键词/去重/排序
│   │   ├── types.js          #   JSDoc 类型定义
│   │   └── web/              #   type: web 子模块（browser, extract, prompts）
│   │
│   ├── utils/
│   │   ├── logger.js         #   步骤化日志器（ANSI 颜色 + 自动截断）
│   │   ├── auditor.js        #   JSONL 审计日志（按源追踪、成本估算）
│   │   └── html-cleaner.js   #   HTML 瘦身（LLM 友好格式）
│   │
│   ├── state/
│   │   └── seen-store.js     #   历史去重存储（原子写入，按 topic 隔离）
│   │
│   └── cli/
│       ├── audit.js           #   审计 CLI 入口
│       └── audit-commands/    #   list, show, candidates, diff, query, prune
│
├── config/
│   ├── CONFIG_GUIDE.md       # 详细配置指南
│   └── topics/
│       ├── global-geopolitical-conflicts-rss.yaml   # ★ 推荐：纯 RSS，30+ 源
│       ├── global-geopolitical-conflicts.yaml       # 旧版：web 抓取，25+ 源
│       ├── global-geopolitical-conflicts-test.yaml  # 测试用：每个源 1 URL
│       └── global-news.yaml                        # 通用新闻（RSS + web 混合）
│
├── test/
│   ├── probe/
│   │   ├── probe.js          #   源可用性探测工具
│   │   ├── state.json        #   探测状态缓存（PASS 有效期 3 天）
│   │   └── results/          #   探测结果输出
│   └── fixtures/             #   测试用 HTML fixture
│
├── docs/
│   ├── source-types.md       # Source type 配置参考
│   ├── rss-sources-reference.md  # RSS 源大全（~200 个源整理）
│   └── usage-guide使用指南.md
│
├── state/                    # 运行时状态（gitignore）
│   └── seen-urls.json        #   历史去重数据库
│
├── logs/                     # 审计日志（gitignore）
│   └── audit/                #   按日期组织：{date}/{topic}-{runId}.jsonl
│
├── package.json
├── .env.example
└── .gitignore
```

---

## 架构：4 阶段流水线

```
config/topics/<topic>.yaml    你只需维护一个 YAML 文件
       │
       ▼
  src/index.js                 CLI 入口，串联 4 个步骤
       │
       ├── 1. config.js        加载 YAML → ${ENV} 替换 → 校验
       ├── 2. fetch.js         多 adapter 并发抓取 → 过滤管线
       ├── 3. summarize.js     拼 prompt → LLM 主编深加工
       └── 4. output.js        写 .md（人读）+ .json（程序读）
```

### 步骤 1 — 加载配置 (`config.js`)

- 从 `config/topics/<id>.yaml` 读取主题配置
- 递归替换 `${VAR}` 为 `process.env.VAR`（未定义则报错）
- 校验必填字段：`id`、`title`、`sources`、`output.dir`

### 步骤 2 — 抓取新闻 (`fetch.js`)

- 遍历 `sources[]`，按 `type` 字段路由到对应 adapter
- **按类型分池并发**：RSS 高并发（8）、web 严格限制（2），互不拖慢
- 支持全局源超时，超时源作失败处理
- 单个源失败不影响其他源（返回空数组，继续流程）
- 所有结果汇合后走过滤管线（时间 → 关键词 → 去重 → 排序截断）

### 步骤 3 — LLM 深加工 (`summarize.js`)

- 将 LLM 定位为「资深国际新闻主编」，进行三层加工：梳理整合 → 提炼升华 → 复盘洞察
- 使用 LangChain `ChatOpenAI` 调用任意 OpenAI 兼容 API
- 返回结构化 JSON：概览、关键变化、背景、时间线、信号、风险、信息缺口、主编复盘

### 步骤 4 — 输出文件 (`output.js`)

- 输出 Markdown（带 YAML frontmatter，Obsidian 兼容）+ JSON 数据文件
- 文件名精确到秒：`2026-05-05-143052-地缘政治速报.md`，同一天多次运行不覆盖
- 字段缺失时显示「（无）」而不是崩溃

---

## 抓取适配器

所有 adapter 遵循统一签名，返回 `NewsItem[]`。调度器通过注册表按 `source.type` 路由：

```js
const ADAPTERS = {
  rss: fetchFromRss,           // ★ 主力，默认类型
  html: fetchFromHtml,
  api: fetchFromApi,
  playwright: fetchFromPlaywright,
  web: fetchFromWeb,
}
```

### RSS 适配器 (`type: rss`) ★ 推荐

默认类型，大多数场景的首选。基于 `rss-parser` 解析 RSS 2.0 / Atom feed，15 秒超时 + 指数退避重试。

**正文回抓**：开启 `fetchFullContent: true` 后，对每条 RSS 条目用 Readability 回抓原文正文，弥补某些 feed 摘要过短的问题。

```yaml
sources:
  - name: Reuters World
    type: rss
    url: "https://feeds.reuters.com/reuters/worldNews"
    fetchFullContent: true      # 可选，回抓正文
    maxArticles: 20             # 可选，限制取条数
```

### 其他适配器

| 适配器 | 适用场景 | 备注 |
|--------|---------|------|
| `html` | 无 RSS 的静态网站 | cheerio CSS 选择器提取 |
| `api` | 有 JSON API 的数据源 | 通过 yaml `responseShape` 映射字段 |
| `playwright` | 需 JS 渲染的 SPA 站 | 无头 Chromium，资源消耗大 |
| `web` | 完全无接口的网站 | Playwright + AI 提取，最慢最贵 |

> **建议**：新源优先找 RSS feed。很多网站虽然不展示 RSS 链接，但实际提供 RSS（如 WordPress 站加 `/feed`）。参考 `docs/rss-sources-reference.md` 整理了约 200 个可用的新闻 RSS 源。

### 正文提取器 (`extractor.js`)

Readability 优先 → 失败降级 cheerio 语义选择器 → 仍不足 100 字返回空。供 RSS 正文回抓和 html 适配器共用。

---

## 过滤管线

所有 adapter 的产出统一经过 `src/fetch/common.js` 的过滤管线：

```
原始条目 → 时间窗口过滤 → 关键词过滤 → URL 去重 → 时间排序 → 截取前 N 条
```

- **时间过滤**：只保留 `lookbackHours` 内发布的新闻
- **关键词过滤**：标题或摘要命中任意关键词即保留（不区分大小写），空列表 = 全保留
- **source 级跳过**：单个源可设 `skipKeywordFilter: true`，适用非主题强相关但想作为背景补充的源
- **URL 去重**：本次运行内去重 + 跨次历史去重，避免重复内容反复喂给 LLM
- **排序截断**：按发布时间倒序，取前 `maxItems` 条

---

## LLM 深加工

### 设计

`llm.js` 是唯一接触 LLM SDK 的地方，使用 LangChain 的 `ChatOpenAI` 连接任意 OpenAI 兼容服务。换模型只改 `.env`。

- `temperature=0.3`：低随机性，保证新闻摘要的一致性
- 模型无关：DeepSeek、通义千问、GPT-4o、Claude 等，只要支持 OpenAI 兼容格式

### Prompt 结构

LLM 被定位为「资深国际新闻主编」，进行三层深加工：

1. **梳理与整合**：把零散新闻串联起来，找出主线、趋势和关联
2. **提炼与升华**：从多条新闻中抽取真正重要的变化，而非逐条复述
3. **复盘与洞察**：以主编视角回顾整体信息，指出信号、风险和盲区

返回的结构化 JSON：

```json
{
  "overview": "本期概览 100-200字",
  "keyDevelopments": [
    {"title": "...", "detail": "详细分析 80-150字", "importance": "high/medium/low"}
  ],
  "context": "整体背景分析 100-200字",
  "timeline": [{"time": "MM-DD HH:mm", "event": "完整事件"}],
  "signals": ["值得关注的信号，含理由"],
  "risks": ["风险判断，含具体理由"],
  "unknowns": ["信息缺口"],
  "editorReview": "主编复盘 150-300字"
}
```

---

## 输出模块

### 文件命名

```
2026-05-05-143052-地缘政治局势速报.md
2026-05-05-143052-地缘政治局势速报.json
```

精确到秒，同一天多次运行不覆盖。

### Markdown 结构

输出的 Markdown 带 YAML frontmatter（兼容 Obsidian），包含：本期概览、关键变化（含重要度标记）、整体背景、时间线、值得关注的信号、风险判断、信息缺口、主编复盘、来源链接。

### JSON 输出

完整的结构化数据，包含所有 LLM 产出字段和原始新闻条目，适合程序化消费（周报聚合、搜索索引等）。

---

## 辅助工具

### 源可用性探测 (`npm run probe`)

对配置中的所有源逐一测试，输出 PASS/EMPTY/TIMEOUT/ERROR 状态：

```bash
npm run probe <topic-id>              # 探测所有源
npm run probe <topic-id> -- --source reuters  # 只测名称含 "reuters" 的源
npm run probe <topic-id> -- --all             # 强制重测（忽略 PASS 缓存）
npm run probe <topic-id> -- --reset           # 清除历史缓存后重测
npm run probe <topic-id> -- --full            # 含 LLM token 用量预估
```

- PASS 结果缓存 3 天（避免频繁探测），结果写入 `test/probe/results/`
- 每种源类型独立控制并发（web: 1, rss: 3），避免探测本身造成压力

### 审计日志 CLI (`npm run audit`)

查询历史运行记录，分析抓取效果：

```bash
npm run audit -- list [topic]             # 最近 20 次运行摘要
npm run audit -- show <runId>            # 单次运行详情（逐源状态、过滤统计）
npm run audit -- candidates <runId> [source]  # 查看某源的提取候选及置信度
npm run audit -- diff <runId1> <runId2>  # 对比两次运行的条目变化
npm run audit -- query <runId> <jq-filter>    # 用 jq 直接查 JSONL
npm run audit -- prune [days] [--yes]    # 清理 N 天前的日志
```

审计日志按 `logs/audit/{date}/{topic}-{runId}.jsonl` 组织，每次运行自动生成 `.summary.json`。

---

## 历史去重

`state/seen-urls.json` 按 topic 隔离记录所有已处理过的 URL 及时间戳。每次运行时：

1. 加载已见 URL 参与过滤，已见过的自动跳过
2. 运行结束将新 URL 原子写入（先写 `.tmp` 再 `rename`，防并发损坏）
3. 过期条目自动清理（默认保留 7 天，可配置 `dedup.retentionDays`）

可通过 `--no-dedup` 临时跳过（调试用），或通过 `dedup.enabled: false` 关闭。

---

## 配置参考

### 环境变量 (`.env`)

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | API 密钥（必填） |
| `LLM_BASE_URL` | API 地址 |
| `LLM_MODEL` | 模型名 |
| `LOG_LEVEL` | 日志级别：`verbose` / `info`（默认）/ `warn` / `quiet` |

### 主题 YAML 结构

```yaml
id: my-topic              # 必须，与文件名一致
title: 我的新闻主题        # 必须

sources:                  # 必须，至少一个
  - name: Reuters
    type: rss             # 默认 rss，可选 html/api/playwright/web
    url: "https://feeds.reuters.com/reuters/worldNews"
    fetchFullContent: false
    maxArticles: 20
    skipKeywordFilter: false

filter:                   # 可选
  keywords: [乌克, 俄罗斯, 北约]
  lookbackHours: 48
  maxItems: 60
  runtime:
    concurrency:
      rss: 8
      default: 5
    sourceTimeoutMs: 120000
    retries: 3

dedup:                    # 可选
  enabled: true
  retentionDays: 7

output:                   # 必须
  dir: "/Users/xxx/Obsidian/新闻简报"
```

详细的字段说明见 `config/CONFIG_GUIDE.md` 和 `docs/source-types.md`。

---

## 技术选型

| 包 | 用途 |
|----|------|
| `@langchain/openai` / `@langchain/core` | LLM 调用（OpenAI 兼容格式） |
| `rss-parser` | RSS/Atom feed 解析 |
| `@mozilla/readability` | Firefox 阅读模式正文提取 |
| `cheerio` | 服务端 CSS 选择器 |
| `jsdom` | Readability 的 DOM 环境 |
| `playwright-core` | 无头 Chromium（web 适配器用） |
| `undici` | 高性能 HTTP 客户端 |
| `p-limit` | Promise 并发控制 |
| `p-retry` | 指数退避重试 |
| `yaml` / `dotenv` | 配置管理 |

**为什么不用**：TypeScript（项目规模不需要）、Jest/Vitest（Node 内置 `node:test` 足够）、Puppeteer（Playwright 更好）、数据库/Redis（本地文件足够）。

---

## 设计原则

1. **RSS 优先**：能 RSS 就不抓网页，稳定、快速、零维护
2. **配置驱动**：所有路径、密钥、规则走 YAML 或 `.env`，零硬编码
3. **适配器模式**：新增抓取类型只需加一个文件 + 一行注册
4. **健壮性优先**：单源失败不影响全局，字段缺失不崩溃，原子写入防文件损坏
5. **LLM 无关**：换模型/provider 只改 `.env`
6. **不做推送**：推送/定时调度是上游系统（cron、OpenClaw）的职责，本项目专注生成
