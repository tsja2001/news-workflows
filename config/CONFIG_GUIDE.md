# 配置文件指南

主题配置文件位于 `config/topics/<topic-id>.yaml`，定义了新闻源、过滤规则和输出位置。

---

## 一、文件结构总览

```yaml
id: <主题ID>         # 必须，与文件名一致
title: <标题>        # 必须，简报显示名称

sources:             # 必须，新闻源列表
  - name: ...        #   通用字段见「二、通用字段」
    type: ...        #   各 type 专属字段见「三～六」

filter:              # 可选，过滤规则（见「七」）
  keywords: [...]
  lookbackHours: 36
  maxItems: 40

output:              # 必须，输出配置（见「八」）
  dir: "/path/to/output"
```

---

## 二、所有 source 的通用字段

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | 是 | — | 来源显示名称，会出现在每条新闻的 `source` 字段中 |
| `type` | 否 | `rss` | 抓取方式：`rss` \| `html` \| `api` \| `playwright` |

---

## 三、RSS 源（type: rss）

最常用的类型，从 RSS/Atom feed 拉取新闻。无需选择器配置，开箱即用。

### 字段

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | 是 | — | RSS feed 地址 |
| `fetchFullContent` | 否 | `false` | 是否回抓每篇文章的正文（通过 Readability 提取） |
| `fetchContentConcurrency` | 否 | `3` | 回抓正文时的并发上限 |

### 示例

```yaml
sources:
  - name: Al Jazeera
    type: rss                   # 可省略，默认就是 rss
    url: "https://www.aljazeera.com/xml/rss/all.xml"

  - name: Reuters
    type: rss
    url: "https://feeds.reuters.com/reuters/worldNews"
    fetchFullContent: true      # 回抓正文
    fetchContentConcurrency: 5  # 同时抓 5 篇
```

### 工作原理

1. 用 `rss-parser` 拉取 feed → 得到标题、链接、摘要、时间
2. 如果开启了 `fetchFullContent`，对每个链接调用 Readability 提取正文
3. 失败自动重试（重试次数由 `filter.runtime.retries` 控制，默认 3 次）

---

## 四、HTML 静态站（type: html）

适用于**服务端渲染**的新闻网站——列表页和文章页的 HTML 在服务器端生成，不需要浏览器执行 JS。

### 字段

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `listUrl` | 是 | — | 列表页 URL |
| `selectors.articleLinks` | 是 | — | CSS 选择器，从列表页提取文章链接。比如 `.headline a` |
| `selectors.title` | 否 | — | 文章页的标题选择器。不配则用 Readability 自动提取 |
| `selectors.content` | 否 | — | 文章页的正文选择器，如 `article`、`.post-body` |
| `selectors.publishedAt` | 否 | — | 文章页的发布时间选择器，如 `time`、`.date` |
| `selectors.publishedAtAttr` | 否 | — | 时间元素的属性名，如 `datetime`。不配则取元素的文本内容 |
| `linkPrefix` | 否 | `""` | 相对链接的前缀。文章链接是 `/article/123` 时，填 `https://example.com` |
| `maxArticles` | 否 | `20` | 最多抓取几篇文章 |

### 示例

```yaml
sources:
  # 简单场景：只配链接提取，正文靠 Readability 自动提取
  - name: Hacker News
    type: html
    listUrl: "https://news.ycombinator.com/"
    selectors:
      articleLinks: ".titleline > a"
    maxArticles: 5

  # 完整配置：精确指定每个字段的选择器
  - name: BBC 中东
    type: html
    listUrl: "https://www.bbc.com/news/world/middle_east"
    linkPrefix: "https://www.bbc.com"
    selectors:
      articleLinks: "a[href^='/news/']"
      title: "h1"
      content: "article"
      publishedAt: "time"
      publishedAtAttr: "datetime"
    maxArticles: 10
```

### 工作原理

1. 用 `undici` 拉取 `listUrl` 的 HTML
2. 用 `cheerio` 跑 `selectors.articleLinks` 选择器，提取文章链接列表
3. 并发（3 个）拉取每篇文章页的 HTML
4. 如果配了详情选择器，用 cheerio 精确提取；否则降级用 Readability 自动提取正文
5. 单篇文章失败不影响其他

### 选择器编写提示

- 用浏览器 F12 打开目标网站，找到列表页的文章链接元素，观察它的 class 或结构
- `articleLinks` 选择器应该选中 `<a>` 标签（程序读取 `href` 属性）
- 如果文章链接是相对路径（如 `/world/2024/iran-talks`），必须配 `linkPrefix`
- 选择器变了会导致「列表页未提取到任何链接」警告，需要更新

---

## 五、API 源（type: api）

适用于提供 JSON API 的新闻数据源（NewsAPI、The Guardian API 等）。

### 字段

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | 是 | — | API 地址 |
| `method` | 否 | `GET` | HTTP 方法 |
| `params` | 否 | — | 查询参数键值对。值支持 `${ENV_VAR}` 引用环境变量 |
| `responseShape.itemsPath` | 是 | — | JSON 中新闻数组的路径，用 `.` 分隔，如 `"articles"`、`"data.news"` |
| `responseShape.fields.title` | 否 | — | 标题字段路径，如 `"title"`、`"headline.main"` |
| `responseShape.fields.url` | 否 | — | URL 字段路径 |
| `responseShape.fields.publishedAt` | 否 | — | 发布时间字段路径 |
| `responseShape.fields.summary` | 否 | — | 摘要字段路径 |
| `responseShape.fields.source` | 否 | 使用 `name` | 来源名称字段路径，如 `"source.name"` |

### 示例

```yaml
sources:
  - name: NewsAPI - Iran
    type: api
    endpoint: "https://newsapi.org/v2/everything"
    method: GET
    params:
      q: "Iran sanctions"
      apiKey: "${NEWSAPI_KEY}"    # 从 .env 读取
    responseShape:
      itemsPath: "articles"        # 新闻在 response.articles 里
      fields:
        title: "title"
        url: "url"
        publishedAt: "publishedAt"
        summary: "description"
        source: "source.name"      # 点号表示嵌套取值
```

### 工作原理

1. `endpoint` + `params` 拼接成完整 URL
2. 用 `undici` 发送请求，获取 JSON
3. 按 `itemsPath` 取出数组
4. 按 `fields` 映射为统一的 NewsItem 格式

### responseShape 说明

不同 API 返回的 JSON 结构千差万别。`responseShape` 的作用是告诉程序「新闻列表在哪儿、每条新闻的字段叫什么」。

- `itemsPath` — 比如 NewsAPI 返回 `{ status: "ok", articles: [...] }`，就填 `"articles"`
- 如果 API 返回 `{ data: { news: [...] } }`，就填 `"data.news"`
- `fields` 支持点号路径，比如 `"source.name"` 会取 `item.source.name`

---

## 六、Playwright 源（type: playwright）

适用于**需要 JS 执行才能渲染**的新闻站（SPA、React/Vue 渲染、有反爬机制的站）。

### 前置条件

```bash
npx playwright install chromium   # 只需执行一次
```

### 字段

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `listUrl` | 是 | — | 列表页 URL |
| `selectors.articleLinks` | 是 | — | CSS 选择器，从列表页提取文章链接 |
| `selectors.title` | 否 | — | 文章页标题选择器 |
| `selectors.content` | 否 | — | 文章页正文选择器 |
| `selectors.publishedAt` | 否 | — | 文章页发布时间选择器 |
| `waitFor` | 否 | — | 等这个 CSS 选择器出现后再提取链接（适用于慢渲染页面） |
| `waitTimeoutMs` | 否 | `10000` | 最长等待时间（毫秒） |
| `blockResources` | 否 | `true` | 是否屏蔽图片/字体/CSS 加载。设为 `false` 则不屏蔽 |
| `maxArticles` | 否 | `15` | 最多抓取几篇 |

### 示例

```yaml
sources:
  # 简单场景：JS 渲染的新闻列表
  - name: NPR World
    type: playwright
    listUrl: "https://www.npr.org/sections/world/"
    waitFor: "h2 a"              # 等标题链接渲染好
    selectors:
      articleLinks: "article a[href*='/20']"
      title: "h1"
      content: "article, #storytext, .storytext"
    maxArticles: 3

  # 慢速站点：增大超时 + 不屏蔽资源（有些站屏蔽资源会检测失败）
  - name: 慢速新闻站
    type: playwright
    listUrl: "https://example-slow-site.com/news"
    waitFor: ".article-list .item"
    waitTimeoutMs: 20000
    blockResources: false
    selectors:
      articleLinks: ".article-list .item a"
    maxArticles: 5
```

### 工作原理

1. 启动 Chromium 浏览器（全局复用，不会每次重启）
2. 打开新标签页 → 访问 `listUrl` → 等 `waitFor` 选择器出现
3. 用 `page.$$eval()` 提取所有文章链接
4. **逐个**访问文章页（与 HTML 适配器的并发不同，Playwright 一次只打开一页）
5. 用选择器提取标题/正文/时间，选择器没配的字段自动降级
6. 抓完后关闭标签页，浏览器保持运行供下一个源复用

### 与 HTML 适配器的区别

| | HTML (`type: html`) | Playwright (`type: playwright`) |
|---|---|---|
| 引擎 | undici（HTTP 客户端） | Chromium 浏览器 |
| 速度 | 快，可并发 | 慢，逐页访问 |
| JS 渲染 | 不支持 | 支持 |
| 资源占用 | 极小 | 几百 MB 内存 |
| 适用场景 | 传统 SSR 网站 | SPA、反爬站、需 JS 交互的站 |

多数新闻站其实是服务端渲染的（为了 SEO），**优先用 HTML 适配器**。只有确认 undici 拿不到内容时，才用 Playwright。

---

## 七、过滤配置（filter）

所有源抓完后，统一走过滤管线。

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `keywords` | 否 | `[]` | 关键词列表。标题或摘要中**命中任意一个**即保留（大小写不敏感） |
| `lookbackHours` | 否 | — | 时间窗口（小时）。只保留 N 小时内的新闻 |
| `maxItems` | 否 | — | 最终保留的最大条目数（按时间倒序截取） |
| `runtime.concurrency` | 否 | `5` | 同时抓几个源（并发上限） |
| `runtime.retries` | 否 | `3` | 每个源的网络请求重试次数 |

### 过滤管线顺序

```
原始条目 → 时间窗口过滤 → 关键词过滤 → URL 去重 → 时间排序 → 截取前 N 条
```

控制台会输出每一阶段剔除了多少条。

---

## 八、输出去重（output / dedup）

### 输出

| 字段 | 必须 | 说明 |
|------|------|------|
| `output.dir` | 是 | 输出目录的绝对路径。每次运行生成 `${日期}-${标题}.md` 和 `.json` |

### 历史去重

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `dedup.enabled` | 否 | — | 设为 `true` 开启跨次运行的 URL 去重 |
| `dedup.retentionDays` | 否 | `7` | 已见 URL 保留天数。过期自动清理 |

```yaml
dedup:
  enabled: true
  retentionDays: 14
```

开启后，每次运行前加载历史上已见过的 URL，过滤时剔除。运行结束后把新 URL 存入 `state/seen-urls.json`。

用 `--no-dedup` 参数可以临时跳过去重：

```bash
npm run brief us-iran --no-dedup
```

---

## 九、环境变量引用

YAML 中任何字符串值都可以用 `${VAR_NAME}` 引用 `.env` 文件中的环境变量：

```yaml
params:
  apiKey: "${NEWSAPI_KEY}"

output:
  dir: "${HOME}/NewsBriefs/伊朗"
```

---

## 十、完整示例

综合以上所有类型，配置文件的完整形态：

---
## 十一、编辑层配置（editorial）

控制 LLM 的写作风格、读者画像、内容筛选和输出结构。整个 `editorial` 段是可选的，缺失时走代码内默认值。

### 字段速查

| 字段 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `persona` | 否 | `资深国际新闻主编` | 编辑人设，拼进 system prompt 顶部 |
| `tone` | 否 | `专业克制，有判断但不情绪化` | 写作语气与风格示范，原样注入 prompt |
| `interests` | 否 | `[]` | 读者最关心的方向列表，LLM 据此排序和定视角 |
| `excludeTopics` | 否 | `[]` | 读者不感兴趣的话题（自然语言），LLM 据此剔除或降级 |
| `excludeKeywords` | 否 | `[]` | fetch 阶段硬过滤的关键词，标题/摘要命中即丢弃（大小写不敏感） |
| `lowAttentionHandling` | 否 | `brief` | 低关注度素材处理：`brief`（合并进短讯区）、`drop`（丢弃）、`expand`（正常展开） |
| `tldr.enabled` | 否 | `true` | 是否生成 30 秒速读区 |
| `tldr.maxItems` | 否 | `5` | 速读区最多几条 bullet |
| `keyDevelopmentsLimit.high` | 否 | `5` | 高关注度最多展示几条 |
| `keyDevelopmentsLimit.medium` | 否 | `3` | 中关注度最多展示几条 |
| `mergeContextIntoOverview` | 否 | `true` | 是否把 context 段合并进 overview（删除冗余的独立背景段） |

### 完整示例

```yaml
editorial:
  persona: "私人内参编辑，给一位长期关注全球地缘冲突的熟客做日报"
  tone: |
    口语化、有立场、敢下判断。可以说"说白了就是…"。
    不装客观，但每个判断都要有素材里的依据。
  interests:
    - 中东能源与航道
    - 俄乌战场进展与停火谈判
    - 中美俄三方博弈
    - 台海与南海军事动向
  excludeTopics:
    - 与地缘冲突无关的国内政治丑闻
    - 名人/娱乐/体育/文艺
    - 与冲突无关的交通事故
  excludeKeywords:
    - "U-17"
    - football
    - soccer
    - podcast
  lowAttentionHandling: brief
  tldr:
    enabled: true
    maxItems: 5
  keyDevelopmentsLimit:
    high: 5
    medium: 3
  mergeContextIntoOverview: true
```

### 向后兼容

整个 `editorial` 段可省略。缺失时：
- `persona` / `tone` 用默认值（专业克制风格）
- `excludeKeywords` / `excludeTopics` 为空（不过滤）
- `lowAttentionHandling` = `brief`（低关注度进短讯区）
- `tldr.enabled` = `true`（默认生成速读区）
- `mergeContextIntoOverview` = `true`（默认合并，更紧凑）

不加 editorial 段的其他主题 yaml 基本保持原有行为，仅输出版面多出 TL;DR 和短讯区。

---

## 十、完整示例

```yaml
id: my-topic
title: 我的新闻主题

sources:
  # RSS
  - name: Source 1
    url: "https://example.com/rss.xml"
    fetchFullContent: true

  # HTML 静态站
  - name: Source 2
    type: html
    listUrl: "https://example.com/news"
    linkPrefix: "https://example.com"
    selectors:
      articleLinks: ".headline a"
      title: "h1"
      content: "article .body"
      publishedAt: "time"
      publishedAtAttr: "datetime"
    maxArticles: 10

  # API
  - name: Source 3
    type: api
    endpoint: "https://api.example.com/v2/news"
    params:
      q: "keyword"
      apiKey: "${MY_API_KEY}"
    responseShape:
      itemsPath: "data.articles"
      fields:
        title: "headline"
        url: "link"
        publishedAt: "date"
        summary: "snippet"

  # Playwright
  - name: Source 4
    type: playwright
    listUrl: "https://spa-example.com/news"
    waitFor: ".news-card"
    selectors:
      articleLinks: ".news-card a"
      title: "h1"
      content: ".article-content"
    maxArticles: 5

filter:
  keywords:
    - keyword1
    - keyword2
  lookbackHours: 48
  maxItems: 50
  runtime:
    concurrency: 4
    retries: 3

dedup:
  enabled: true
  retentionDays: 7

output:
  dir: "/absolute/path/to/output"

editorial:
  persona: "私人内参编辑"
  tone: "口语化、有立场、敢下判断"
  interests:
    - 中东能源与航道
    - 俄乌战场进展
  excludeTopics:
    - 娱乐/体育/名人
  excludeKeywords:
    - football
    - podcast
  lowAttentionHandling: brief
  tldr:
    enabled: true
    maxItems: 5
  keyDevelopmentsLimit:
    high: 5
    medium: 3
  mergeContextIntoOverview: true
```
