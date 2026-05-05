/**
 * ============================================================
 * 过滤管线共用模块 — 时间过滤、关键词过滤、URL 去重、排序截断
 * ============================================================
 *
 * 这些函数从 fetch.js 的 fetchAndFilter 中抽取出来，
 * 所有 adapter 产出的 NewsItem[] 都经过同一条过滤管线。
 */

/**
 * 时间窗口过滤：只保留 lookbackHours 小时内的新闻
 * @param {import('./types.js').NewsItem[]} items
 * @param {number} lookbackHours
 * @returns {import('./types.js').NewsItem[]}
 */
export function filterByTime(items, lookbackHours) {
  const cutoff = Date.now() - lookbackHours * 3600 * 1000
  return items.filter(item => new Date(item.publishedAt).getTime() > cutoff)
}

/**
 * 关键词过滤：标题或摘要中命中任意关键词则保留（大小写不敏感）
 * @param {import('./types.js').NewsItem[]} items
 * @param {string[]} keywords
 * @returns {import('./types.js').NewsItem[]}
 */
export function filterByKeywords(items, keywords) {
  if (!keywords || keywords.length === 0) return items
  const lowered = keywords.map(k => k.toLowerCase())
  return items.filter(item => {
    const text = `${item.title} ${item.summary}`.toLowerCase()
    return lowered.some(k => text.includes(k))
  })
}

/**
 * URL 去重：同一 URL 只保留首次出现的条目
 * @param {import('./types.js').NewsItem[]} items
 * @param {Set<string>} [existingUrls] - 已有的 URL 集合（用于跨源去重+历史去重）
 * @returns {import('./types.js').NewsItem[]}
 */
export function dedupByUrl(items, existingUrls) {
  const seen = existingUrls ? new Set(existingUrls) : new Set()
  return items.filter(item => {
    if (!item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

/**
 * 按发布时间倒序排列，截取前 N 条
 * @param {import('./types.js').NewsItem[]} items
 * @param {number} maxItems
 * @returns {import('./types.js').NewsItem[]}
 */
export function sortAndTruncate(items, maxItems) {
  const sorted = [...items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  return sorted.slice(0, maxItems)
}

/**
 * 对单批条目跑完整过滤管线（不含历史去重，历史去重在调度层处理）
 * @param {import('./types.js').NewsItem[]} items
 * @param {object} filterConfig - yaml 里的 filter 配置
 * @param {Set<string>} [seenUrls] - 已见过的 URL 集合
 * @returns {import('./types.js').NewsItem[]}
 */
export function applyFilters(items, filterConfig, seenUrls) {
  let result = items
  result = filterByTime(result, filterConfig.lookbackHours)
  result = filterByKeywords(result, filterConfig.keywords)
  result = dedupByUrl(result, seenUrls)
  return result
}
