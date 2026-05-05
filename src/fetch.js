/**
 * ============================================================
 * 新闻抓取模块 — 向后兼容的薄壳 re-export
 * ============================================================
 *
 * 实际的抓取逻辑已迁移到 src/fetch/ 目录下的 adapter 模式。
 * 这个文件保留原有导出签名，让现有调用方无需修改。
 */

import { fetchAll } from './fetch/index.js'

export { fetchAll }

/**
 * @param {object} config - 主题配置对象（来自 YAML）
 * @returns {Promise<Array>} 过滤去重后的新闻条目
 */
export async function fetchAndFilter(config) {
  return fetchAll(config.sources, config.filter)
}
