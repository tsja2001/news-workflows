/**
 * ============================================================
 * 新闻抓取模块 — 向后兼容的薄壳 re-export
 * ============================================================
 *
 * 实际的抓取逻辑已迁移到 src/fetch/ 目录下的 adapter 模式。
 * 这个文件保留原有导出签名，并在此集成历史去重：
 *   - 抓取前：加载已见过的 URL，传给过滤管线排掉
 *   - 抓取后：把新结果的 URL 标记为已见
 *   - 每次运行前清理过期记录（默认保留 7 天）
 */

import { fetchAll } from './fetch/index.js'

export { fetchAll }

/**
 * @param {object} config - 主题配置对象（来自 YAML）
 * @param {object} [options]
 * @param {boolean} [options.noDedup] - 禁用历史去重
 * @returns {Promise<Array>} 过滤去重后的新闻条目
 */
export async function fetchAndFilter(config, options = {}) {
  // dedup 生效条件：YAML 明确开启 + CLI 未传 --no-dedup
  const dedupEnabled = !options.noDedup && config.dedup?.enabled
  // within-batch 去重也要关掉的条件：CLI --no-dedup 或 YAML dedup 未启用
  const noDedup = options.noDedup || !config.dedup?.enabled

  // 加载已见 URL + 清理过期记录
  let seenUrls
  if (dedupEnabled) {
    const { loadSeen, pruneOldEntries } = await import('./state/seen-store.js')
    await pruneOldEntries(config.id, config.dedup.retentionDays ?? 7)
    const seenMap = await loadSeen(config.id)
    seenUrls = new Set(seenMap.keys())
    console.log(`  已加载 ${seenUrls.size} 条历史去重记录`)
  }

  const items = await fetchAll(config.sources, config.filter, { seenUrls, noDedup })

  // 标记新见的 URL
  if (dedupEnabled && items.length > 0) {
    const { markSeen } = await import('./state/seen-store.js')
    await markSeen(config.id, items.map(i => i.url))
    console.log(`  已标记 ${items.length} 条新 URL`)
  }

  return items
}
