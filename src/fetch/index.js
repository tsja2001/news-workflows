/**
 * ============================================================
 * 抓取调度器 — 根据 source.type 路由到对应 adapter
 * ============================================================
 *
 * 职责：
 *   1. 遍历所有 source，按 type 路由到对应 adapter
 *   2. 用 p-limit 控制并发上限
 *   3. 单个 adapter 失败不影响其他 source
 *   4. 汇总后统一走过滤管线
 */

import pLimit from 'p-limit'
import { fetchFromRss } from './rss.js'
import { fetchFromHtml } from './html.js'
import { fetchFromApi } from './api.js'
import { fetchFromPlaywright } from './playwright.js'
import { applyFilters, sortAndTruncate } from './common.js'

// 适配器注册表：source.type → fetch 函数
const ADAPTERS = {
  rss: fetchFromRss,
  html: fetchFromHtml,
  api: fetchFromApi,
  playwright: fetchFromPlaywright,
}

/**
 * 并发拉取所有源并过滤
 *
 * @param {object[]} sources - yaml 里的 sources 数组
 * @param {object} filterConfig - yaml 里的 filter 配置（含 runtime）
 * @param {object} [options]
 * @param {Set<string>} [options.seenUrls] - 历史已见过的 URL 集合
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchAll(sources, filterConfig, options = {}) {
  const runtime = filterConfig.runtime || {}
  const concurrency = runtime.concurrency ?? 5
  const limit = pLimit(concurrency)

  const results = await Promise.all(
    sources.map(s =>
      limit(async () => {
        const type = s.type || 'rss' // 默认 rss，向后兼容
        const adapter = ADAPTERS[type]
        if (!adapter) {
          console.error(`[fetch] 未知 source 类型: "${type}"，跳过 ${s.name || s.url}`)
          return []
        }
        return adapter(s, { retries: runtime.retries ?? 3 })
      })
    )
  )

  const allItems = results.flat()

  // 统一过滤管线
  let filtered = applyFilters(allItems, filterConfig, options.seenUrls)

  // 排序 + 截断
  filtered = sortAndTruncate(filtered, filterConfig.maxItems)

  return filtered
}
