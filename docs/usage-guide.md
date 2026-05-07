# 使用文档

## 快速开始

```bash
npm install                        # 安装依赖
cp .env.example .env               # 配置 API key
npx playwright install chromium    # 如果用 web/playwright 适配器
npm run brief <topic-id>           # 生成简报
```

`.env` 只需要 3 行：

```env
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

---

## 命令

### `npm run brief <topic-id> [--no-dedup]`

生成简报。`topic-id` 对应 `config/topics/<topic-id>.yaml`。

```bash
npm run brief us-iran                    # 正常生成
npm run brief us-iran -- --no-dedup      # 跳过历史去重（调试用）
```

### `npm run audit -- <子命令>`

查询历史审计日志。

```bash
npm run audit -- list                   # 最近 20 次运行
npm run audit -- list us-iran           # 按主题过滤
npm run audit -- show <runId>           # 某次运行详情
npm run audit -- candidates <runId>     # 某次运行的全部候选
npm run audit -- diff <id1> <id2>       # 对比两次运行
npm run audit -- query <id> "jq表达式"  # jq 查询（需安装 jq）
npm run audit -- prune 30 --yes         # 删除 30 天前的日志
```

### `npm test`

运行全部单元测试。

---

## 配置

### 主题 YAML（`config/topics/<id>.yaml`）

```yaml
id: my-topic              # 必须，与文件名一致
title: 我的主题           # 必须，出现在简报标题中

sources:                  # 必须，至少一个
  - name: 源名称
    # ↓ 下面选一种 type，见下一节
    type: web
    url: "https://..."

filter:                   # 可选
  keywords: [词1, 词2]    # 标题/摘要命中任一即保留（空=不过滤）
  lookbackHours: 48       # 只保留 N 小时内的新闻
  maxItems: 80            # 最终喂给 LLM 的最大条数（默认 80）

dedup:                    # 可选
  enabled: true           # 开启后同 URL 不会重复出现
  retentionDays: 7        # 去重记录保留天数

output:                   # 必须
  dir: "/path/to/output"  # 简报输出目录（支持 ${ENV_VAR}）
```

### source 类型速查

#### `rss` — RSS/Atom feed

```yaml
- name: Al Jazeera
  type: rss                              # 默认值，可省略
  url: "https://www.aljazeera.com/xml/rss/all.xml"
  fetchFullContent: true                 # 回抓正文（默认 false）
```

#### `html` — 静态 HTML 站

```yaml
- name: 新华社
  type: html
  listUrl: "https://www.news.cn/world/"
  selectors:
    articleLinks: ".dataList li a"       # 必填
  maxArticles: 20
```

#### `playwright` — JS 渲染站

```yaml
- name: SPA 站
  type: playwright
  listUrl: "https://example.com/news"
  waitFor: ".news-item"
  selectors:
    articleLinks: ".news-item a"         # 必填
```

#### `api` — 通用 JSON API

```yaml
- name: NewsAPI
  type: api
  endpoint: "https://newsapi.org/v2/everything"
  params:
    q: "Iran"
    apiKey: "${NEWSAPI_KEY}"
  responseShape:
    itemsPath: "articles"                # JSON 中数组的路径
    fields:
      title: "title"
      url: "url"
      publishedAt: "publishedAt"
      summary: "description"
```

#### `web` ⭐ — AI 通用抓取（推荐）

只需 `name` + `url`（或 `urls`），用 Playwright 渲染 + AI 提取内容。

**基础用法：**

```yaml
- name: BBC 中东
  type: web
  url: "https://www.bbc.com/news/world/middle_east"
  maxArticles: 50                # 默认 50
  detailExtraction: auto         # auto | readability | ai | deep
```

**多版块：**

```yaml
- name: BBC 多版块
  type: web
  urls:
    - "https://bbc.com/news/world/middle_east"
    - url: "https://bbc.com/news/asia"
      hint: "亚洲版块"
  maxArticles: 50
```

**分页：**

```yaml
- name: 多页站
  type: web
  url: "https://example.com/news?page={page}"
  pages: 3                       # 抓 3 页
  pageStart: 0                   # 起始页，默认 1
  pageDelayMs: 2000              # 页间延迟防反爬，默认 1000ms
```

**web 完整字段：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` / `urls` | string / array | - | 列表页 URL（二选一） |
| `maxArticles` | number | 50 | 抓取详情条数上限 |
| `hint` | string | "" | 给 AI 的额外提示 |
| `extractDepth` | `normal\|deep` | `deep` | 列表提取深度 |
| `detailExtraction` | `auto\|readability\|ai\|deep` | `auto` | 正文提取策略 |
| `detailConcurrency` | number | 3 | 详情页并发数 |
| `pages` | number | - | 分页总数 |
| `pageStart` | number | 1 | 分页起始页码 |
| `pageDelayMs` | number | 1000 | 页间延迟（毫秒） |
| `waitFor` | object | - | 页面加载等待策略 |
| `fetchDetail` | boolean | true | 是否抓详情页 |
| `blockResources` | boolean | true | 是否屏蔽图片/字体 |

### 运行时参数

在主题 YAML 的 `filter.runtime` 下配置：

```yaml
filter:
  runtime:
    concurrency:           # 按 type 的并发上限
      rss: 8
      web: 2
      default: 5
    sourceTimeoutMs: 180000   # 单个源超时（毫秒）
    retries: 3                # 重试次数
```

---

## 输出

每次运行在 `output.dir` 下生成两个文件：

```
2026-05-05-143052-美国伊朗局势速报.md   # 人读的 Markdown
2026-05-05-143052-美国伊朗局势速报.json  # 程序读的 JSON
```

文件名精确到秒，同一天多次运行不互相覆盖。

---

## 审计日志

每次运行自动在 `logs/audit/{日期}/` 下生成：

```
us-iran-20260505-143052-abc12.jsonl         # 完整事件流（JSONL）
us-iran-20260505-143052-abc12.summary.json  # 汇总
```

用 `npm run audit` 查询（详见上方命令），或直接用 `jq`：

```bash
cat logs/audit/2026-05-05/*.jsonl | jq 'select(.event == "list_extracted")'
```

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | API 密钥 | 必填 |
| `LLM_BASE_URL` | API 地址 | - |
| `LLM_MODEL` | 模型名 | `gpt-4o-mini` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `LLM_INPUT_PRICE_PER_1M_TOKENS` | 输入价格（元） | `0.14` |
| `LLM_OUTPUT_PRICE_PER_1M_TOKENS` | 输出价格（元） | `0.28` |

---

## 常见问题

**Q: 报 `LLM_API_KEY not found`？**
A: 检查 `.env` 文件是否存在且内容正确。`dotenv` 在 `src/index.js` 第一行加载。

**Q: web 适配器抓不到内容？**
A: 检查是否安装了 Chromium（`npx playwright install chromium`），检查目标网站是否需要翻墙。

**Q: AI 提取的新闻不准？**
A: 试试 `extractDepth: normal`（更保守），或给 `hint` 添加提示引导 AI。

**Q: 如何查看某条新闻为什么没进简报？**
A: `npm run audit -- candidates <runId>` 列出所有候选，追踪被过滤的原因。

**Q: 可以不用 LLM 吗？**
A: 不能。整个流程的核心是将新闻喂给 LLM 做深度加工，没有 LLM 就不是简报工具了。
