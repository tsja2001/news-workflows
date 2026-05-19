# 新闻简报生成流程

## 总览

整个系统是一个 **4 阶段流水线**，从加载配置到最终输出 Markdown 简报，全部在 `src/index.js` 中串联调度。

```
加载配置 → 抓取+过滤 → LLM 总结 → 输出文件
 (config)   (fetch)   (summarize)  (output)
```

## 阶段一：加载配置

**入口**：`src/config.js` → `loadTopic(topicId)`

1. 根据 topic ID 找到 `config/topics/<topicId>.yaml`
2. 用 `yaml` 库解析为 JS 对象
3. **`${ENV_VAR}` 替换**：递归扫描所有字符串，将 `${LLM_API_KEY}` 等替换为 `process.env` 中的值，未定义则报错
4. **校验必填字段**：`id`、`title`、`sources`、`output.dir`
5. 返回完整的 config 对象，包含以下关键段：

| 配置段 | 作用 |
|--------|------|
| `sources` | 36 个 RSS 源，每个含 `name`、`url`、`type` |
| `filter` | 关键词/排除关键词/时间窗口/maxItems/并发配置 |
| `editorial` | LLM 人设、写作风格、读者兴趣、排除话题、输出控制 |
| `output` | 输出目录路径 |
| `dedup` | URL 去重开关和保留天数 |

## 阶段二：抓取 + 过滤

**入口**：`src/fetch/index.js` → `fetchAll(sources, filterConfig)`

### 2.1 抓取调度

```
           ┌──────────────┐
config     │  fetch/index  │
sources ──▶│  按 type 路由  │
           └──┬───┬───┬───┘
              │   │   │
         rss  │ html api playwright/web
              ▼   ▼   ▼
```

- **按 type 路由**到对应 adapter（`fetch/rss.js`、`fetch/html.js` 等），未声明 type 默认 `rss`
- **按类型分并发池**：rss=10, html/api=5, playwright/web=2（可在 yaml `filter.runtime.concurrency` 覆盖）
- 每个 adapter 独立执行，**单源失败不中断**其他源
- 全局源超时兜底（`sourceTimeoutMs`，默认 30s）
- RSS adapter 使用 `rss-parser` 库拉取，支持 `p-retry` 自动重试（默认 3 次）

### 2.2 RSS Adapter 详情

**文件**：`src/fetch/rss.js`

```
rss-parser 拉取 XML
      │
      ▼
统一为 NewsItem 格式:
  { title, url, source, publishedAt, summary }
      │
      ├── fetchFullContent: true? ──▶ extractor.js Readability 正文回抓
      │                               (并发控制 p-limit, 默认 3)
      └── fetchFullContent: false ──▶ 直接返回
```

正文回抓 (`extractor.js`)：用 Readability 算法从文章页面提取正文，非 LLM 方式，成本低、速度快。

### 2.3 过滤管线

**文件**：`src/fetch/common.js` → `applyFilters()`

所有 adapter 产出的 NewsItem 汇合后，依次经过 4 道过滤：

```
所有条目 (36源)
    │
    ▼
┌─────────────────┐
│ 1. 时间窗口过滤    │  只保留 lookbackHours(48h) 内的
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 关键词匹配      │  标题/摘要命中 keywords 列表才保留
│                  │  skipKeywordFilter=true 的源跳过此关
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. 排除关键词剔除  │  命中 excludeKeywords 则丢弃（足球/播客等）
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. URL 去重       │  同 URL 只保留一条；含历史去重（7天 SeenStore）
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. 排序 + 截断    │  按发布时间倒序，截取 maxItems(60) 条
└────────┬────────┘
         ▼
    最终 60 条 → 送 LLM
```

- **skipKeywordFilter**：对本身就聚焦地缘冲突的源（如 War on the Rocks、Bellingcat），跳过关键词过滤，避免误伤
- **历史去重**：`src/state/seen-store.js` 持久化已见过的 URL，7 天内同一 URL 不会重复进入

## 阶段三：LLM 总结

**入口**：`src/summarize.js` → `summarize(items, config)`

### 3.1 Prompt 构建

分为两层：

**System Prompt**（固定角色设定）：
```
你是私人内参编辑，给一位长期关注全球地缘冲突的熟客做日报。
你的工作不是替主流媒体复述新闻，而是替这位读者把事情吃透、说清。
要做的几件事：
  1. 看清主线
  2. 替他过滤（排除他不关心的话题）
  3. 替他判断（每条加"编辑怎么看"）
  4. 不装客观（口语化、有立场、敢下判断）
写作风格：口语化、有立场、敢下判断……
```

System prompt 由 `buildSystemPrompt(editorial)` 动态生成，根据 yaml `editorial` 段的 `persona`、`tone` 逐段拼装。

**User Prompt**（具体任务 + 60 条新闻数据）：
```
请基于下面 60 条关于"全球地缘冲突速报"的新闻，撰写一份编辑简报。

读者最关心的方向：
- 中东能源与航道
- 俄乌战场进展与停火谈判
- …

读者明确不感兴趣的话题：
- 与地缘冲突无关的国内政治丑闻
- 名人/娱乐/体育
- …

返回 JSON 格式：
{
  "tldr": ["30秒速读 bullet…"],
  "overview": "本期概览…",
  "keyDevelopments": [{title, what, why, editorTake, importance}, …],
  "briefs": ["低关注短讯…"],
  "timeline": [{time, event}, …],
  "signals": ["值得关注的信号…"],
  "risks": ["风险判断…"],
  "unknowns": ["信息缺口…"],
  "editorReview": "主编复盘…"
}

新闻素材：
[1] 来源: Al Jazeera
时间: 2026-05-18T…
标题: …
摘要: …
URL: https://…
（共 60 条）
```

User prompt 由 `buildUserPrompt(items, config)` 构建，注入：
- 60 条新闻的标题、摘要、来源、时间、URL
- 读者兴趣方向（用于排序 keyDevelopments）
- 排除话题（LLM 阶段软过滤）
- 低关注度处理策略（brief/drop/expand）
- 各区域数量上限（高关注 max 5，中等 max 3）

### 3.2 LLM 调用

**文件**：`src/llm.js`

```
system prompt ─┐
               ├──▶ LangChain ChatOpenAI ──▶ LLM 响应
user prompt  ──┘    (兼容 OpenAI API 的服务)
```

- 使用 `@langchain/openai` 的 `ChatOpenAI`，连接任意 OpenAI 兼容服务
- 模型、API Key、Base URL、Temperature 全部从 `.env` 读取
- Temperature 默认 0.6，可通过 `LLM_TEMPERATURE` 覆盖
- `repairAndParseJson()` 对 LLM 返回的 JSON 做容错处理：
  - 剥离 markdown 代码块（\`\`\`json）
  - 尝试从第一个 `[` 或 `{` 定位 JSON 边界
  - 修复 JS 风格的 unquoted key（`{title: "…"}` → `{"title": "…"}`）

### 3.3 Editorial 控制机制

yaml 中 `editorial` 段的每个字段如何影响 LLM 输出：

| editorial 字段 | 作用位置 | 效果 |
|---------------|---------|------|
| `persona` | System Prompt | 设定 LLM 角色身份 |
| `tone` | System Prompt | 控制写作语气 |
| `interests` | User Prompt | LLM 按此排序 keyDevelopments |
| `excludeTopics` | User Prompt | LLM 不在 keyDevelopments 中展开此类素材 |
| `excludeKeywords` | fetch 过滤管线 | 硬过滤，命中直接丢弃（LLM 不可见） |
| `lowAttentionHandling` | User Prompt | brief→进 briefs / drop→丢弃 / expand→可进 keyDevelopments |
| `tldr.maxItems` | User Prompt + Output | 控制速读区条数 |
| `keyDevelopmentsLimit` | User Prompt | 控制高中低关注度条目上限 |

## 阶段四：输出文件

**入口**：`src/output.js` → `writeOutput(report, items, config)`

生成两个文件：

### Markdown 文件（Obsidian 兼容）

文件名格式：`2026-05-19-112811-全球地缘冲突速报（RSS版）.md`

结构：
```markdown
---
topic: global-geopolitical-conflicts-rss
title: 全球地缘冲突速报（RSS版）
date: 2026-05-19
generatedAt: 2026-05-19T03:28:11.083Z
sourceCount: 60
itemsUsed: 12
itemsDropped: 48
---

# 全球地缘冲突速报（RSS版）

## 30 秒速读
- bullet 1
- bullet 2

## 本期概览
一段话概括本期核心主线

## 关键变化
### 1. 标题 🔴 高关注
**发生了什么**：…
**为什么重要**：…
**编辑怎么看**：…
---

## 今日短讯
- 【中东/以色列】 …

## 时间线
- 05-18 20:44 事件描述

## 值得关注的信号
- 信号及其解读

## 风险判断
- 风险及恶化路径

## 信息缺口
- 当前不清楚但影响判断的问题

## 主编复盘
结尾深度复盘 150-300 字

## 来源
- [源名称: 文章标题](url)
- …
```

### 审计日志（JSONL）

**文件**：`src/utils/auditor.js`

同时写入 `logs/audit/<日期>/`：
- `*.jsonl` — 逐行 JSON，记录每次运行的完整过程（每篇输入文章的内容、LLM 输入输出、token 消耗）
- `summary.json` — 按源和日期汇总的统计

## 完整数据流图

```
.env                        .yaml config
  │                              │
  └──────┬───────────────────────┘
         ▼
    src/config.js
    loadTopic("global-geopolitical-conflicts-rss")
         │
         │  config = { id, title, sources[36], filter, editorial, output }
         ▼
    src/fetch/index.js
    fetchAll(sources, filterConfig)
         │
         ├──▶ RSS adapter ×36  ──▶  36 × NewsItem[]
         │    (并发池: rss=10)
         │
         ├──▶ applyFilters()  ──▶  5道过滤 + 排序截断
         │    ├ 时间窗口 (48h)
         │    ├ 关键词匹配
         │    ├ 排除关键词
         │    ├ URL 去重 (含历史)
         │    └ 排序 + 截断 maxItems=60
         │
         │  60 条 NewsItem[]
         ▼
    src/summarize.js
    summarize(items, config)
         │
         ├──▶ buildSystemPrompt(editorial)  ──▶  System Prompt
         ├──▶ buildUserPrompt(items, config) ──▶  User Prompt
         │
         ├──▶ src/llm.js callLLMForJsonWithMeta()
         │    ├ LangChain ChatOpenAI
         │    ├ Temperature 0.6
         │    └ repairAndParseJson()  ──▶  容错解析
         │
         │  report = { tldr, overview, keyDevelopments, briefs, timeline, … }
         ▼
    src/output.js
    writeOutput(report, items, config)
         │
         ├──▶ *.md  (Obsidian 兼容，带 frontmatter)
         └──▶ logs/audit/*.jsonl (审计日志)
```

## 关键设计决策

- **RSS 优先**：所有源都用 RSS adapter，速度快（全源 ~18 秒）、无反爬问题、不依赖浏览器
- **单源容错**：任一源失败返回空数组，不阻断整体流程
- **配置驱动**：所有路径、密钥、模型名、写作风格全在 yaml 或 `.env`，零硬编码
- **过滤分层**：硬过滤在 fetch 阶段（关键词/排除关键词），软过滤在 LLM 阶段（excludeTopics），各司其职
- **LLM 只做一件事**：LLM 只负责"吃进 60 条新闻摘要 → 吐出结构化 JSON"，不做网页正文提取（那是 extractor.js Readability 的活）
- **原子写入**：输出文件先写临时文件再 rename，防止写入中途崩溃导致文件损坏
