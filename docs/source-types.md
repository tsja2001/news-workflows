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

## 通用字段

以下字段所有类型都支持：

| 字段 | 说明 |
|------|------|
| `name` | 源名称，会出现在简报的来源标注中 |
| `type` | `rss` / `html` / `playwright` / `api`，默认 `rss` |

## 运行时参数

在 topic yaml 的顶层可配置全局运行时参数（所有 source 共用）：

```yaml
runtime:
  concurrency: 5        # source 级别并发上限（默认 5）
  retries: 3            # 网络请求重试次数（默认 3）
```
