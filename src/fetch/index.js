/**
 * ============================================================
 * 抓取调度器 — 根据 source.type 路由到对应 adapter
 * ============================================================
 *
 * 职责：
 *   1. 遍历所有 source，按 type 路由到对应 adapter
 *   2. 按 type 分类的并发池（rss 轻量可高并发，web 重用严格控制）
 *   3. 单个 adapter 失败不影响其他 source
 *   4. 全局源超时兜底
 *   5. 调度日志：实时显示排队/完成进度
 *   6. 汇总后统一走过滤管线
 */

import pLimit from 'p-limit'
import { createLogger } from '../utils/logger.js'
import { fetchFromRss } from './rss.js'
import { fetchFromHtml } from './html.js'
import { fetchFromApi } from './api.js'
import { fetchFromPlaywright } from './playwright.js'
import { fetchFromWeb } from './web.js'
import { applyFilters, sortAndTruncate } from './common.js'

/** 适配器注册表：source.type → fetch 函数 */
export const ADAPTERS = {
  rss: fetchFromRss,
  html: fetchFromHtml,
  api: fetchFromApi,
  playwright: fetchFromPlaywright,
  web: fetchFromWeb,
}

/** 各 type 默认并发上限 */
const DEFAULT_CONCURRENCY = {
  rss: 8,
  html: 5,
  api: 5,
  playwright: 2,
  web: 2,
  default: 5,
}

/**
 * 创建按 type 分类的并发池 Map
 *
 * @param {number|object} concurrencyConfig - 老格式为数字，新格式为 { rss: N, web: N, ... }
 * @returns {object} Proxy，通过 pools[type] 访问对应 p-limit
 */
function createPoolMap(concurrencyConfig) {
  if (typeof concurrencyConfig === 'number') {
    const limit = pLimit(concurrencyConfig)
    return new Proxy({}, { get: () => limit })
  }

  // 未配置时走各 type 默认并发
  const config = concurrencyConfig || {}
  const pools = {}
  return new Proxy(pools, {
    get(target, type) {
      if (!target[type]) {
        const n = config[type] ?? config.default ?? DEFAULT_CONCURRENCY.default
        target[type] = pLimit(n)
      }
      return target[type]
    },
  })
}

/**
 * 并发拉取所有源并过滤
 *
 * @param {object[]} sources - yaml 里的 sources 数组
 * @param {object} filterConfig - yaml 里的 filter 配置（含 runtime）
 * @param {object} [options]
 * @param {Set<string>} [options.seenUrls] - 历史已见过的 URL 集合
 * @param {boolean} [options.noDedup] - 跳过 URL 去重（测试用）
 * @param {object} [options.auditor] - 审计日志记录器
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchAll(sources, filterConfig, options = {}) {
  const slog = createLogger('scheduler')
  const runtime = filterConfig.runtime || {}
  const sourceTimeoutMs = runtime.sourceTimeoutMs || 0
  const retries = runtime.retries ?? 3
  const auditor = options.auditor

  // —— 并发池 ——
  const concurrencyConfig = runtime.concurrency
  const pools = createPoolMap(concurrencyConfig)

  // 类型分布统计
  const typeCounts = {}
  for (const s of sources) {
    const t = s.type || 'rss'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  }

  slog.info(`开始抓取 ${sources.length} 个源`, {
    web: typeCounts.web || 0,
    rss: typeCounts.rss || 0,
    html: typeCounts.html || 0,
    api: typeCounts.api || 0,
    playwright: typeCounts.playwright || 0,
  })

  if (typeof concurrencyConfig === 'object') {
    slog.info('并发配置', concurrencyConfig)
  } else {
    slog.info('并发上限', { concurrency: concurrencyConfig || DEFAULT_CONCURRENCY.default })
  }

  const startTime = Date.now()
  let completed = 0
  let failed = 0
  const failures = []

  const results = await Promise.all(
    sources.map((s, idx) => {
      const type = s.type || 'rss'
      const pool = pools[type]
      const name = s.name || s.url || `source-${idx}`

      return pool(async () => {
        const i = idx + 1
        slog.step(`${type}/${name}`, { progress: `${i}/${sources.length}` })

        const adapter = ADAPTERS[type]
        if (!adapter) {
          slog.error(`未知来源类型: "${type}"，跳过 ${name}`)
          failed++
          failures.push(`${type}/${name}: 未知来源类型 "${type}"`)
          completed++
          return []
        }

        const start = Date.now()
        let task

        // 为该 source 创建 scoped auditor
        const srcAuditor = auditor ? auditor.scoped(name, type) : null
        const adapterOpts = { retries, auditor: srcAuditor }

        // 全局源超时
        if (sourceTimeoutMs > 0) {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`source timeout after ${sourceTimeoutMs}ms`)),
              sourceTimeoutMs)
          )
          task = Promise.race([adapter(s, adapterOpts), timeoutPromise])
        } else {
          task = adapter(s, adapterOpts)
        }

        try {
          const items = await task
          const ms = Date.now() - start
          slog.success(`${type}/${name}`, { items: items.length, ms })
          // 标记 per-source 选项
          if (s.skipKeywordFilter) {
            for (const item of items) item._skipKeywordFilter = true
          }
          completed++
          return items
        } catch (err) {
          const ms = Date.now() - start
          slog.error(`${type}/${name} 失败`, { ms, reason: err.message })
          failed++
          failures.push(`${type}/${name}: ${err.message}`)
          completed++
          return []
        }
      })
    })
  )

  const totalMs = Date.now() - startTime
  slog.success(`全部完成`, {
    sources: `${completed - failed}/${completed}`,
    failed,
    ms: totalMs,
  })

  if (failures.length > 0) {
    slog.warn('失败的源', { urls: failures.map(f => f.split(':')[0]).join(', ') })
    for (const f of failures) {
      console.error(`  - ${f}`)
    }
  }

  const allItems = results.flat()

  // 统一过滤管线
  let filtered = applyFilters(allItems, filterConfig, options.seenUrls, { noDedup: options.noDedup, auditor })

  // 排序 + 截断
  const beforeTruncate = filtered.length
  filtered = sortAndTruncate(filtered, filterConfig.maxItems || 80)
  if (auditor && filtered.length < beforeTruncate) {
    auditor.event('pipeline_filter', { stage: 'truncate', before: beforeTruncate, after: filtered.length, dropped: beforeTruncate - filtered.length })
  }

  return filtered
}
