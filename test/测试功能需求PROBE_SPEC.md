# Source Probe 实现规格文档

> 本文档是完整的实现规格，供另一个模型无需问询即可独立实现。

---

## 一、背景与目标

### 项目概述

这是一个基于 RSS + LLM 的新闻简报生成工具，运行流程为：

```
index.js (CLI 入口)
  → config.js   (加载 config/topics/<id>.yaml)
  → fetch/index.js (并发拉取所有源)
      → fetch/rss.js      (RSS 适配器)
      → fetch/web.js      (Web 适配器，使用 Playwright + LLM 提取)
      → fetch/html.js     (静态 HTML 适配器)
      → fetch/api.js      (API 适配器)
  → summarize.js (所有文章 → LLM → 结构化简报)
  → output.js   (写 .md 和 .json 文件)
```

### 核心痛点

1. **卡死或超时**：某些 web 源使用 Playwright 浏览器抓取，遇到反爬/慢响应时会卡住很久
2. **LLM 提取失败**：fetch 阶段有两处 LLM 调用（列表页提取、详情页提取），上下文过长或格式异常时静默失败，返回 0 条
3. **summarize 上下文过长**：RSS 源的 `item.content` 字段无截断，80 条文章聚合后 prompt 可能超出模型上下文限制
4. **排查成本高**：完整运行一次 20+ 个源需要 10~50 分钟，无法快速定位哪个源出了什么问题

### 目标

构建一个独立的 **Source Probe（源探针）**工具，实现：

- 针对每个配置的新闻源**单独**运行真实 adapter，记录成功/失败/超时
- 持久化哪些源已经通过，**下次运行时跳过通过的源**
- 提供详细日志，每个源输出：耗时、文章数、样本标题、失败原因
- 额外检测 summarize 阶段的 **token 超限风险**（不真实调用 LLM，只做估算）

---

## 二、技术约束

以下约束必须严格遵守，否则与现有代码不兼容：

1. **ES Module**：所有文件使用 `import`/`export`，不使用 `require()`，文件扩展名必须写 `.js`
2. **纯 JS + JSDoc**：不使用 TypeScript
3. **中文注释**：注释用中文，变量/函数名用 camelCase 英文
4. **不修改现有代码**：不改动 `src/` 下任何文件，探针只调用现有 adapter
5. **不添加新的 npm 依赖**：只使用项目已有依赖和 Node.js 内置模块
6. **已有依赖**：`yaml`、`p-limit`、`p-retry`、`dotenv`、项目内 `src/` 模块均可直接 import

---

## 三、目录结构

```
test/
  probe/
    probe.js          # 主脚本（CLI 入口）
    state.json        # 自动生成，持久化每个源的测试结果（不提交 git）
    results/          # 自动创建，每次运行的完整报告
      <timestamp>.json
  PROBE_SPEC.md       # 本规格文档（已存在）
```

`package.json` 中需要增加以下脚本：

```json
"probe": "node test/probe/probe.js"
```

`.gitignore` 中追加：

```
test/probe/state.json
test/probe/results/
```

---

## 四、CLI 接口

### 调用格式

```bash
npm run probe <topic-id> [选项]
```

### 参数

| 参数 | 说明 |
|------|------|
| `<topic-id>` | **必填**。对应 `config/topics/<topic-id>.yaml` |
| `--all` | 忽略通过状态，强制重测所有源 |
| `--source <name>` | 只测名称**包含**该字符串的源（模糊匹配，大小写不敏感） |
| `--reset` | 清除该 topic 下所有源的历史状态，然后退出（不运行测试） |
| `--full` | 开启 Phase 2（summarize token 估算），默认只跑 Phase 1 |
| `--timeout <秒>` | 覆盖默认的 per-source 超时（秒），默认见下文 |
| `--pass-ttl <天>` | PASS 状态的有效期（天），默认 3 天，超过后重测 |

### 示例

```bash
npm run probe global-geopolitical-conflicts-test
npm run probe global-geopolitical-conflicts-test --all
npm run probe global-geopolitical-conflicts-test --source "Reuters"
npm run probe global-geopolitical-conflicts-test --reset
npm run probe global-geopolitical-conflicts-test --full
npm run probe global-geopolitical-conflicts-test --timeout 120
```

---

## 五、Phase 1：Fetch Probe

### 5.1 测试结果分类

每个源的测试结果用以下四种状态之一表示：

| 状态 | 条件 | 说明 |
|------|------|------|
| `PASS` | 成功获取 ≥1 篇文章，且无异常 | 下次运行默认跳过（见 pass-ttl） |
| `EMPTY` | adapter 正常返回，但文章数为 0 | 每次都重测 |
| `TIMEOUT` | 超过 per-source 超时时间 | 每次都重测 |
| `ERROR` | 抛出未捕获异常 | 每次都重测 |

### 5.2 默认超时时间

| 源类型 | 默认超时 |
|--------|---------|
| `web` | 120 秒 |
| `rss` | 30 秒 |
| `html` | 60 秒 |
| `api` | 30 秒 |
| `playwright` | 120 秒 |

`--timeout` 参数统一覆盖所有类型的超时时间。

超时使用 `Promise.race` + `setTimeout` reject 实现，不使用 `process.kill`。

### 5.3 如何调用现有 adapter

直接 import 并调用现有 adapter，**绕过** `fetch/index.js` 的并发调度和过滤管线：

```js
// 按 source.type 路由到对应 adapter
import { fetchFromRss } from '../../src/fetch/rss.js'
import { fetchFromWeb } from '../../src/fetch/web.js'
import { fetchFromHtml } from '../../src/fetch/html.js'
import { fetchFromApi } from '../../src/fetch/api.js'
import { fetchFromPlaywright } from '../../src/fetch/playwright.js'

const ADAPTERS = {
  rss: fetchFromRss,
  web: fetchFromWeb,
  html: fetchFromHtml,
  api: fetchFromApi,
  playwright: fetchFromPlaywright,
}
```

调用方式：

```js
const adapter = ADAPTERS[source.type || 'rss']
const items = await adapter(source, { retries: 1 })  // probe 时重试次数设为 1
```

**注意**：
- `retries` 设为 1（不是 0，保留一次重试防止偶发网络抖动，但不要像生产那样重试 3 次）
- 不传 `auditor`（不需要审计日志）
- 不做关键词过滤、时间过滤、去重，直接看 adapter 能不能返回数据

### 5.4 并发控制

各源之间的并发控制：

- 默认并发数：`web` 和 `playwright` 类型为 **1**（串行，防止多个浏览器实例同时启动耗尽资源）；`rss`、`html`、`api` 类型为 **3**
- 使用 `p-limit` 实现，与现有代码风格一致
- 探针的目的是诊断，不追求速度，串行对 web 类型是合理选择

### 5.5 需要记录的信息

每个源测试完成后记录：

```js
{
  name: "Reuters 全球与区域",    // source.name
  type: "web",                   // source.type
  url: "https://...",            // 主 URL（第一个）
  status: "PASS",                // PASS | EMPTY | TIMEOUT | ERROR
  itemCount: 12,                 // 获取到的文章数（TIMEOUT/ERROR 时为 0）
  durationMs: 45230,             // 实际耗时（毫秒）
  timeoutMs: 120000,             // 本次使用的超时限制
  error: null,                   // ERROR 时填错误 message，其他为 null
  sampleTitles: [                // 前 3 篇文章标题（PASS/EMPTY 时），用于人工判断质量
    "Russia launches largest...",
    "Ukraine counteroffensive...",
    "Hamas ceasefire talks..."
  ],
  contentStats: {                // 内容质量统计（PASS 时）
    withContent: 8,              // 有正文（content 字段非空）的文章数
    withoutContent: 4,           // 无正文的文章数
    avgContentLength: 1240       // 平均正文长度（字符数）
  },
  testedAt: "2026-05-16T10:23:45.123Z"
}
```

TIMEOUT 状态时，`durationMs` 记录实际等待的超时时间（即 timeoutMs 本身）。

### 5.6 PASS 判定细化

满足以下**全部**条件才算 PASS：
1. adapter 未抛出异常
2. 未超时
3. 返回数组，且 `items.length >= 1`
4. 至少一篇文章的 `title` 非空

不要求 `content` 非空（有些 RSS 源本来就只有标题+摘要）。

---

## 六、Phase 2：Summarize Token 估算

### 6.1 触发条件

仅在 `--full` 参数时运行，在 Phase 1 完成后执行。

### 6.2 目的

不实际调用 LLM，只估算如果把 Phase 1 获取到的**所有 PASS 源的文章**汇总后，送入 `summarize.js` 的 prompt 会有多长，判断是否有超出模型上下文的风险。

### 6.3 Token 估算方法

使用简单的字符估算，不引入 tiktoken 等额外依赖：

```
估算 token 数 = prompt 总字符数 / 3.5
```

（英文约 4 字符/token，中文约 2 字符/token，混合内容取 3.5 为保守估算）

### 6.4 Prompt 构建方式

模仿 `src/summarize.js` 中的 `buildUserPrompt` 函数，把所有 PASS 源的文章按同样格式拼接：

```
[1] 来源: Reuters 全球与区域
时间: 2026-05-16T10:00:00.000Z
标题: Russia launches...
摘要: <item.summary 的前 500 字符，如果 summary 超过 500 字符则截断>
URL: https://...

[2] ...
```

**重要**：Phase 2 估算时对 `summary` 截断到 500 字符，这是为了反映真实的 `summarize.js` 行为并发现风险。注意：现有 `src/summarize.js` 的 `buildUserPrompt` 对 `item.summary` **没有截断**，这是一个潜在 bug，Phase 2 应该如实估算（不截断）并报告风险。

### 6.5 上下文限制参考值

从环境变量读取模型名称（`process.env.LLM_MODEL`），按以下表格选参考上下文限制：

| 模型名称包含 | 上下文 token 限制 |
|------------|----------------|
| `deepseek` | 65,536 |
| `gpt-4o` | 128,000 |
| `gpt-4` | 8,192 |
| `claude` | 200,000 |
| `qwen` | 32,000 |
| 其他/未知 | 32,000（保守值）|

### 6.6 风险等级

| 估算 token 占上下文限制的比例 | 风险等级 |
|---------------------------|---------|
| < 50% | `OK` |
| 50% ~ 80% | `WARN` |
| > 80% | `RISK` |

### 6.7 Phase 2 输出

```
[Phase 2] Summarize Token 估算
  文章总数: 156 篇（来自 14 个 PASS 源）
  估算 prompt 长度: 312,450 字符
  估算 token 数: ~89,271
  模型上下文限制 (deepseek): 65,536 tokens
  风险等级: RISK ⚠️
  超出限制: ~23,735 tokens
  建议: 减少 maxItems 或对 RSS item.content 添加截断
```

---

## 七、状态持久化

### 7.1 文件位置

`test/probe/state.json`（相对项目根目录）。

### 7.2 文件格式

```json
{
  "version": 1,
  "topics": {
    "global-geopolitical-conflicts-test": {
      "Reuters 全球与区域": {
        "status": "PASS",
        "itemCount": 12,
        "durationMs": 45230,
        "testedAt": "2026-05-16T10:23:45.123Z"
      },
      "Al Jazeera 全球与中东": {
        "status": "TIMEOUT",
        "itemCount": 0,
        "durationMs": 120000,
        "error": "source timeout after 120000ms",
        "testedAt": "2026-05-16T10:25:10.000Z"
      }
    }
  }
}
```

### 7.3 跳过逻辑

满足以下**全部**条件时，跳过该源：
1. `status === "PASS"`
2. `testedAt` 在 `pass-ttl` 天内（默认 3 天）
3. 未传 `--all` 参数

跳过的源在终端显示为灰色的 `[SKIP]` 行，不计入本次运行耗时。

### 7.4 写入时机

每测完一个源立即更新 `state.json`（不是所有源测完再写），确保中途中断时已完成的结果不丢失。

### 7.5 `--reset` 行为

删除 `state.json` 中该 topic 下的所有条目，打印确认信息后退出，不运行测试。

---

## 八、输出格式

### 8.1 终端实时输出

测试进行中，每个源完成时实时打印一行：

```
[1/21] ✓ PASS     Reuters 全球与区域          web    12篇  45.2s
[2/21] ✗ TIMEOUT  Al Jazeera 全球与中东        web    0篇  120.0s
[3/21] ✓ PASS     Al Jazeera RSS 备份         rss    28篇  3.1s
[4/21] - SKIP     Guardian 世界与地区          web    (上次通过于 2026-05-15)
[5/21] ✗ EMPTY    联合国和平与安全              web    0篇  32.4s
[6/21] ✗ ERROR    CFR 全球冲突追踪             web    0篇  8.7s  → 未知来源类型 "undefined"
```

格式要求：
- 序号 `[n/total]` 右对齐
- 状态符号：`✓` 绿色（PASS）、`✗` 红色（FAIL/TIMEOUT/ERROR/EMPTY）、`-` 灰色（SKIP）
- 各列固定宽度对齐（名称列 30 字符、类型列 12 字符）
- TIMEOUT/ERROR 额外打印 `→ <简短原因>`
- 如果终端不支持颜色（`process.stdout.isTTY === false`），去掉颜色码

### 8.2 运行结束后的汇总

```
══════════════════════════════════════════════════════════
Source Probe 汇总 — global-geopolitical-conflicts-test
运行时间: 2026-05-16 10:23:45 → 10:47:12（共 23m 27s）
══════════════════════════════════════════════════════════

结果分布:
  ✓ PASS    9 个源
  ✗ EMPTY   4 个源
  ✗ TIMEOUT 3 个源
  ✗ ERROR   2 个源
  - SKIP    3 个源（本次跳过）

失败源清单:
  TIMEOUT  Al Jazeera 全球与中东      web  120.0s
  TIMEOUT  ReliefWeb 全球人道危机     web  120.0s
  TIMEOUT  ACLED 冲突数据与分析       web  120.0s
  EMPTY    联合国和平与安全            web  32.4s
  EMPTY    欧洲安全与外交             web  28.1s
  EMPTY    美国外交与国防             web  19.3s
  EMPTY    国际危机组织冲突预警        web  41.7s
  ERROR    CFR 全球冲突追踪           web  8.7s  → 未知来源类型 "undefined"
  ERROR    亚太安全与中国周边          web  55.2s → Navigation timeout

通过源内容质量:
  Reuters 全球与区域     12篇  含正文: 8/12  平均长度: 2,140字
  Al Jazeera RSS 备份   28篇  含正文: 0/28  平均长度:  320字
  ...

详细报告: test/probe/results/2026-05-16T102345.json
══════════════════════════════════════════════════════════
```

### 8.3 JSON 结果文件

每次运行在 `test/probe/results/<timestamp>.json` 写入完整报告：

```json
{
  "runAt": "2026-05-16T10:23:45.123Z",
  "topicId": "global-geopolitical-conflicts-test",
  "topicTitle": "全球地缘冲突速报（测试版）",
  "durationMs": 1407123,
  "args": {
    "all": false,
    "source": null,
    "full": false,
    "timeoutOverride": null,
    "passTtlDays": 3
  },
  "summary": {
    "total": 21,
    "tested": 18,
    "skipped": 3,
    "pass": 9,
    "empty": 4,
    "timeout": 3,
    "error": 2
  },
  "results": [
    {
      "name": "Reuters 全球与区域",
      "type": "web",
      "url": "https://www.reuters.com/world/",
      "status": "PASS",
      "itemCount": 12,
      "durationMs": 45230,
      "timeoutMs": 120000,
      "error": null,
      "sampleTitles": [
        "Russia launches largest drone attack on Kyiv",
        "Ukraine seeks more air defense systems",
        "Israel-Hamas ceasefire talks stall"
      ],
      "contentStats": {
        "withContent": 8,
        "withoutContent": 4,
        "avgContentLength": 2140
      },
      "testedAt": "2026-05-16T10:23:45.123Z"
    }
  ],
  "phase2": null
}
```

`phase2` 字段仅在 `--full` 时填充：

```json
"phase2": {
  "totalArticles": 156,
  "passSourceCount": 9,
  "promptChars": 312450,
  "estimatedTokens": 89271,
  "modelContextLimit": 65536,
  "model": "deepseek-chat",
  "riskLevel": "RISK",
  "overLimitBy": 23735
}
```

---

## 九、启动流程（probe.js 主函数逻辑）

```
1. 解析 CLI 参数（使用 process.argv 手动解析，不引入 minimist/commander）
2. 验证 topic-id 是否提供，否则打印用法并退出
3. 加载 .env（使用 dotenv，与现有代码一致）
4. 调用 src/config.js 的 loadTopic(topicId) 加载配置
5. 加载 test/probe/state.json（不存在则视为空状态）
6. 如果 --reset：删除该 topic 状态，打印确认，退出
7. 根据 --source 过滤源列表
8. 根据状态和 pass-ttl 标记哪些源跳过
9. 打印本次运行计划（共 N 个源，跳过 M 个，测试 K 个）
10. 运行 Phase 1：
    a. 按类型分并发池（web/playwright: 1, 其他: 3）
    b. 每个源：Promise.race(adapter(...), timeout)
    c. 完成后立即写 state.json，打印实时行
11. 如果 --full：运行 Phase 2（token 估算）
12. 打印汇总
13. 写 results/<timestamp>.json
14. 退出码：所有被测源均 PASS 则 exit(0)，否则 exit(1)
```

---

## 十、参数解析规范

不引入第三方 CLI 解析库，手动解析 `process.argv.slice(2)`：

```
process.argv 示例: ['global-geopolitical-conflicts-test', '--all', '--timeout', '90']

解析规则:
- 第一个不以 '--' 开头的参数为 topic-id
- '--all'        → args.all = true
- '--reset'      → args.reset = true
- '--full'       → args.full = true
- '--source <v>' → args.source = v（下一个参数）
- '--timeout <v>'→ args.timeout = parseInt(v) * 1000（转为毫秒）
- '--pass-ttl <v>'→ args.passTtlDays = parseInt(v)
```

---

## 十一、关键实现细节与陷阱

### 11.1 `web.js` adapter 启动 Playwright 浏览器

`fetchFromWeb` 内部会调用 `createContext`（在 `src/fetch/web/browser.js`），它会启动一个 Playwright 浏览器上下文。超时后需要确保浏览器上下文被正确关闭，否则会产生僵尸进程。

处理方式：超时后 `Promise.race` reject，adapter 内部的 `finally { await closeContext(context) }` 块**仍会执行**（因为 reject 传播到 adapter 内部，adapter 捕获后在 finally 清理）。探针不需要额外处理，但需要给 `Promise.race` 足够的缓冲时间让 finally 执行完（120s timeout 后可能还有几秒的清理时间，是可接受的）。

### 11.2 CFR 源的配置问题

在 `global-geopolitical-conflicts-test.yaml` 中，CFR 源的配置是：

```yaml
- name: CFR 全球冲突追踪
  type: web
  url: "https://www.cfr.org/global-conflict-tracker"  # 注意：用的是 url，不是 urls
```

`src/config.js` 的 `validateSource` 函数对 `type: web` 同时支持 `url`（单个）和 `urls`（数组）两种格式，两者都是合法的。探针应该直接把 source config 原样传给 adapter，不做任何格式转换。

### 11.3 `state.json` 并发写入

因为 web/playwright 类型是串行（concurrency=1），`state.json` 写入是安全的。但 rss 类型并发为 3，多个 RSS 源可能同时完成。

处理方式：用一个简单的写锁（一个 Promise 链）确保 `state.json` 写入是串行的：

```js
let writeChain = Promise.resolve()
function writeState(state) {
  writeChain = writeChain.then(() =>
    fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf-8')
  )
  return writeChain
}
```

### 11.4 路径解析

探针文件在 `test/probe/probe.js`，使用 `import.meta.url` 获取当前文件路径，然后相对定位到项目根目录：

```js
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../..')  // test/probe/ → 项目根

// 使用示例
const stateFilePath = path.join(__dirname, 'state.json')
const resultsDir = path.join(__dirname, 'results')
```

注意：`src/config.js` 的 `loadTopic` 函数内部已经知道自己在 `src/` 下，用相对路径定位 `config/topics/`，因此探针只需要调用 `loadTopic(topicId)` 即可，不需要手动拼接 YAML 路径。

### 11.5 dotenv 加载

现有代码假设 `.env` 在项目根目录。探针从 `test/probe/probe.js` 运行时，需要显式指定路径：

```js
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
```

这行必须在 import 现有 src/ 模块**之前**执行（因为 LLM 相关模块在加载时就读取 `process.env.LLM_API_KEY`）。

但 ES Module 的 `import` 语句是静态提升的，所以实际上无法在 import 之前执行 dotenv.config()。

**解决方案**：把所有 src/ 模块的 import 改为动态 `import()`，或者用以下模式：

```js
// probe.js 顶部：先同步加载 dotenv（使用动态导入延迟加载适配器）
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(ROOT, '.env') })

// 注意：以下这些模块必须用动态 import，因为它们在模块初始化时读取 process.env
// 放在 main() 函数内部或用 await import() 延迟到 dotenv.config 之后
async function loadAdapters() {
  const { fetchFromRss } = await import('../../src/fetch/rss.js')
  const { fetchFromWeb } = await import('../../src/fetch/web.js')
  const { fetchFromHtml } = await import('../../src/fetch/html.js')
  const { fetchFromApi } = await import('../../src/fetch/api.js')
  const { fetchFromPlaywright } = await import('../../src/fetch/playwright.js')
  const { loadTopic } = await import('../../src/config.js')
  return { fetchFromRss, fetchFromWeb, fetchFromHtml, fetchFromApi, fetchFromPlaywright, loadTopic }
}
```

### 11.6 source 主 URL 的提取

不同类型的 source 配置 URL 字段不同：

```js
function getSourceUrl(source) {
  if (source.url) return source.url
  if (Array.isArray(source.urls) && source.urls.length > 0) {
    const first = source.urls[0]
    return typeof first === 'string' ? first : first.url
  }
  return '(no url)'
}
```

### 11.7 contentStats 计算

```js
function calcContentStats(items) {
  if (!items || items.length === 0) return null
  const withContent = items.filter(i => i.content && i.content.length > 50).length
  const totalLen = items.reduce((sum, i) => sum + (i.content?.length || 0), 0)
  return {
    withContent,
    withoutContent: items.length - withContent,
    avgContentLength: withContent > 0 ? Math.round(totalLen / items.length) : 0,
  }
}
```

---

## 十二、不需要实现的功能

以下功能**明确不在本次范围内**：

- 不实现 `--help` 的详细帮助文档（打印简单用法即可）
- 不实现进度条动画（逐行打印结果即可）
- 不实现 HTML 报告（纯 JSON + 终端输出）
- 不实现定时运行/cron（探针手动触发）
- 不对现有 `src/` 代码做任何优化或修改（发现问题只记录，不修复）
- 不实现 source 配置验证（`loadTopic` 已经做了）

---

## 十三、验收标准

实现完成后，以下命令应该能正常运行：

```bash
# 基础运行
npm run probe global-geopolitical-conflicts-test

# 强制重测所有源
npm run probe global-geopolitical-conflicts-test --all

# 只测指定源
npm run probe global-geopolitical-conflicts-test --source "Reuters"

# 重置状态
npm run probe global-geopolitical-conflicts-test --reset

# 完整运行（含 token 估算）
npm run probe global-geopolitical-conflicts-test --full

# 自定义超时（60秒）
npm run probe global-geopolitical-conflicts-test --timeout 60
```

预期行为：
1. 不修改 `src/` 下任何现有文件
2. `test/probe/state.json` 在运行过程中实时更新
3. `test/probe/results/` 下每次运行生成一个新的 JSON 文件
4. 第二次运行时，PASS 的源被跳过，终端显示 `[SKIP]`
5. `--reset` 后，第三次运行时所有源重新测试
6. 中途 Ctrl+C 中断，已完成的源状态已持久化到 `state.json`
