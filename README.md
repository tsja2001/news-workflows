# news-workflows

基于 **多源抓取 + LLM 深加工** 的新闻简报自动生成工具。从多种新闻源拉取内容，经过时间/关键词/去重过滤后，交给大模型以「主编」视角进行深度加工，输出结构化的中文简报（Markdown + JSON）。

## 目录

- [核心设计](#核心设计)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [架构：4 阶段流水线](#架构4-阶段流水线)
- [抓取适配器](#抓取适配器)
- [过滤管线](#过滤管线)
- [LLM 层](#llm-层)
- [输出模块](#输出模块)
- [历史去重](#历史去重)
- [配置参考](#配置参考)
- [技术选型](#技术选型)
- [设计原则](#设计原则)
- [升级路线](#升级路线)

---

## 核心设计

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

**一句话**：`npm run brief us-iran`，等待几十秒，`output.dir` 下出现当天的简报文件。

### 关键特性

- **五种抓取方式**：RSS、HTML 静态站、Playwright（JS 渲染）、通用 JSON API、**Web（AI 通用抓取）**
- **AI 通用网页抓取** (`type: web`)：只需 `name` + `url`，Playwright 渲染 + AI 提取链接和正文，零选择器配置
- **可扩展**：适配器模式，新增抓取类型只需加一个文件 + 一行注册
- **纯 JS + JSDoc**：零 TypeScript 配置成本，JSDoc 提供类型提示
- **模型无关**：使用 LangChain 的 `ChatOpenAI` 连接任意 OpenAI 兼容服务（DeepSeek、通义千问、OpenAI 等），换模型只改 `.env`
- **主编深加工**：LLM 不只是简单摘要，而是像编辑部一样进行梳理整合、提炼升华、复盘洞察，产出的简报更有深度
- **Obsidian 友好**：Markdown 输出带 YAML frontmatter，直接作为 Obsidian 笔记
- **历史去重**：已见过的 URL 不再重复处理，避免重复内容喂给 LLM
- **按类型并发控制**：RSS 高并发（8）、web 严格限制（2），不同类型独立限流
- **结构化日志**：ANSI 彩色日志，内置截断防刷屏，`LOG_LEVEL` 控制详细度
- **配置驱动**：所有行为通过 YAML 控制，不硬编码任何路径、密钥、模型名

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
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

支持任何 OpenAI 兼容接口：DeepSeek、通义千问（`https://dashscope.aliyuncs.com/compatible-mode/v1`）、Moonshot/Kimi、智谱 GLM、OpenAI 官方等。

### 3. 配置主题

编辑 `config/topics/us-iran.yaml`（或新建你自己的主题 YAML），至少设置 `output.dir` 为你的输出目录。

### 4. 生成简报

```bash
npm run brief us-iran
```

如果使用了 Playwright 或 Web 适配器，需先安装 Chromium：

```bash
npx playwright install chromium
```

### 5. 运行测试

```bash
npm test
```

### 入参说明

```bash
npm run brief <topic-id>           # 正常生成
npm run brief <topic-id> -- --no-dedup   # 跳过历史去重（调试用）
```

---

## 目录结构

```
news-workflows/
├── src/
│   ├── index.js              # CLI 入口，串联 4 步流程 + 错误处理
│   ├── config.js             # YAML 加载、${ENV} 替换、必填校验
│   ├── fetch.js              # 向后兼容薄壳：集成历史去重后调 fetchAll()
│   ├── summarize.js          # 构建 system/user prompt，调 LLM
│   ├── llm.js                # LLM 调用封装（LangChain pipe 链）
│   ├── output.js             # 写 Markdown + JSON 到 output.dir
│   │
│   ├── fetch/                # 抓取适配器层
│   │   ├── index.js          #   调度器：按 source.type 路由 + 按类型并发池
│   │   ├── types.js          #   JSDoc 类型定义（NewsItem）
│   │   ├── common.js         #   过滤管线：时间/关键词/URL去重/排序截断
│   │   ├── rss.js            #   RSS 适配器（+ 正文回抓）
│   │   ├── html.js           #   静态 HTML 爬虫（cheerio + Readability）
│   │   ├── api.js            #   通用 JSON API → NewsItem 映射
│   │   ├── playwright.js     #   JS 渲染站爬虫（Chromium）
│   │   ├── web.js            #   AI 通用网页抓取（Playwright + LLM 提取）
│   │   ├── extractor.js      #   正文提取：Readability → cheerio 降级
│   │   └── web/              #   type: web 子模块
│   │       ├── browser.js        #   Playwright context 管理 + 导航 + 截图
│   │       ├── extract-list.js   #   AI 从瘦身 HTML 提取新闻链接列表
│   │       ├── extract-detail.js #   三种正文提取策略（auto/readability/ai）
│   │       └── prompts.js        #   AI prompt 集中管理
│   │
│   ├── utils/                # 通用工具
│   │   ├── logger.js         #   步骤化日志器（ANSI 颜色 + 自动截断）
│   │   └── html-cleaner.js   #   HTML 瘦身工具（LLM 友好格式）
│   │
│   └── state/
│       └── seen-store.js     # 历史去重存储（原子写入，按 topic 隔离）
│
├── config/
│   ├── CONFIG_GUIDE.md       # 详细配置指南（所有字段说明 + 示例）
│   └── topics/
│       ├── us-iran.yaml      # 美国伊朗主题（RSS + HTML 混合）
│       ├── general-news.yaml # 通用新闻主题
│       └── _test-mixed.yaml  # 测试用混合源配置
│
├── docs/
│   ├── phase-1-changes.md    # Phase 1 变更记录
│   ├── phase-2.5.1-changes.md # Phase 2.5.1（logger + html-cleaner）
│   ├── phase-2.5.2-changes.md # Phase 2.5.2（type: web）
│   ├── phase-2.5.3-changes.md # Phase 2.5.3（按类型并发 + 源超时）
│   └── source-types.md       # 各 source type 的配置参考
│
├── test/
│   └── fixtures/             # 测试用的 HTML fixture 文件
│       ├── news-article.html
│       ├── news-detail.html
│       ├── news-list.html
│       ├── short-page.html
│       └── cleaner/          # html-cleaner 测试样本
│
├── state/                    # 运行时状态（gitignore）
│   └── seen-urls.json        #   历史去重数据
│
├── logs/                     # LLM 调用日志 + web 失败截图（gitignore）
│   ├── llm-calls/
│   └── web-failures/
│
├── CLAUDE.md                 # Claude Code 项目指令
├── PLAN.md                   # 分阶段升级任务书
├── package.json
├── .env.example
└── .gitignore
```

---

## 架构：4 阶段流水线

### 步骤 1 — 加载配置 (`config.js`)

- 从 `config/topics/<id>.yaml` 读取主题配置
- 递归替换字符串中的 `${VAR}` 为 `process.env.VAR`（未定义则报错）
- 校验必填字段：`id`、`title`、`sources`、`output.dir`

### 步骤 2 — 抓取新闻 (`fetch.js` → `fetch/index.js`)

- 遍历 `sources[]`，按 `type` 字段路由到对应的 adapter
- **按类型分池并发**：每种 type 独立限制并发上限（RSS 8、HTML/API 5、Playwright/Web 2），避免重型任务拖慢整体
- 支持全局源超时（`sourceTimeoutMs`），超时源作失败处理
- 单个 source 失败不影响其他 source（try/catch 包裹，返回空数组）
- 所有结果汇合后统一走过滤管线（时间 → 关键词 → URL去重 → 排序截断）
- 如果开启了历史去重，抓取前加载已见 URL 参与过滤，抓取后标记新 URL
- 调度日志实时显示每个源的排队/完成状态，结束时汇总成功/失败统计

详见 [抓取适配器](#抓取适配器) 和 [过滤管线](#过滤管线)。

### 步骤 3 — LLM 深加工 (`summarize.js` → `llm.js`)

- `summarize.js` 定义 system prompt（主编角色设定）和 user prompt（新闻数据 + 输出 schema）
- LLM 不只是简单摘要，而是进行三层深加工：梳理整合 → 提炼升华 → 复盘洞察
- `llm.js` 用 LangChain 的 `pipe()` 编排链：`ChatPromptTemplate → ChatOpenAI → JsonOutputParser`
- 支持任意 OpenAI 兼容的模型服务，换模型只改 `.env`
- LLM 返回结构化 JSON：`overview`、`keyDevelopments`（含标题+详细分析+重要度）、`context`、`timeline`、`signals`、`risks`、`unknowns`、`editorReview`

### 步骤 4 — 输出文件 (`output.js`)

- 同时生成两个文件到 `output.dir`：
  - `.md` — 带 YAML frontmatter 的 Markdown（Obsidian 兼容），含概览、关键变化、整体背景、时间线、值得关注的信号、风险判断、信息缺口、主编复盘、来源链接
  - `.json` — 完整数据（元信息 + LLM 报告 + 原始新闻条目）
- 文件名精确到秒：`2026-05-05-143052-美国伊朗局势速报.md`，同一天多次运行不覆盖
- 字段缺失时显示「（无）」而不是崩溃（LLM 偶尔会偷懒少返回字段）

---

## 抓取适配器

所有 adapter 遵循统一签名：

```js
/**
 * @param {object} sourceConfig - yaml 里单个 source 的配置
 * @param {object} [options]    - { retries }
 * @returns {Promise<NewsItem[]>}
 */
export async function fetchFromXxx(sourceConfig, options) { ... }
```

调度器 `src/fetch/index.js` 维护适配器注册表：

```js
const ADAPTERS = {
  rss: fetchFromRss,
  html: fetchFromHtml,
  api: fetchFromApi,
  playwright: fetchFromPlaywright,
  web: fetchFromWeb,
}
```

未声明 `type` 的 source 默认按 `rss` 处理（向后兼容）。未知 type 会打印错误并跳过。

### 1. RSS 适配器 (`type: rss`)

| 依赖 | 作用 |
|------|------|
| `rss-parser` | 解析 RSS 2.0 / Atom feed |
| `p-retry` | 网络请求指数退避重试（默认 3 次） |

**附加能力 — 正文回抓**：开启 `fetchFullContent: true` 后，对每条 RSS 条目用 `extractor.js` 回抓原文正文，存入 `NewsItem.content`。回抓走独立的 `p-limit` 控制并发（默认 3）。

### 2. HTML 适配器 (`type: html`)

| 依赖 | 作用 |
|------|------|
| `undici` | 高性能 HTTP 客户端，拉取页面 HTML |
| `cheerio` | 服务端 jQuery，CSS 选择器提取内容 |
| `@mozilla/readability` | Firefox 阅读模式核心，自动提取正文 |

抓取流程：

1. 拉取 `listUrl` → cheerio 跑 `selectors.articleLinks` 提取链接列表
2. 并发（3 个）拉取每篇文章页
3. 如果 yaml 配了细粒度选择器（title/content/publishedAt），用 cheerio 精确提取
4. 否则降级用 Readability 自动提取正文
5. 时间字段缺失时用当前时间兜底

单篇文章失败跳过，不影响其他。

### 3. Playwright 适配器 (`type: playwright`)

| 依赖 | 作用 |
|------|------|
| `playwright-core` | 无头 Chromium（轻量，不含浏览器二进制） |

适用于需要 JS 执行才能渲染的 SPA 新闻站。设计要点：

- **browser 单例**：全局复用，不每次启动（通过 `getBrowser()` 懒加载）
- **独立 context**：每个 source 使用独立 browser context，失败不影响其他
- **资源屏蔽**：默认拦截图片/字体/CSS 请求，只保留 HTML 和 JS，大幅加速
- **逐页访问**：列表页收集链接 → 逐个访问文章页提取内容
- **优雅关闭**：`src/index.js` 的 `finally` 块调用 `shutdownPlaywright()` 确保 browser 关闭

使用前需 `npx playwright install chromium`。

### 4. API 适配器 (`type: api`)

通用 JSON API → NewsItem 映射层。不为任何具体 API 写专属代码，通过 yaml 的 `responseShape` 完成字段映射。

- `responseShape.itemsPath` — 用点号路径定位 JSON 中的新闻数组（如 `"articles"`、`"data.news"`）
- `responseShape.fields` — 指定每个 NewsItem 字段在原始 JSON 中的路径（支持 `"source.name"` 嵌套取值）
- `params` 中的值支持 `${ENV_VAR}` 引用环境变量

### 5. Web 适配器 (`type: web`) ⭐ 推荐

**推荐所有非 RSS 新源优先使用 `type: web`**。用 Playwright 处理渲染 + AI 提取内容，牺牲一点点速度和成本，换取零配置的心智简化——只需 `name` + `url` 两个字段。

| 依赖 | 作用 |
|------|------|
| `playwright-core` | 无头 Chromium 渲染页面 |
| `llm.js` | AI 提取链接列表 + 正文内容 |
| `html-cleaner.js` | HTML 瘦身为 LLM 友好格式 |
| `extractor.js` | Readability 正文提取（auto 模式） |

**抓取流程：**

1. **浏览器渲染**：Playwright 打开列表页，等待 `networkidle`（或自定义策略）
2. **HTML 瘦身**：`cleanHtml(html, { mode: 'list' })` 移除 script/style/注释/导航区，只保留链接和内容骨架（压缩率 > 70%）
3. **AI 提取链接**：LLM 从瘦身后的 HTML 中识别新闻条目，输出 title/url/summary
4. **URL 合法化**：相对路径转绝对路径，过滤无效和重复链接
5. **详情页抓取**：逐个访问文章页，用三种策略提取正文：
   - `auto`（默认）：先 Readability，正文 < 100 字时降级到 AI
   - `readability`：只用 Mozilla Readability
   - `ai`：HTML 瘦身（article 模式）后直接用 LLM 提取
6. **单条失败兜底**：详情页失败时用列表页已提取的 title + summary 兜底

**配置极简示例：**

```yaml
sources:
  - name: BBC 中东
    type: web
    url: "https://www.bbc.com/news/world/middle_east"
    # 以下均为可选
    maxArticles: 10                    # 默认 10
    hint: "新闻列表在主面板"            # 给 AI 的额外上下文
    waitFor:
      type: networkidle                # networkidle | selector | timeout
      timeoutMs: 30000
    sessionFile: "state/sessions/bbc.json"  # 复用登录态
    fetchDetail: true                  # 默认 true
    detailExtraction: auto             # auto | readability | ai
    detailConcurrency: 2               # 默认 2
    blockResources: true               # 默认 true
```

### 正文提取器 (`extractor.js`)

| 依赖 | 作用 |
|------|------|
| `undici` | 拉取页面 HTML |
| `@mozilla/readability` | 优先策略：自动识别正文区域 |
| `jsdom` | Readability 的 DOM 依赖 |
| `cheerio` | 降级策略：语义标签选择器 |

策略：`Readability 提取 → 失败或正文 <100 字时降级 → cheerio 语义选择器（article > main > [role=main] > .article-body > body）→ 仍 <100 字返回空`。

### HTML 瘦身工具 (`utils/html-cleaner.js`)

将页面 HTML 压缩为 LLM 友好格式，两种模式：

- **list 模式**：保留 `<a>` 标签和 class/id，移除导航/侧栏，用于列表页提取
- **article 模式**：只保留主内容区（article > main > 文本量最大的 div），用于详情页正文提取

所有模式都会移除 script、style、注释、base64、事件属性、data-* 属性。真实页面压缩率 > 70%。

---

## 过滤管线

所有 adapter 的产出统一经过 `src/fetch/common.js` 的过滤管线：

```
原始条目 → 时间窗口过滤 → 关键词过滤 → URL 去重 → 时间排序 → 截取前 N 条
```

控制台每阶段会输出剔除了多少条，方便调试。

### 时间过滤 (`filterByTime`)

只保留 `lookbackHours` 小时内的新闻。基于 `publishedAt` 的 ISO 时间戳比较。

### 关键词过滤 (`filterByKeywords`)

标题或摘要中命中任意关键词即保留（大小写不敏感）。空关键词列表 = 不过滤，全部保留。

source 级可通过 `skipKeywordFilter: true` 跳过关键词过滤，适用于「非主题强相关但想作为补充信息」的源（如 Hacker News 作背景补充）。

### URL 去重 (`dedupByUrl`)

同一 URL 只保留首次出现的条目。可接收外部 `Set<string>` 用于跨源去重 + 历史去重。

### 排序截断 (`sortAndTruncate`)

按 `publishedAt` 倒序排列，取前 `maxItems` 条。

---

## LLM 层

### 设计

`src/llm.js` 是整个项目唯一接触 LangChain SDK 的地方。使用 `ChatOpenAI` 类但实际可连接任何 OpenAI 兼容服务。

```js
// LangChain 链式调用
model.pipe(parser)  // 模型 → JSON 解析器
```

- `temperature=0.3`：较低的随机性，保证新闻摘要的一致性
- `JsonOutputParser`：自动解析 LLM 返回的 JSON，解析失败会抛错
- 所有 LLM 配置走环境变量（`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`）

### Prompt 结构

system prompt 和 user prompt 分离。System prompt 将 LLM 定位为「资深国际新闻主编」，要求进行三层深加工：

1. **梳理与整合**：把零散的新闻条目串联起来，找出背后的主线、趋势和关联
2. **提炼与升华**：从多条新闻中抽取出真正重要的变化，而不是逐条复述
3. **复盘与洞察**：以主编视角对整体信息进行回顾，指出值得关注的信号、潜在影响和需要持续跟踪的方向

User prompt 携带具体新闻数据和详细的字段级写作要求，要求 LLM 产出有深度的内容（每个字段给出字数范围、写作指引），语言风格对标《经济学人》或《财新》。

LLM 返回的 JSON 结构（主编深加工版）：

```json
{
  "overview": "本期概览 100-200字",
  "keyDevelopments": [
    {"title": "...", "detail": "详细分析 80-150字", "importance": "high/medium"}
  ],
  "context": "整体背景分析 100-200字",
  "timeline": [{"time": "MM-DD HH:mm", "event": "完整事件描述"}],
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
2026-05-05-143052-美国伊朗局势速报.md
2026-05-05-143052-美国伊朗局势速报.json
```

精确到秒 → 同一天多次运行不互相覆盖，可多次运行对比不同时间点的简报。

### Markdown 结构

```markdown
---
topic: us-iran
title: 美国伊朗局势速报
date: 2026-05-05
generatedAt: 2026-05-05T06:30:52.123Z
sourceCount: 15
---

# 美国伊朗局势速报

## 本期概览
2-3 句话勾勒整体画像...

## 关键变化
1. **伊核谈判进入关键阶段** _[🔴 高关注]_

   详细分析：美伊双方在维也纳进行了新一轮谈判...

2. **伊朗宣布新制裁反制措施** _[🟡 中等]_

   针对欧盟最新制裁，伊朗外交部宣布...

## 整体背景
这些新闻发生在大国博弈加剧的背景下...

## 时间线
- 05-04 14:30 美国国务院发言人表示...
- 05-05 08:00 伊朗外交部发表声明...

## 值得关注的信号
- 伊朗在谈判中首次松动了对铀浓缩上限的立场...
- 沙特方面对美伊进展表现出担忧...

## 风险判断
- 若新一轮谈判破裂，伊朗可能在两周内启动...
- 以色列公开表态可能采取单边行动...

## 信息缺口
- 伊朗国内强硬派对谈判的具体态度不明...
- 国际原子能机构最新核查报告尚未公开...

## 主编复盘
本轮信息呈现了美伊关系的复杂图景。与上周相比，谈判出现了 X 信号，但 Y 因素仍是变数...

## 来源
- [Al Jazeera: 伊核谈判最新进展](https://...)
```

YAML frontmatter 使得 Obsidian 能识别为笔记属性。

### JSON 结构

```json
{
  "topic": "us-iran",
  "title": "美国伊朗局势速报",
  "date": "2026-05-05",
  "generatedAt": "...",
  "overview": "...",
  "keyDevelopments": [
    {"title": "...", "detail": "...", "importance": "high"}
  ],
  "context": "...",
  "timeline": [...],
  "signals": [...],
  "risks": [...],
  "unknowns": [...],
  "editorReview": "...",
  "sources": [...]
}
```

适合程序化消费（周报聚合、搜索索引等）。

### 容错

LLM 返回的字段缺失或为空时，Markdown 中显示「（无）」而不是报错或留白。

---

## 历史去重

### 数据存储

`state/seen-urls.json`（gitignore）：

```json
{
  "us-iran": {
    "https://example.com/article-1": "2026-05-04T10:23:00Z",
    "https://example.com/article-2": "2026-05-05T08:11:00Z"
  }
}
```

按 topic 隔离，每个 URL 记录首次见到的时间戳。

### 模块接口 (`src/state/seen-store.js`)

```js
loadSeen(topicId)             → Map<url, timestamp>
markSeen(topicId, urls)       → 批量写入
pruneOldEntries(topicId, days) → 清理过期记录
```

### 关键设计

- **原子写入**：先写 `.tmp` 再 `rename`，防止并发或崩溃损坏文件
- **文件不存在自动创建**：首次运行无需手动初始化
- **默认保留 7 天**，可在 yaml 中 `dedup.retentionDays` 覆盖
- **双控开关**：yaml 的 `dedup.enabled` 决定是否启用 + CLI 的 `--no-dedup` 可以临时跳过

### 接入方式

`src/fetch.js` 的 `fetchAndFilter()` 在抓取前加载已见 URL 传入过滤管线，抓取后把新 URL 标记为已见。

---

## 配置参考

### 环境变量 (`.env`)

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | API 密钥（必填） |
| `LLM_BASE_URL` | API 地址，任何 OpenAI 兼容服务 |
| `LLM_MODEL` | 模型名，如 `deepseek-chat`、`gpt-4o-mini` |
| `LOG_LEVEL` | 日志级别：`verbose` / `info`（默认）/ `warn` / `quiet` |

### 主题 YAML 结构

```yaml
id: my-topic              # 必须，与文件名一致
title: 我的主题           # 必须

sources:                  # 必须，至少一个
  - name: 源名称
    type: rss|html|api|playwright|web  # 默认 rss
    # ... 各 type 专属字段见下方

filter:                   # 可选
  keywords: [词1, 词2]
  lookbackHours: 48
  maxItems: 40
  runtime:
    # 新格式：按 type 分别限制并发（推荐）
    concurrency:
      rss: 8
      html: 5
      api: 5
      playwright: 2
      web: 2
      default: 5
    # 或旧格式：统一并发数
    # concurrency: 5

    sourceTimeoutMs: 180000   # 单个源超时限制（可选，默认无限）
    retries: 3

dedup:                    # 可选
  enabled: true
  retentionDays: 7

output:                   # 必须
  dir: "/absolute/path"
```

详细的每种 source type 的字段说明见 `config/CONFIG_GUIDE.md` 和 `docs/source-types.md`。

---

## 技术选型

### 语言与平台

| 选择 | 理由 |
|------|------|
| Node.js (ES Module) | 轻量、单进程、CLI 友好 |
| 纯 JS + JSDoc | 零构建成本，JSDoc 提供足够类型提示 |
| 不引入 TypeScript | 减少工具链复杂度，这个规模不需要 |

### 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `@langchain/openai` | ^0.3.0 | LLM 调用（兼容所有 OpenAI 格式 API） |
| `@langchain/core` | ^0.3.0 | Output Parser |
| `rss-parser` | ^3.13.0 | RSS/Atom feed 解析 |
| `undici` | ^6.25.0 | 高性能 HTTP 客户端 |
| `cheerio` | ^1.2.0 | 服务端 CSS 选择器 / HTML 解析 |
| `@mozilla/readability` | ^0.5.0 | Firefox 阅读模式的正文提取算法 |
| `jsdom` | ^24.1.3 | Readability 的 DOM 环境 |
| `playwright-core` | ^1.59.1 | 无头 Chromium（Playwright/web 适配器） |
| `p-limit` | ^5.0.0 | Promise 并发控制 |
| `p-retry` | ^6.2.1 | 指数退避重试 |
| `yaml` | ^2.6.0 | YAML 解析 |
| `dotenv` | ^16.4.5 | .env 文件加载 |

### 为什么不用

| 不用 | 原因 |
|------|------|
| TypeScript | 项目规模不需要，JSDoc 够用 |
| Jest/Vitest | Node 内置 `node:test` 足够，零依赖 |
| Puppeteer | Playwright 更快、API 更好、维护更活跃 |
| node-fetch / axios | Node 18+ 内置 `undici`，更快更轻 |
| ORM / Redis / MQ | 本地文件足够，不引入重型基础设施 |

---

## 设计原则

1. **配置驱动**：路径、密钥、模型名、过滤规则全部走 YAML 或 `.env`，零硬编码
2. **适配器模式**：新增抓取类型只需加一个 adapter 文件 + 一行注册，不修改调度逻辑
3. **健壮性优先**：单个源失败不影响全局，字段缺失不崩溃，原子写入防文件损坏
4. **LLM 无关**：换模型/provider 只改 `.env`，不碰代码
5. **向后兼容**：新增字段有合理默认值，老配置文件不修改也能跑
6. **测试不依赖外网**：用本地 fixture 和 mock，`npm test` 秒级完成
7. **中文注释**：面向中文用户，代码注释用中文
8. **不做推送**：推送是上游调度系统（如 OpenClaw cron）的职责，本项目专注生成

---

## 升级路线

项目通过 `PLAN.md` 定义了分阶段升级路线，严格按序执行：

| Phase | 状态 | 内容 |
|-------|------|------|
| **Phase 1** | ✅ 已完成 | 适配器模式重构、历史去重、并发控制 + 重试 |
| **Phase 2** | ✅ 已完成 | HTML 爬虫、Playwright、API 适配器、正文提取、env 变量替换 |
| **Phase 2.5** | ✅ 已完成 | 步骤化日志器、HTML 瘦身工具、`type: web` 通用 AI 抓取、按类型并发池、全局源超时、LLM 主编深加工提示词 |
| **Phase 3** | 🔲 计划中 | LLM 调用日志/token 统计、Zod schema 校验、自动重试 |
| **Phase 4** | 🔲 可选 | 多语言摘要、子事件聚类、周报/月报、健康监控 |

每个 Phase 独立可交付、独立可测试，完成后需人类 review。

---

## 相关文档

- `CLAUDE.md` — Claude Code 项目指令（给 AI 看的架构速览）
- `PLAN.md` — 分阶段升级任务书（给 AI 的开发指令）
- `config/CONFIG_GUIDE.md` — 完整配置指南（所有字段 + 示例）
- `docs/source-types.md` — Source type 配置参考
- `docs/phase-1-changes.md` — Phase 1 变更记录
- `docs/phase-2.5.1-changes.md` — Phase 2.5.1 变更（logger + html-cleaner）
- `docs/phase-2.5.2-changes.md` — Phase 2.5.2 变更（type: web）
- `docs/phase-2.5.3-changes.md` — Phase 2.5.3 变更（按类型并发 + 源超时）
