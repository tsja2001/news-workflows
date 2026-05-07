# Source 类型配置指南

所有 source 类型共用 `type` 字段区分。不写 `type` 时默认按 `rss` 处理（向后兼容）。

## 1. RSS（默认）

最常用的类型，支持标准 RSS 2.0 和 Atom feed。

```yaml
- name: Al Jazeera
  type: rss
  url: "https://www.aljazeera.com/xml/rss/all.xml"
  fetchFullContent: true          # 可选，回抓正文（默认 false）
  fetchContentConcurrency: 3      # 可选，回抓并发上限（默认 3）
```

## 2. HTML 静态站

适用于列表页 + 文章页都是服务端渲染的静态站。

```yaml
- name: 新华社国际
  type: html
  listUrl: "https://www.news.cn/world/"
  encoding: utf-8                # 可选，默认 utf-8
  selectors:
    articleLinks: ".dataList li a"  # 必填，列表页文章链接
    title: "h1.article-title"       # 可选，缺则用 Readability
    content: "div.article-body"     # 可选
    publishedAt: "span.pub-time"    # 可选
    publishedAtAttr: "datetime"     # 可选，时间从属性取而非文本
  linkPrefix: "https://www.news.cn" # 相对链接转绝对链接的前缀
  maxArticles: 20                   # 可选，默认 20
```

**策略**：优先用 cheerio + 选择器直接提取；如果没配选择器或提取失败，降级用 Readability。

## 3. Playwright（JS 渲染站）

适用于需要 JS 执行才能渲染的 SPA 新闻站。使用前需安装 Chromium：

```bash
npx playwright install chromium
```

```yaml
- name: SPA 新闻站
  type: playwright
  listUrl: "https://example.com/news"
  waitFor: ".news-item"            # 等此 CSS 出现再抓（可选）
  waitTimeoutMs: 10000             # 可选，默认 10000
  selectors:
    articleLinks: ".news-item a"   # 必填
    title: "h1"                    # 可选
    content: "article"             # 可选
    publishedAt: "time"            # 可选
  blockResources: true             # 默认 true，屏蔽图片/字体/CSS
  maxArticles: 15                  # 可选，默认 15
```

**性能**：browser 实例全局复用，每个 source 使用独立 context。进程退出时自动关闭。

## 4. API（通用 JSON API）

通用的 JSON API → NewsItem 映射，不为任何具体 API 写专属代码。

```yaml
- name: NewsAPI - Iran
  type: api
  endpoint: "https://newsapi.org/v2/everything"
  method: GET                    # 可选，默认 GET
  params:
    q: "Iran sanctions"
    language: en
    apiKey: "${NEWSAPI_KEY}"     # ${} 从环境变量取值
  responseShape:
    itemsPath: "articles"        # 必填，JSON 中数组的路径
    fields:                      # 必填，字段映射（支持点号路径）
      title: "title"
      url: "url"
      publishedAt: "publishedAt"
      summary: "description"
      source: "source.name"
```

**`${VAR}` 语法**：yaml 配置中任何字符串的 `${VAR}` 都会在加载时替换为 `process.env.VAR`。未定义的变量会直接报错。

## 5. Web ⭐ 推荐用于新源

**推荐所有非 RSS 新源优先使用 `type: web`**。用 Playwright 处理渲染 + AI 提取内容，只需 `name` + `url`（或 `urls`）两个字段。

### 基础用法

```yaml
- name: BBC 中东
  type: web
  url: "https://www.bbc.com/news/world/middle_east"
  # 以下均为可选
  maxArticles: 50                    # 默认 50，整个 source 的总上限
  hint: "新闻列表在主面板"            # 给 AI 的额外上下文
  extractDepth: deep                 # 'normal' | 'deep'，默认 'deep'
  waitFor:                           # 加载等待策略
    type: networkidle                # networkidle | selector | timeout
    timeoutMs: 30000
  sessionFile: "state/sessions/bbc.json"  # 复用登录态
  fetchDetail: true                  # 默认 true
  detailExtraction: auto             # auto | readability | ai | deep
  detailConcurrency: 3               # 默认 3
  blockResources: true               # 默认 true，屏蔽图片/字体/CSS
```

### 提取深度（extractDepth）

- `deep`（默认）：穷尽提取，AI 不会自行丢弃低置信度条目，返回所有候选并标记 `confidence`（high/medium/low）和 `section`（来源区块）
- `normal`：沿用 Phase 2.5 的保守 prompt，AI 只识别最明显的新闻条目

候选按 confidence 排序（high → medium → low）后截取 maxArticles 条进入详情抓取。

### 详情提取策略（detailExtraction）

四种模式：
- `auto`（默认）：先 readability，正文 < 100 字时降级到 AI
- `readability`：只用 Mozilla Readability
- `ai`：直接用 AI 从 HTML 中提取
- `deep`：同时执行 readability + AI，取正文更长者（双倍 token 消耗）

### 多 URL（多版块）

一个 source 可配置多个列表 URL，共享 `maxArticles` 上限：

```yaml
- name: BBC News（多版块）
  type: web
  urls:
    - "https://bbc.com/news/world/middle_east"
    - "https://bbc.com/news/world/asia"
    - url: "https://bbc.com/news/politics"
      hint: "英国政治版块"            # 每个 URL 可带独立提示
  maxArticles: 30                    # 多 URL 候选合并后的总上限
```

`url`（单数）和 `urls`（数组）互斥，必须有一个。`urls` 支持纯字符串和 `{ url, hint }` 对象混用。

### 分页

URL 中使用 `{page}` 占位符展开分页：

```yaml
- name: 多页新闻站
  type: web
  url: "https://example.com/news?page={page}"
  pages: 3                           # 必填，总页数
  pageStart: 0                       # 可选，起始页码，默认 1
  pageDelayMs: 2000                  # 可选，页间延迟（毫秒），默认 1000

# urls 数组中独立配置分页
- name: 多版块带分页
  type: web
  urls:
    - url: "https://a.com/?p={page}"
      pages: 2
    - "https://b.com/single"         # 这个不分页
```

约束：
- 有 `{page}` 必须有 `pages`，反之亦然
- 硬上限：单个 source 最多展开 20 个 URL（多 listUrl × 多页）

**策略**：URL 展开 → 浏览器逐 URL 渲染 → HTML 瘦身 → AI 提取链接列表 → 多 URL 候选合并去重 → confidence 排序 → 截取 ← maxArticles → 逐个访问详情页提取正文。

## 通用字段

以下字段所有类型都支持：

| 字段 | 说明 |
|------|------|
| `name` | 源名称，会出现在简报的来源标注中 |
| `type` | `rss` / `html` / `playwright` / `api` / `web`，默认 `rss` |

## 运行时参数

在 topic yaml 的顶层可配置全局运行时参数（所有 source 共用）：

```yaml
runtime:
  concurrency: 5        # 旧格式：source 级别并发上限（默认 5）

  # 新格式：按 type 分别限制并发
  concurrency:
    rss: 8              # RSS 轻量，可高并发
    html: 5
    api: 5
    playwright: 2
    web: 2              # web 重（浏览器+AI），严格限制
    default: 5

  sourceTimeoutMs: 180000  # 单个源最长 3 分钟（可选，默认无限）
  retries: 3               # 网络请求重试次数（默认 3）
```
