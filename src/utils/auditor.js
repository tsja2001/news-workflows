/**
 * ============================================================
 * 审计日志模块 — 每次抓取生成完整 JSONL 审计日志
 * ============================================================
 *
 * 每条事件以统一信封追加写入 JSONL 文件。
 * 运行结束时生成 summary.json 汇总文件。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** JSONL 单条事件最大字节数 */
const MAX_EVENT_BYTES = 100 * 1024

/** 用于生成 5 位随机字母 */
function randomAlpha(len = 5) {
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]
  }
  return s
}

/** 生成 runId */
function generateRunId() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '')
  return `${date}-${time}-${randomAlpha()}`
}

/** 日期字符串 YYYY-MM-DD */
function dateStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 安全序列化：移除循环引用、限制大小
 */
function safeStringify(obj) {
  try {
    const seen = new WeakSet()
    const json = JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    })
    if (json.length > MAX_EVENT_BYTES) {
      return JSON.stringify({ _truncated: true, _originalBytes: json.length })
    }
    return json
  } catch {
    return JSON.stringify({ _serializeError: true })
  }
}

/**
 * 从 .env 读取价格配置
 */
function getPriceConfig() {
  return {
    inputPrice: parseFloat(process.env.LLM_INPUT_PRICE_PER_1M_TOKENS || '0.14'),
    outputPrice: parseFloat(process.env.LLM_OUTPUT_PRICE_PER_1M_TOKENS || '0.28'),
  }
}

/**
 * 估算成本（元）
 */
function estimateCost(inputTokens, outputTokens, priceConfig) {
  const inputCost = (inputTokens / 1_000_000) * priceConfig.inputPrice
  const outputCost = (outputTokens / 1_000_000) * priceConfig.outputPrice
  return inputCost + outputCost
}

/**
 * 创建审计日志记录器
 *
 * @param {object} runContext
 * @param {string} runContext.topic - 主题 ID
 * @param {string} [runContext.logDir] - 日志目录根路径
 * @returns {object} auditor 实例
 */
export function createAuditor(runContext) {
  const topic = runContext.topic
  const runId = generateRunId()
  const logDir = runContext.logDir || path.join(__dirname, '..', '..', 'logs', 'audit')
  const dateDir = path.join(logDir, dateStr())

  // 确保目录存在
  fs.mkdirSync(dateDir, { recursive: true })

  const jsonlPath = path.join(dateDir, `${topic}-${runId}.jsonl`)
  const summaryPath = path.join(dateDir, `${topic}-${runId}.summary.json`)

  let finalized = false
  let eventCount = 0

  /**
   * 写入一条审计事件
   * @param {string} eventType - 事件类型
   * @param {object} data - 事件数据
   * @param {object} [extra] - 额外的信封字段（如 source）
   */
  function event(eventType, data, extra = {}) {
    if (finalized) return

    const envelope = {
      ts: new Date().toISOString(),
      topic,
      runId,
      source: extra.source || '',
      sourceType: extra.sourceType || '',
      event: eventType,
      data,
    }

    const line = safeStringify(envelope)
    try {
      fs.appendFileSync(jsonlPath, line + '\n', 'utf-8')
      eventCount++
    } catch (err) {
      // 写入失败静默忽略，不中断主流程
    }
  }

  /**
   * 创建带 source 上下文的子 auditor
   * @param {string} source - 源名称
   * @param {string} sourceType - 源类型
   * @returns {object} 子 auditor
   */
  function scoped(source, sourceType) {
    return {
      event: (eventType, data) => event(eventType, data, { source, sourceType }),
      scoped: () => { throw new Error('子 auditor 不能再 scoped') },
      get runId() { return runId },
      get jsonlPath() { return jsonlPath },
    }
  }

  /**
   * 完成审计：生成 summary 并返回路径
   * @returns {{ jsonlPath: string, summaryPath: string, runId: string }}
   */
  function finalize() {
    if (finalized) return { jsonlPath, summaryPath, runId }
    finalized = true

    // 扫描 jsonl 生成 summary
    const summary = buildSummary(jsonlPath, topic, runId)

    try {
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
    } catch {
      // ignore
    }

    return { jsonlPath, summaryPath, runId }
  }

  return {
    event,
    scoped,
    finalize,
    get runId() { return runId },
    get jsonlPath() { return jsonlPath },
    get summaryPath() { return summaryPath },
    get eventCount() { return eventCount },
  }
}

/**
 * 从 JSONL 文件构建 summary
 */
function buildSummary(jsonlPath, topic, runId) {
  const summary = {
    topic,
    runId,
    startedAt: '',
    completedAt: '',
    durationMs: 0,
    sources: [],
    pipeline: {},
    llm: {},
    totals: { tokensUsedAll: 0, estimatedCost: '约 ¥0.00' },
  }

  const priceConfig = getPriceConfig()
  const sourceMap = new Map() // key: sourceName → stats
  let totalInputTokens = 0
  let totalOutputTokens = 0

  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')

    for (const line of lines) {
      if (!line) continue
      let evt
      try { evt = JSON.parse(line) } catch { continue }

      const { event: eventType, data = {}, source, sourceType, ts } = evt

      // 时间范围
      if (!summary.startedAt) summary.startedAt = ts
      summary.completedAt = ts

      // 按 source 聚合
      let src = sourceMap.get(source)
      if (!src && source) {
        src = { name: source, type: sourceType, urls: [], candidatesTotal: 0, candidatesAfterDedup: 0,
          detailsFetched: 0, detailsSucceeded: 0, detailsFailed: 0,
          tokens: { input: 0, output: 0 }, durationMs: 0, status: 'ok' }
        sourceMap.set(source, src)
      }

      switch (eventType) {
        case 'source_started':
          if (src) { src.urls = data.urls || []; src.maxArticles = data.maxArticles }
          break
        case 'list_extracted':
          if (src) { src.candidatesTotal += (data.candidates?.length || data.count || 0) }
          if (data.tokens) {
            if (src) { src.tokens.input += data.tokens.input || 0; src.tokens.output += data.tokens.output || 0 }
            totalInputTokens += data.tokens.input || 0
            totalOutputTokens += data.tokens.output || 0
          }
          break
        case 'candidates_filtered':
          if (src) { src.candidatesAfterDedup = data.after || 0 }
          break
        case 'detail_extracted':
          if (src) src.detailsSucceeded++
          break
        case 'detail_failed':
          if (src) src.detailsFailed++
          break
        case 'source_completed':
          if (src) {
            src.detailsFetched = data.detailsFetched || 0
            src.detailsSucceeded = data.detailsSucceeded || src.detailsSucceeded
            src.detailsFailed = data.detailsFailed || src.detailsFailed
            src.durationMs = data.durationMs || 0
          }
          break
        case 'source_failed':
          if (src) { src.status = 'failed'; src.durationMs = data.durationMs || 0 }
          break
        case 'pipeline_filter':
          if (!summary.pipeline[data.stage]) {
            summary.pipeline[data.stage] = { before: data.before, after: data.after }
          }
          break
        case 'llm_input_prepared':
          summary.llm.itemCount = data.itemCount || 0
          break
        case 'llm_response_received':
          if (data.tokens) {
            totalInputTokens += data.tokens.input || 0
            totalOutputTokens += data.tokens.output || 0
          }
          summary.llm.model = data.model || summary.llm.model || ''
          summary.llm.durationMs = data.durationMs || 0
          break
        case 'run_completed':
          summary.durationMs = data.durationMs || 0
          break
      }
    }
  } catch {
    // JSONL 读取失败
  }

  summary.sources = Array.from(sourceMap.values())
  summary.totals = {
    tokensUsedAll: totalInputTokens + totalOutputTokens,
    estimatedCost: `约 ¥${estimateCost(totalInputTokens, totalOutputTokens, priceConfig).toFixed(2)}`,
  }
  summary.llm.inputTokens = totalInputTokens
  summary.llm.outputTokens = totalOutputTokens

  if (summary.startedAt && summary.completedAt) {
    summary.durationMs = new Date(summary.completedAt) - new Date(summary.startedAt)
  }

  return summary
}
