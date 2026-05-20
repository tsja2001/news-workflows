/**
 * ============================================================
 * RSS 适配器 — 从 RSS/Atom feed 抓取新闻
 * ============================================================
 *
 * 这是默认的抓取方式。从现有 fetch.js 迁移而来，增加了：
 *   - p-retry 网络请求重试
 *   - fetchFullContent 正文回抓（通过 extractor.js）
 *   - 统一的 fetchFromXxx(sourceConfig, options) 签名
 */

import Parser from 'rss-parser'
import pRetry from 'p-retry'
import pLimit from 'p-limit'
import { createLogger } from '../utils/logger.js'
import { extractArticle } from './extractor.js'

const parser = new Parser({ timeout: 15000 })

/**
 * 拉取单个 RSS 源，转为统一的 NewsItem 格式
 *
 * @param {object} sourceConfig - yaml 里单个 source 的配置
 * @param {string} sourceConfig.name - 源名称
 * @param {string} sourceConfig.url  - RSS 地址
 * @param {boolean} [sourceConfig.fetchFullContent] - 是否回抓正文
 * @param {number} [sourceConfig.fetchContentConcurrency=3] - 回抓正文并发上限
 * @param {object} [options]
 * @param {number} [options.retries=3] - 重试次数
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromRss(sourceConfig, options = {}) {
  const retries = options.retries ?? 3
  const log = createLogger(`rss/${sourceConfig.name}`)
  const startMs = Date.now()

  try {
    log.step('拉取 RSS feed', { url: sourceConfig.url, retries })
    const feed = await pRetry(() => parser.parseURL(sourceConfig.url), {
      retries,
      minTimeout: 1000,
      maxTimeout: 10000,
      onFailedAttempt: err => {
        log.warn('RSS 重试失败', {
          attempt: err.attemptNumber,
          retries,
          reason: err.message,
          url: sourceConfig.url,
        })
      },
    })

    const items = feed.items.map(item => ({
      title: item.title || '',
      url: item.link || '',
      source: sourceConfig.name,
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      summary: item.contentSnippet || item.content || '',
    }))

    log.success('RSS feed 解析完成', { items: items.length, ms: Date.now() - startMs })

    // 正文回抓：通过 extractor.js 回抓每个链接的正文
    if (sourceConfig.fetchFullContent && items.length > 0) {
      const concurrency = sourceConfig.fetchContentConcurrency ?? 3
      const limit = pLimit(concurrency)
      let completed = 0
      let failed = 0

      log.step('开始正文回抓', { total: items.length, concurrency })

      const enriched = await Promise.all(
        items.map((item, idx) =>
          limit(async () => {
            const articleNo = idx + 1
            log.step('正文回抓中', { progress: `${articleNo}/${items.length}`, url: item.url })
            try {
              const article = await extractArticle(item.url)
              completed++
              log.success('正文回抓成功', {
                completed: `${completed + failed}/${items.length}`,
                length: article.content?.length || 0,
                url: item.url,
              })
              return { ...item, content: article.content }
            } catch (err) {
              failed++
              log.warn('正文回抓失败', {
                completed: `${completed + failed}/${items.length}`,
                reason: err.message,
                url: item.url,
              })
              return { ...item, content: '' }
            }
          })
        )
      )

      log.success('正文回抓完成', { success: `${completed}/${items.length}`, failed })
      return enriched
    }

    return items
  } catch (err) {
    log.error('最终失败', { reason: err.message, url: sourceConfig.url, ms: Date.now() - startMs })
    return []
  }
}
