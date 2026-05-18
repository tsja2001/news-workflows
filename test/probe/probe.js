/**
 * ============================================================
 * Source Probe — 新闻源探针工具
 * ============================================================
 *
 * 针对每个配置的新闻源单独运行真实 adapter，记录成功/失败/超时。
 * 支持状态持久化、跳过已通过源、summarize token 估算。
 *
 * 用法：
 *   npm run probe <topic-id> [--all] [--source <name>] [--reset] [--full] [--timeout <秒>] [--pass-ttl <天>]
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

// —— 路径解析 ——
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../..')

// —— 在 import src/ 模块前加载 .env ——
dotenv.config({ path: path.join(ROOT, '.env') })

// —— 常量 ——
const STATE_FILE = path.join(__dirname, 'state.json')
const RESULTS_DIR = path.join(__dirname, 'results')

/** 各类型默认超时（毫秒） */
const DEFAULT_TIMEOUTS = {
  web: 120_000,
  rss: 30_000,
  html: 60_000,
  api: 30_000,
  playwright: 120_000,
}

/** 各类型并发上限 */
const PROBE_CONCURRENCY = {
  web: 1,
  playwright: 1,
  rss: 3,
  html: 3,
  api: 3,
  default: 3,
}

/** 默认 pass-ttl（天） */
const DEFAULT_PASS_TTL_DAYS = 3

// —— 辅助函数 ——

/**
 * 从 source 配置中提取主 URL
 * @param {object} source
 * @returns {string}
 */
function getSourceUrl(source) {
  if (source.url) return source.url
  if (Array.isArray(source.urls) && source.urls.length > 0) {
    const first = source.urls[0]
    return typeof first === 'string' ? first : first.url
  }
  return '(no url)'
}

/**
 * 计算内容质量统计
 * @param {Array} items
 * @returns {object|null}
 */
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

/**
 * 终端 ANSI 颜色包装（仅在 TTY 时启用）
 */
const color = process.stdout.isTTY
function green(s) { return color ? `\x1b[32m${s}\x1b[0m` : s }
function red(s) { return color ? `\x1b[31m${s}\x1b[0m` : s }
function gray(s) { return color ? `\x1b[90m${s}\x1b[0m` : s }
function bold(s) { return color ? `\x1b[1m${s}\x1b[0m` : s }
function yellow(s) { return color ? `\x1b[33m${s}\x1b[0m` : s }

/**
 * 右对齐数字
 */
function padR(s, n) { return String(s).padStart(n) }

/**
 * 固定宽度截断或补空
 */
function fixed(str, len) {
  const s = String(str)
  if (s.length > len) return s.slice(0, len - 1) + '…'
  return s.padEnd(len)
}

/**
 * 格式化毫秒为可读时间
 */
function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

/**
 * 格式化数字，千位加分节号
 */
function formatNum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// —— 状态文件管理 ——

/** 写锁 Promise 链，确保串行写入 */
let writeChain = Promise.resolve()

/**
 * 加载 state.json
 * @returns {Promise<object>}
 */
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { version: 1, topics: {} }
  }
}

/**
 * 串行写入 state.json
 * @param {object} state
 */
async function writeState(state) {
  writeChain = writeChain.then(() =>
    fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  )
  return writeChain
}

// —— CLI 参数解析 ——

/**
 * 解析命令行参数
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {object}
 */
function parseArgs(argv) {
  const args = {
    topicId: null,
    all: false,
    reset: false,
    full: false,
    source: null,
    timeoutMs: null,
    passTtlDays: DEFAULT_PASS_TTL_DAYS,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (!arg.startsWith('--') && args.topicId === null) {
      args.topicId = arg
    } else if (arg === '--all') {
      args.all = true
    } else if (arg === '--reset') {
      args.reset = true
    } else if (arg === '--full') {
      args.full = true
    } else if (arg === '--source') {
      args.source = argv[++i] || ''
    } else if (arg === '--timeout') {
      args.timeoutMs = parseInt(argv[++i], 10) * 1000
    } else if (arg === '--pass-ttl') {
      args.passTtlDays = parseInt(argv[++i], 10)
    }
    i++
  }

  return args
}

// —— Phase 2：Token 估算 ——

/**
 * 模仿 summarize.js buildUserPrompt 拼接所有文章
 * 注意：对 summary 不截断，如实反映可能的超限风险
 *
 * @param {Array} items - 所有 PASS 源的文章
 * @param {object} config - 主题配置
 * @returns {string}
 */
function buildPromptEstimate(items, config) {
  const itemsText = items.map((item, i) =>
    `[${i + 1}] 来源: ${item.source}
时间: ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary || ''}
URL: ${item.url || ''}`
  ).join('\n\n')

  return `请以主编身份，基于下面 ${items.length} 条关于"${config.title}"的新闻，撰写一份有深度的编辑简报。

返回 JSON 格式:
{
  "overview": "...",
  "keyDevelopments": [...],
  "context": "...",
  "timeline": [...],
  "signals": [...],
  "risks": [...],
  "unknowns": [...],
  "editorReview": "..."
}

新闻素材:

${itemsText}`
}

/**
 * 根据模型名推断上下文 token 限制
 * @param {string} modelName
 * @returns {number}
 */
function getContextLimit(modelName) {
  const m = (modelName || '').toLowerCase()
  if (m.includes('deepseek')) return 65_536
  if (m.includes('gpt-4o')) return 128_000
  if (m.includes('gpt-4')) return 8_192
  if (m.includes('claude')) return 200_000
  if (m.includes('qwen')) return 32_000
  return 32_000
}

/**
 * 评估 token 风险等级
 * @param {number} estimatedTokens
 * @param {number} contextLimit
 * @returns {string}
 */
function getRiskLevel(estimatedTokens, contextLimit) {
  const ratio = estimatedTokens / contextLimit
  if (ratio < 0.5) return 'OK'
  if (ratio <= 0.8) return 'WARN'
  return 'RISK'
}

/**
 * 运行 Phase 2：token 估算
 * @param {object[]} passResults - PASS 源的测试结果
 * @param {object} config - 主题配置
 * @returns {object}
 */
function runPhase2(passResults, config) {
  const allItems = []
  for (const r of passResults) {
    if (r.items) {
      for (const item of r.items) {
        allItems.push(item)
      }
    }
  }

  const prompt = buildPromptEstimate(allItems, config)
  const promptChars = prompt.length
  const estimatedTokens = Math.round(promptChars / 3.5)
  const model = process.env.LLM_MODEL || 'unknown'
  const contextLimit = getContextLimit(model)
  const riskLevel = getRiskLevel(estimatedTokens, contextLimit)
  const overLimitBy = Math.max(0, estimatedTokens - contextLimit)

  return {
    totalArticles: allItems.length,
    passSourceCount: passResults.length,
    promptChars,
    estimatedTokens,
    modelContextLimit: contextLimit,
    model,
    riskLevel,
    overLimitBy,
  }
}

// —— 主逻辑 ——

/**
 * 入口
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))

  // 验证必填参数
  if (!args.topicId) {
    console.error('用法: npm run probe <topic-id> [--all] [--source <name>] [--reset] [--full] [--timeout <秒>] [--pass-ttl <天>]')
    process.exit(1)
  }

  // 加载状态文件
  const state = await loadState()
  const topicState = state.topics[args.topicId] || {}

  // --reset：清除该 topic 状态后退出
  if (args.reset) {
    delete state.topics[args.topicId]
    await writeState(state)
    console.log(`已清除 ${args.topicId} 的所有探针状态`)
    process.exit(0)
  }

  // 动态导入 src 模块（dotenv 已加载，现在可安全 import）
  const { loadTopic } = await import('../../src/config.js')
  const { fetchFromRss } = await import('../../src/fetch/rss.js')
  const { fetchFromWeb } = await import('../../src/fetch/web.js')
  const { fetchFromHtml } = await import('../../src/fetch/html.js')
  const { fetchFromApi } = await import('../../src/fetch/api.js')
  const { fetchFromPlaywright } = await import('../../src/fetch/playwright.js')
  const pLimitModule = await import('p-limit')
  const pLimit = pLimitModule.default

  const ADAPTERS = {
    rss: fetchFromRss,
    web: fetchFromWeb,
    html: fetchFromHtml,
    api: fetchFromApi,
    playwright: fetchFromPlaywright,
  }

  // 加载主题配置
  const config = await loadTopic(args.topicId)

  // 过滤源列表
  let sources = config.sources
  if (args.source) {
    const q = args.source.toLowerCase()
    sources = sources.filter(s => (s.name || '').toLowerCase().includes(q))
    if (sources.length === 0) {
      console.error(`没有名称包含 "${args.source}" 的源`)
      process.exit(1)
    }
  }

  // 标记跳过和待测
  const now = new Date()
  const passTtlMs = args.passTtlDays * 24 * 60 * 60 * 1000
  const toSkip = []
  const toTest = []

  for (const s of sources) {
    const existing = topicState[s.name]
    if (
      !args.all &&
      existing &&
      existing.status === 'PASS' &&
      new Date(existing.testedAt).getTime() + passTtlMs > now.getTime()
    ) {
      toSkip.push({ source: s, state: existing })
    } else {
      toTest.push(s)
    }
  }

  // 打印运行计划
  const total = sources.length
  console.log(`\n${bold('Source Probe')} — ${config.title}`)
  console.log(`共 ${total} 个源，跳过 ${toSkip.length} 个，测试 ${toTest.length} 个`)
  if (args.full) console.log(`Phase 2 (token 估算): 启用`)
  console.log()

  const runStart = new Date().toISOString()
  const runStartMs = Date.now()

  // —— Phase 1 ——
  const results = []

  // 按类型分并发池
  function getPool(type) {
    const n = PROBE_CONCURRENCY[type] ?? PROBE_CONCURRENCY.default
    // 按 type 缓存 pool
    if (!getPool._pools) getPool._pools = {}
    if (!getPool._pools[type]) getPool._pools[type] = pLimit(n)
    return getPool._pools[type]
  }

  let testedCount = 0

  // 处理已跳过的源（先打印 SKIP 行）
  for (let i = 0; i < toSkip.length; i++) {
    const { source, state: st } = toSkip[i]
    const num = padR(i + 1, String(total).length)
    const statusLabel = gray(`- SKIP`)
    const nameCol = fixed(source.name || '(unnamed)', 30)
    const typeCol = fixed(source.type || 'rss', 12)
    const testedDate = new Date(st.testedAt).toISOString().slice(0, 10)
    console.log(`[${num}/${total}] ${statusLabel}  ${gray(nameCol)} ${gray(typeCol)} ${gray(`(上次通过于 ${testedDate})`)}`)
  }

  const skipCount = toSkip.length

  // 创建所有测试任务
  const tasks = toTest.map((source, idx) => {
    const globalIdx = skipCount + idx
    const type = source.type || 'rss'
    const pool = getPool(type)
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUTS[type] ?? 60_000

    return pool(async () => {
      const startMs = Date.now()
      const num = padR(globalIdx + 1, String(total).length)
      let status, itemCount, errorMsg, items, durationMs

      const adapter = ADAPTERS[type]
      if (!adapter) {
        status = 'ERROR'
        itemCount = 0
        errorMsg = `未知来源类型 "${type}"`
        durationMs = Date.now() - startMs

        const statusLabel = red('✗ ERROR')
        const nameCol = fixed(source.name || '(unnamed)', 30)
        const typeCol = fixed(type, 12)
        console.log(`[${num}/${total}] ${statusLabel}  ${red(nameCol)} ${red(typeCol)} ${padR('0篇', 6)} ${fixed(formatMs(durationMs), 8)} → ${errorMsg}`)
        return { source, status, itemCount, durationMs, timeoutMs, error: errorMsg, sampleTitles: [], contentStats: null, items: [], testedAt: new Date().toISOString() }
      }

      try {
        // Promise.race 实现超时
        const adapterPromise = adapter(source, { retries: 1 })
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`source timeout after ${timeoutMs}ms`)), timeoutMs)
        )

        items = await Promise.race([adapterPromise, timeoutPromise])
        durationMs = Date.now() - startMs

        if (!Array.isArray(items) || items.length === 0) {
          status = 'EMPTY'
          itemCount = 0
          errorMsg = null
        } else if (!items.some(i => i.title)) {
          // 至少一篇有 title
          status = 'EMPTY'
          itemCount = items.length
          errorMsg = null
        } else {
          status = 'PASS'
          itemCount = items.length
          errorMsg = null
        }
      } catch (err) {
        durationMs = Date.now() - startMs
        errorMsg = err.message || String(err)
        if (errorMsg.includes('source timeout after')) {
          status = 'TIMEOUT'
          durationMs = timeoutMs
        } else {
          status = 'ERROR'
        }
        itemCount = 0
        items = []
      }

      // 构建结果
      const sampleTitles = (items || []).slice(0, 3).map(i => i.title || '(无标题)')
      const contentStats = status === 'PASS' ? calcContentStats(items) : null
      const testedAt = new Date().toISOString()

      const result = {
        name: source.name || '(unnamed)',
        type,
        url: getSourceUrl(source),
        status,
        itemCount,
        durationMs,
        timeoutMs,
        error: errorMsg,
        sampleTitles,
        contentStats,
        items: status === 'PASS' ? items : [],
        testedAt,
      }

      // 更新状态文件
      state.topics[args.topicId] = state.topics[args.topicId] || {}
      state.topics[args.topicId][source.name] = {
        status,
        itemCount,
        durationMs,
        testedAt,
      }
      await writeState(state)

      // 实时打印
      let statusSymbol, statusColor
      switch (status) {
        case 'PASS':
          statusSymbol = green('✓ PASS')
          statusColor = green
          break
        case 'EMPTY':
          statusSymbol = red('✗ EMPTY')
          statusColor = red
          break
        case 'TIMEOUT':
          statusSymbol = red('✗ TIMEOUT')
          statusColor = red
          break
        case 'ERROR':
          statusSymbol = red('✗ ERROR')
          statusColor = red
          break
        default:
          statusSymbol = status
          statusColor = (s) => s
      }

      const nameCol = fixed(source.name || '(unnamed)', 30)
      const typeCol = fixed(type, 12)
      const countCol = padR(`${itemCount}篇`, 6)
      const timeCol = fixed(formatMs(durationMs), 8)
      let line = `[${num}/${total}] ${statusSymbol}  ${statusColor(nameCol)} ${statusColor(typeCol)} ${statusColor(countCol)} ${statusColor(timeCol)}`
      if (errorMsg && (status === 'TIMEOUT' || status === 'ERROR')) {
        const shortErr = errorMsg.length > 50 ? errorMsg.slice(0, 47) + '...' : errorMsg
        line += ` → ${shortErr}`
      }

      console.log(line)
      testedCount++
      return result
    })
  })

  // 等待所有测试完成
  const testedResults = await Promise.all(tasks)

  // 合并结果：跳过的源也加入 results 数组（但不含详细数据）
  for (const { source, state: st } of toSkip) {
    results.push({
      name: source.name || '(unnamed)',
      type: source.type || 'rss',
      url: getSourceUrl(source),
      status: 'SKIP',
      itemCount: 0,
      durationMs: 0,
      timeoutMs: 0,
      error: null,
      sampleTitles: [],
      contentStats: null,
      items: [],
      testedAt: st.testedAt,
    })
  }
  results.push(...testedResults)

  // 统计
  const summary = {
    total,
    tested: toTest.length,
    skipped: toSkip.length,
    pass: testedResults.filter(r => r.status === 'PASS').length,
    empty: testedResults.filter(r => r.status === 'EMPTY').length,
    timeout: testedResults.filter(r => r.status === 'TIMEOUT').length,
    error: testedResults.filter(r => r.status === 'ERROR').length,
  }

  // —— Phase 2 ——
  let phase2 = null
  if (args.full) {
    const passResults = testedResults.filter(r => r.status === 'PASS' && r.items.length > 0)
    if (passResults.length > 0) {
      phase2 = runPhase2(passResults, config)
    }
  }

  const runEndMs = Date.now()
  const totalDurationMs = runEndMs - runStartMs

  // —— 汇总输出 ——
  const sep = '══════════════════════════════════════════════════════════'
  const runEnd = new Date().toISOString().replace('T', ' ').slice(0, 19)

  console.log(`\n${sep}`)
  console.log(`Source Probe 汇总 — ${args.topicId}`)
  console.log(`运行时间: ${runStart.replace('T', ' ').slice(0, 19)} → ${runEnd}（共 ${formatMs(totalDurationMs)}）`)
  console.log(sep)

  console.log(`\n结果分布:`)
  if (summary.pass > 0) console.log(`  ${green('✓ PASS')}    ${summary.pass} 个源`)
  if (summary.empty > 0) console.log(`  ${red('✗ EMPTY')}   ${summary.empty} 个源`)
  if (summary.timeout > 0) console.log(`  ${red('✗ TIMEOUT')} ${summary.timeout} 个源`)
  if (summary.error > 0) console.log(`  ${red('✗ ERROR')}   ${summary.error} 个源`)
  if (summary.skipped > 0) console.log(`  ${gray('- SKIP')}    ${summary.skipped} 个源（本次跳过）`)

  // 失败源清单
  const failures = testedResults.filter(r => r.status !== 'PASS')
  if (failures.length > 0) {
    console.log(`\n失败源清单:`)
    for (const f of failures) {
      const statusLabel = fixed(f.status, 10)
      const nameCol = fixed(f.name, 30)
      const typeCol = fixed(f.type, 12)
      const timeCol = fixed(formatMs(f.durationMs), 8)
      let line = `  ${statusLabel} ${nameCol} ${typeCol} ${timeCol}`
      if (f.error) {
        const shortErr = f.error.length > 40 ? f.error.slice(0, 37) + '...' : f.error
        line += ` → ${shortErr}`
      }
      console.log(red(line))
    }
  }

  // 通过源内容质量
  const passResults = testedResults.filter(r => r.status === 'PASS' && r.contentStats)
  if (passResults.length > 0) {
    console.log(`\n通过源内容质量:`)
    for (const r of passResults) {
      const nameCol = fixed(r.name, 30)
      const countCol = padR(`${r.itemCount}篇`, 4)
      const stats = r.contentStats
      const contentRatio = `${stats.withContent}/${stats.withoutContent + stats.withContent}`
      const avgLen = `${formatNum(stats.avgContentLength)}字`
      console.log(`  ${nameCol} ${countCol}  含正文: ${contentRatio}  平均长度: ${padR(avgLen, 8)}`)
    }
  }

  // Phase 2 输出
  if (phase2) {
    console.log(`\n[Phase 2] Summarize Token 估算`)
    console.log(`  文章总数: ${phase2.totalArticles} 篇（来自 ${phase2.passSourceCount} 个 PASS 源）`)
    console.log(`  估算 prompt 长度: ${formatNum(phase2.promptChars)} 字符`)
    console.log(`  估算 token 数: ~${formatNum(phase2.estimatedTokens)}`)
    console.log(`  模型上下文限制 (${phase2.model}): ${formatNum(phase2.modelContextLimit)} tokens`)

    let riskLabel
    switch (phase2.riskLevel) {
      case 'OK':
        riskLabel = green(`风险等级: OK`)
        break
      case 'WARN':
        riskLabel = yellow(`风险等级: WARN`)
        break
      case 'RISK':
        riskLabel = red(`风险等级: RISK ⚠️`)
        break
      default:
        riskLabel = `风险等级: ${phase2.riskLevel}`
    }
    console.log(`  ${riskLabel}`)

    if (phase2.overLimitBy > 0) {
      console.log(`  超出限制: ~${formatNum(phase2.overLimitBy)} tokens`)
      console.log(`  建议: 减少 maxItems 或对 RSS item.content 添加截断`)
    }
  }

  // 写 JSON 结果文件
  await fs.mkdir(RESULTS_DIR, { recursive: true })
  const ts = runStart.slice(0, 19).replace(/:/g, '')
  const resultPath = path.join(RESULTS_DIR, `${ts}.json`)

  const report = {
    runAt: runStart,
    topicId: args.topicId,
    topicTitle: config.title,
    durationMs: totalDurationMs,
    args: {
      all: args.all,
      source: args.source,
      full: args.full,
      timeoutOverride: args.timeoutMs,
      passTtlDays: args.passTtlDays,
    },
    summary,
    results: results.map(r => ({
      name: r.name,
      type: r.type,
      url: r.url,
      status: r.status,
      itemCount: r.itemCount,
      durationMs: r.durationMs,
      timeoutMs: r.timeoutMs,
      error: r.error,
      sampleTitles: r.sampleTitles,
      contentStats: r.contentStats,
      testedAt: r.testedAt,
    })),
    phase2,
  }

  await fs.writeFile(resultPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log(`\n详细报告: ${resultPath}`)
  console.log(sep + '\n')

  // 退出码：所有被测源 PASS 则 0，否则 1
  const allPassed = testedResults.every(r => r.status === 'PASS')
  process.exit(allPassed ? 0 : 1)
}

main().catch(err => {
  console.error('探针运行失败:', err)
  process.exit(1)
})
