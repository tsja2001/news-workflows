/**
 * ============================================================
 * RSS 适配器 — 从 RSS/Atom feed 抓取新闻
 * ============================================================
 *
 * 这是默认的抓取方式。从现有 fetch.js 迁移而来，增加了：
 *   - p-retry 网络请求重试
 *   - 统一的 fetchFromXxx(sourceConfig, options) 签名
 */

import Parser from 'rss-parser'
import pRetry from 'p-retry'

const parser = new Parser({ timeout: 15000 })

/**
 * 拉取单个 RSS 源，转为统一的 NewsItem 格式
 *
 * @param {object} sourceConfig - yaml 里单个 source 的配置
 * @param {string} sourceConfig.name - 源名称
 * @param {string} sourceConfig.url  - RSS 地址
 * @param {object} [options]
 * @param {number} [options.retries=3] - 重试次数
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromRss(sourceConfig, options = {}) {
  const retries = options.retries ?? 3

  try {
    const feed = await pRetry(() => parser.parseURL(sourceConfig.url), {
      retries,
      minTimeout: 1000,
      maxTimeout: 10000,
      onFailedAttempt: err => {
        console.warn(`[rss] ${sourceConfig.name} 第 ${err.attemptNumber} 次重试失败: ${err.message}`)
      },
    })

    return feed.items.map(item => ({
      title: item.title || '',
      url: item.link || '',
      source: sourceConfig.name,
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      summary: item.contentSnippet || item.content || '',
    }))
  } catch (err) {
    console.error(`[rss] ${sourceConfig.name} 最终失败: ${err.message}`)
    return []
  }
}
