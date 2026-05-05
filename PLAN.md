# news-workflows 升级开发任务书

> 本文档是给执行 Agent(codex 等)的分阶段开发指令。每个 Phase 独立可交付、独立可测试。
> 严格按顺序执行,不要跳阶段。每个 Phase 完成后请人类 review,通过后再进入下一个 Phase。

---

## 项目背景

`news-workflows` 是一个基于 RSS + LLM 的中文新闻简报生成工具,详见根目录 `README.md`(或现有架构文档)。
当前架构清晰但功能基础,需要分 4 个阶段升级:

- **Phase 1**: 基础设施重构(适配器模式 + 历史去重 + 并发/重试)
- **Phase 2**: 抓取能力扩展(HTML 爬虫 + Playwright + 正文提取)
- **Phase 3**: LLM 层加固(可观测性 + 结构化输出)
- **Phase 4**(可选): 进阶增强(多语言、聚类、周报)

---

## 全局开发约束(所有 Phase 都要遵守)

### 代码风格
- 沿用现有项目的 ES Module 风格(`import` / `export`),不要混入 CommonJS
- 沿用现有的命名习惯(camelCase 变量、kebab-case 文件名)
- 中文注释保留,新写的注释也用中文(项目作者是中文用户)
- 不要引入 TypeScript,继续用纯 JS + JSDoc 类型注释

### 依赖管理
- 新依赖必须在对应 Phase 的"依赖清单"里列出,不要擅自加包
- 优先选轻量、维护活跃的包(看 npm 周下载量和最近更新时间)
- 锁定版本到 minor(`^x.y.z`),避免 breaking change

### 兼容性
- **每个 Phase 完成后,现有的 `npm run brief us-iran` 必须还能正常工作**,这是回归测试的底线
- 新功能默认关闭(opt-in),通过 yaml 配置或环境变量开启
- 不要修改现有 yaml 配置文件的格式,只允许**新增**字段

### 测试要求
- 每个 Phase 必须有可执行的验收命令(在 `package.json` 加 npm script)
- 关键模块加 `*.test.js` 单元测试(用 Node.js 内置 `node:test`,不引入 Jest/Vitest)
- 测试不依赖外网(用本地 fixture 或 mock)

### 提交规范
- 每个 Phase 一个 git branch:`feature/phase-1-infra`、`feature/phase-2-crawler` 等
- commit 粒度细,每个 commit 只做一件事
- commit message 用中文,前缀用 `feat:` / `refactor:` / `test:` / `docs:` / `fix:`

### 不要做的事
- ❌ 不要重写现有能跑通的代码,只做必要重构
- ❌ 不要引入 ORM、消息队列、Redis 等重型基础设施
- ❌ 不要在这个项目里实现推送(飞书等),那是 OpenClaw 的职责
- ❌ 不要硬编码任何路径、API key、模型名,全部走 yaml 或 .env
- ❌ 遇到不确定的设计决策,**停下来问人类**,不要自行发明

---

# Phase 1:基础设施重构

**目标**:把 `fetch.js` 重构为可扩展的适配器模式,加入历史去重、并发控制、重试机制。
**预计工时**:1-2 天
**Branch**:`feature/phase-1-infra`

## 1.1 重构 fetch 为适配器模式

### 目录结构(新)

```
src/
├── fetch/
│   ├── index.js          # 调度器:根据 source.type 路由
│   ├── rss.js            # 现有 RSS 抓取逻辑迁移到这里
│   ├── common.js         # 共用工具(时间过滤、关键词过滤、URL 去重、截断)
│   └── types.js          # JSDoc 类型定义(NewsItem 结构)
├── fetch.js              # 改为薄壳,仅 re-export,保持向后兼容
└── ...(其他文件不动)
```

### 接口设计

每个抓取器导出统一签名:

```js
/**
 * @typedef {Object} NewsItem
 * @property {string} title
 * @property {string} url
 * @property {string} source
 * @property {string} publishedAt   ISO8601
 * @property {string} summary       原始摘要(可能为空)
 * @property {string} [content]     正文(Phase 2 才有)
 */

/**
 * @param {Object} sourceConfig - yaml 里单个 source 的配置对象
 * @param {Object} [options]
 * @returns {Promise<NewsItem[]>}
 */
export async function fetchFromXxx(sourceConfig, options) { ... }
```

`src/fetch/index.js` 是调度器:

```js
import { fetchFromRss } from './rss.js';
// Phase 2 会加更多
const ADAPTERS = {
  rss: fetchFromRss,
  // html: ...      // Phase 2
  // playwright: .. // Phase 2
  // api: ...       // Phase 2
};

export async function fetchAll(sources, filterConfig) {
  // 对每个 source 路由到对应 adapter
  // adapter 失败不影响其他 source(try/catch 包裹)
  // 返回扁平化的 NewsItem[]
}
```

### 兼容性要求
- 现有 `src/index.js` 调用 `fetch.js` 的接口签名**完全不变**
- yaml 里**没有 `type` 字段时默认按 `rss` 处理**(向后兼容)
- 现有 `us-iran.yaml` 不修改也能跑

## 1.2 历史去重模块

### 目标
同一条新闻 URL 在过去 N 天内已经处理过,就不再喂给 LLM。

### 设计

```
state/
└── seen-urls.json    # 由代码维护,gitignore 掉
```

文件结构:
```json
{
  "us-iran": {
    "https://example.com/article-1": "2026-05-04T10:23:00Z",
    "https://example.com/article-2": "2026-05-05T08:11:00Z"
  },
  "ai-industry": { ... }
}
```

### 模块:`src/state/seen-store.js`

```js
export async function loadSeen(topicId)              // 返回 Map<url, isoTimestamp>
export async function markSeen(topicId, urls)        // 批量标记
export async function pruneOldEntries(topicId, days) // 删除超过 N 天的记录
```

- 文件不存在时自动创建
- 写入用原子写(先写 `.tmp` 再 rename),防止并发或崩溃导致文件损坏
- 默认保留 7 天,可在 yaml 里 `dedup.retentionDays` 覆盖

### yaml 新增字段

```yaml
dedup:
  enabled: true              # 默认 false,显式开启
  retentionDays: 7
```

### 接入点
在 `fetch/common.js` 的过滤管线里加一道"历史去重"筛子,放在"URL 去重"之后、"截断"之前。
**simulate 模式**:加一个 `--no-dedup` CLI 参数,临时禁用历史去重(便于调试和重新生成)。

## 1.3 并发控制 + 重试

### 依赖清单
- `p-limit` (^5.x):并发上限
- `p-retry` (^6.x):指数退避重试

### 接入点

`src/fetch/index.js` 的批量抓取改用 `p-limit`:

```js
import pLimit from 'p-limit';
const limit = pLimit(filterConfig.concurrency ?? 5);
const results = await Promise.all(
  sources.map(s => limit(() => fetchOne(s)))
);
```

每个 adapter 内部对**网络请求**用 `p-retry` 包一层:

```js
await pRetry(() => fetch(url), {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 10000,
  onFailedAttempt: err => console.warn(`[${source}] 第 ${err.attemptNumber} 次失败:${err.message}`)
});
```

### yaml 新增字段(放在顶层 filter 同级或新建 `runtime`)

```yaml
runtime:
  concurrency: 5      # 默认 5
  fetchTimeoutMs: 15000
  retries: 3
```

## 1.4 验收标准(Phase 1)

执行以下命令必须全部通过:

```bash
# 1. 现有功能不退化
npm run brief us-iran

# 2. 单元测试
npm test

# 3. 历史去重生效:连续跑两次,第二次的 NewsItem 数量明显减少
npm run brief us-iran  # 第一次
npm run brief us-iran  # 第二次,应该几乎没新东西

# 4. 历史去重可禁用
npm run brief us-iran -- --no-dedup
```

### 必须新增的测试
- `src/fetch/common.test.js`:时间过滤、关键词过滤、URL 去重、截断
- `src/state/seen-store.test.js`:加载、写入、原子性(模拟崩溃后文件不损坏)、过期清理

### Phase 1 交付物清单
- [ ] `src/fetch/` 目录结构(适配器模式)
- [ ] `src/state/seen-store.js`
- [ ] yaml schema 兼容性验证(老配置能跑)
- [ ] CLI 参数 `--no-dedup`
- [ ] 单元测试覆盖核心模块
- [ ] `docs/phase-1-changes.md`(简短的变更说明,给人类 review)

---

# Phase 2:抓取能力扩展

**目标**:支持 HTML 静态站爬虫、Playwright JS 渲染站、官方 API 三类源,并为 RSS 增加正文回抓能力。
**预计工时**:2-3 天
**Branch**:`feature/phase-2-crawler`
**前置依赖**:Phase 1 已合并

## 2.1 正文提取通用层

### 目标
任何拿到 article URL 的地方,都能调用统一函数提取正文。

### 依赖清单
- `undici` (^6.x):比 node-fetch 快、内置 Node 18+ 兼容
- `cheerio` (^1.x):服务端 jQuery
- `@mozilla/readability` (^0.5.x):Firefox 阅读模式核心
- `jsdom` (^24.x):readability 依赖

### 模块:`src/fetch/extractor.js`

```js
/**
 * 抓取页面 HTML 并提取正文
 * @param {string} url
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<{ title, content, excerpt, byline, publishedAt }>}
 */
export async function extractArticle(url, options) { ... }
```

实现要点:
- 用 `undici.request` 拉 HTML(带 User-Agent、超时)
- 优先用 `readability` 提取
- readability 失败时降级:用 `cheerio` 抓 `<article>` / `main` / `[role=main]`
- 提取的正文做长度校验(< 100 字算失败,可能拿到了空壳)

### 单元测试
- 准备 `test/fixtures/` 放几个真实新闻页 HTML(脱敏后存),测试提取效果
- 至少覆盖:典型新闻站、CSR 渲染失败的站、纯文本站

## 2.2 RSS 适配器增强:正文回抓

### yaml 新增字段(每个 source 内)

```yaml
sources:
  - name: Al Jazeera
    type: rss
    url: "..."
    fetchFullContent: true        # 默认 false
    fetchContentConcurrency: 3    # 回抓正文的并发上限
```

### 行为
- RSS 解析完拿到链接后,用 `extractor.js` 回抓正文,合并到 `NewsItem.content`
- 回抓失败不影响该条目其他字段(用空字符串占位,记 warn 日志)
- 回抓走单独的 p-limit,避免和其他 source 争资源

## 2.3 HTML 适配器(静态站)

### 模块:`src/fetch/html.js`

### yaml schema

```yaml
- name: 新华社国际
  type: html
  listUrl: "https://www.news.cn/world/"
  encoding: utf-8                    # 可选,默认 utf-8
  selectors:
    articleLinks: ".dataList li a"   # 列表页文章链接,必填
    # 以下可选,缺失则交给 readability
    title: "h1.article-title"
    content: "div.article-body"
    publishedAt: "span.pub-time"
    publishedAtAttr: "datetime"      # 时间从属性还是文本取
  linkPrefix: "https://www.news.cn"  # 相对链接转绝对链接的前缀
  maxArticles: 20                    # 单源最多取多少条
```

### 行为
1. 拉 listUrl,用 cheerio 跑 `selectors.articleLinks` 拿链接列表
2. 对每个链接:
   - 如果 yaml 配了细粒度 selectors,用 cheerio 直接抓
   - 否则降级用 `extractor.js`
3. 时间字段如果抓不到,用"现在"作为兜底(打 warn)

### 健壮性
- 列表页失败 → 整个 source 失败(返回 [],不报错向上抛)
- 单篇文章失败 → 跳过那一篇,其他继续
- 同一 source 内的请求受 p-limit 限制

## 2.4 Playwright 适配器

### 依赖清单
- `playwright-core` (^1.45+):**不要装 `playwright` 完整包**,会拉一堆浏览器
- 单独通过文档说明用户需手动 `npx playwright install chromium`

### 模块:`src/fetch/playwright.js`

### yaml schema

```yaml
- name: 某 SPA 新闻站
  type: playwright
  listUrl: "https://example.com/news"
  waitFor: ".news-item"           # 等这个 CSS 出现再抓
  waitTimeoutMs: 10000
  selectors:
    articleLinks: ".news-item a"
    # 文章页同 html 类型
    title: "h1"
    content: "article"
  blockResources: true            # 默认 true,屏蔽图片字体 CSS
  maxArticles: 15
```

### 关键实现要点(性能!)

```js
// 必须做的优化:
import { chromium } from 'playwright-core';

let _browser;
async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({ headless: 'new' });
  }
  return _browser;
}

export async function fetchFromPlaywright(source) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: '...',
    // 禁用图片/字体/CSS,只要 HTML 和 JS
  });

  if (source.blockResources !== false) {
    await context.route('**/*.{png,jpg,jpeg,svg,gif,webp,woff,woff2,ttf,css}',
      r => r.abort());
  }

  try {
    // ... 抓取逻辑
  } finally {
    await context.close();   // 关 context 不关 browser
  }
}

// 进程退出前关闭 browser
export async function shutdownPlaywright() {
  if (_browser) await _browser.close();
}
```

`src/index.js` 在主流程结束时调用 `shutdownPlaywright()`。

### 健壮性
- `waitFor` 超时 → source 失败但不崩
- 每个 source 用独立 context,失败时关 context 不影响其他

## 2.5 API 适配器(NewsAPI 等)

### 模块:`src/fetch/api.js`

### yaml schema

```yaml
- name: NewsAPI - Iran
  type: api
  endpoint: "https://newsapi.org/v2/everything"
  method: GET                       # 默认 GET
  params:
    q: "Iran sanctions"
    language: "en"
    apiKey: "${NEWSAPI_KEY}"        # ${} 语法从 env 替换
  responseShape:                    # 告诉适配器怎么解析返回
    itemsPath: "articles"           # JSON 里数组的路径
    fields:
      title: "title"
      url: "url"
      publishedAt: "publishedAt"
      summary: "description"
      source: "source.name"         # 支持点号路径
```

### 行为
- 仅做"通用 JSON API → NewsItem"的映射
- 不为某个具体 API 写专属代码(保持通用性)
- ${ENV_VAR} 语法在 `config.js` 加载时统一处理

## 2.6 配置:env 变量替换

`src/config.js` 加载 yaml 后,递归替换字符串里的 `${VAR}` 为 `process.env.VAR`。
未定义的变量明确报错,不要静默替换为空字符串。

## 2.7 验收标准(Phase 2)

```bash
# 现有功能仍正常
npm run brief us-iran

# 新建一个测试用 yaml 同时含 4 种 source 类型
# config/topics/_test-mixed.yaml
npm run brief _test-mixed

# 单测
npm test
```

### 必须新增的测试
- `src/fetch/extractor.test.js`(用 fixtures)
- `src/fetch/html.test.js`(用 fixtures + mock undici)
- `src/fetch/api.test.js`(mock fetch)
- Playwright 适配器**不要写自动化测试**,手动验证即可(CI 跑不动浏览器)

### Phase 2 交付物清单
- [ ] 4 类适配器全部就绪
- [ ] RSS `fetchFullContent` 功能
- [ ] env 变量替换机制
- [ ] 文档:`docs/source-types.md`(每种 type 的 yaml 写法 + 例子)
- [ ] `_test-mixed.yaml` 留作测试基准

---

# Phase 3:LLM 层加固

**目标**:让 `llm.js` 从黑盒变成可观测、可重试、输出受 schema 约束的稳定模块。
**预计工时**:1 天
**Branch**:`feature/phase-3-llm`
**前置依赖**:Phase 1、2 已合并

## 3.1 调用日志和 token 统计

### 依赖清单
- 不引入新依赖(用 Node 内置 `fs/promises`)

### 设计

```
logs/
└── llm-calls/
    ├── 2026-05-05/
    │   ├── us-iran-08-00-12.json
    │   └── us-iran-08-00-12.prompt.txt   # 调试模式才写
```

每次调用记录:
```json
{
  "timestamp": "2026-05-05T08:00:12.345Z",
  "topic": "us-iran",
  "model": "deepseek-chat",
  "promptTokens": 4523,
  "completionTokens": 612,
  "totalTokens": 5135,
  "durationMs": 8234,
  "success": true,
  "retryCount": 0,
  "error": null
}
```

### 模块改动:`src/llm.js`

```js
export async function callLLMForJson(systemPrompt, userPrompt, options = {}) {
  const start = Date.now();
  const logEntry = { timestamp: new Date().toISOString(), ... };
  try {
    // 现有调用逻辑
    const result = await ...;
    logEntry.durationMs = Date.now() - start;
    logEntry.promptTokens = result.usage?.prompt_tokens;
    // ...
    await writeLogEntry(logEntry);
    return result;
  } catch (err) {
    logEntry.error = err.message;
    await writeLogEntry(logEntry);
    throw err;
  }
}
```

### 调试模式
环境变量 `LLM_DEBUG_DUMP=true` 时,把完整 prompt(system + user)落盘到 `.prompt.txt`,便于复盘。
默认 false(prompt 可能含敏感内容)。

## 3.2 重试 + 退避

`llm.js` 包一层 `p-retry`:

```js
await pRetry(actualCall, {
  retries: 3,
  minTimeout: 2000,
  factor: 2,
  onFailedAttempt: (err) => {
    // 记日志
    // 422(参数错)等不重试
    if (err.status === 422 || err.status === 401) throw new pRetry.AbortError(err);
  }
});
```

## 3.3 结构化输出(Zod schema)

### 依赖清单
- `zod` (^3.x)

### 模块:`src/schemas/brief.js`

```js
import { z } from 'zod';

export const BriefSchema = z.object({
  summary: z.string().min(5).max(120),
  keyDevelopments: z.array(z.string().min(2)).min(1).max(8),
  timeline: z.array(z.object({
    time: z.string(),
    event: z.string()
  })).max(20),
  risks: z.array(z.string()),
  unknowns: z.array(z.string())
});

export type Brief = z.infer<typeof BriefSchema>;
```

(用 JSDoc 替代 TypeScript 的 type 导出。)

### llm.js 接受 schema 参数

```js
export async function callLLMForJson(systemPrompt, userPrompt, { schema, ...options } = {}) {
  const raw = await callOnce(...);
  if (schema) {
    const result = schema.safeParse(raw);
    if (!result.success) {
      // 一次自动重试:把校验错误塞回 prompt 让模型修
      const retryUser = userPrompt + `\n\n上次输出不符合 schema,错误:${result.error.message}\n请严格按 JSON schema 返回。`;
      const raw2 = await callOnce(systemPrompt, retryUser);
      const result2 = schema.safeParse(raw2);
      if (!result2.success) throw new Error(`schema 校验连续失败:${result2.error.message}`);
      return result2.data;
    }
    return result.data;
  }
  return raw;
}
```

### summarize.js 接入

```js
import { BriefSchema } from './schemas/brief.js';
const brief = await callLLMForJson(SYSTEM, user, { schema: BriefSchema });
```

## 3.4 验收标准(Phase 3)

```bash
npm run brief us-iran
# 检查 logs/llm-calls/ 下有日志
# 故意把 .env 的 KEY 改错,确认重试 3 次后失败,日志里能看到 3 条 retry 记录

LLM_DEBUG_DUMP=true npm run brief us-iran
# 检查 .prompt.txt 文件存在

# Schema 兼容性:故意让模型返回缺字段(可以临时改 prompt 测试)
# 应该能自动重试一次,仍失败时报清晰的 schema 错误
```

### Phase 3 交付物清单
- [ ] LLM 调用日志(token + 耗时 + 重试)
- [ ] 自动重试 + 退避
- [ ] Zod schema + 一次自动修复重试
- [ ] 调试模式 prompt 落盘
- [ ] `logs/` 加入 `.gitignore`

---

# Phase 4:进阶增强(可选)

**说明**:Phase 4 不是必做,完成 Phase 1-3 后由人类决定要不要做哪些。
**Branch**:每个子项独立 branch

## 4.1 多语言两步摘要

非中文源先翻译+提炼成中文要点,再交给主流程综合。
- 在 source 配置里加 `language` 字段
- `summarize.js` 检测到非中文素材时,先调一次 LLM 做"翻译+结构化提炼"(用便宜 model 比如 `deepseek-chat`),输出中文要点
- 再用主 model 综合所有要点生成最终简报

## 4.2 子事件聚类

40 条新闻可能涵盖 3-4 个子事件。让 LLM 先做聚类,再分块总结。
- 新增 `clustering.enabled` yaml 配置
- 第一步 prompt 让 LLM 输出 `{ clusters: [{ topic, articleIndices }] }`
- 第二步对每个 cluster 单独总结
- 最后合成总简报

## 4.3 周报/月报回看

```bash
npm run digest us-iran -- --period weekly
npm run digest us-iran -- --period monthly
```

实现:
- 读取 `output.dir` 下过去 7/30 天的 `.json` 简报
- 喂给 LLM 生成"本周综述"
- 输出到 Obsidian 的 `_periodic/weekly/` 子目录

## 4.4 健康监控

`state/health.json`:每个 source 最近 N 次的成功/失败状态。
连续 3 次失败的源在简报底部标注"⚠️ 数据缺口"。

## 4.5 简报质量评估(实验性)

每次生成简报后,再用 LLM 做一次"质量自评"(覆盖度、客观性、是否有事实错误),输出到日志。
长期收集这些数据可以用来调优 prompt。

---

# 给 codex 的执行须知

## 工作流程
1. 读完整份文档,如有不理解的地方**立即问人类**,不要猜
2. 创建 Phase 1 branch,开始实施
3. 每个 commit 前自检:有没有违反"全局开发约束"?
4. Phase 完成后,运行所有验收命令,生成 `docs/phase-N-changes.md`,提交 PR
5. 等待人类 review,通过后再开始下一 Phase

## 何时停下来问人类
- yaml schema 设计有歧义时
- 某个第三方包的选择拿不准(比如 readability 的版本)
- 重构涉及现有模块的接口签名变更时
- 测试 fixture 不知道用什么真实数据时
- 任何"我觉得这样改会更好,但和文档不一致"的情况

## 自我检查清单(每个 PR 提交前过一遍)
- [ ] 现有 `npm run brief us-iran` 还能跑?
- [ ] `npm test` 全部通过?
- [ ] 新增依赖在文档对应"依赖清单"里?
- [ ] yaml 老格式仍兼容?
- [ ] commit message 中文 + 前缀?
- [ ] 没有硬编码路径/密钥?
- [ ] 中文注释?
- [ ] `docs/phase-N-changes.md` 写好了?

---

# 附录:目标最终架构图

```
src/
├── index.js                 # CLI 入口,串联流程
├── config.js                # yaml 加载 + ${env} 替换
├── fetch/
│   ├── index.js             # 调度器
│   ├── rss.js               # RSS 适配器(+ 正文回抓)
│   ├── html.js              # 静态 HTML 爬虫
│   ├── playwright.js        # JS 渲染站爬虫
│   ├── api.js               # 通用 JSON API 适配器
│   ├── extractor.js         # 正文提取(readability)
│   ├── common.js            # 过滤管线(时间/关键词/去重/截断)
│   └── types.js             # JSDoc 类型定义
├── state/
│   └── seen-store.js        # 历史去重存储
├── schemas/
│   └── brief.js             # Zod schema
├── llm.js                   # LLM 调用 + 重试 + 日志 + schema
├── summarize.js             # prompt 编写
└── output.js                # 写 .md + .json

config/topics/*.yaml         # 主题配置
state/seen-urls.json         # 历史去重状态(gitignore)
logs/llm-calls/              # LLM 调用日志(gitignore)
docs/                        # 各 Phase 变更文档
```
