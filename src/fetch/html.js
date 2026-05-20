/**
 * ============================================================
 * HTML 适配器 — 静态 HTML 新闻站爬虫
 * ============================================================
 *
 * 适用于列表页 + 文章页都是服务端渲染的静态站。
 *
 * 抓取流程：
 *   1. 拉取 listUrl，用 cheerio 跑 selectors.articleLinks 拿链接列表
 *   2. 对每个链接：
 *      - 如果 yaml 配了细粒度 selectors，用 cheerio 直接抓
 *      - 否则降级用 extractor.js（Readability）
 *   3. 时间字段缺失时用当前时间兜底
 *
 * 健壮性：
 *   - 列表页失败 → 整个 source 返回 []
 *   - 单篇文章失败 → 跳过那一篇，其他继续
 */

import { request } from 'undici'
import * as cheerio from 'cheerio'
import pLimit from 'p-limit'
import { createLogger } from '../utils/logger.js'
import { extractArticle } from './extractor.js'

const USER_AGENT =
  'Mozilla/5.0 (compatible; NewsBriefBot/1.0; +https://github.com/news-workflows)'
const DEFAULT_MAX_ARTICLES = 20

/**
 * 拉取 HTML
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function fetchPage(url, timeoutMs = 15000) {
  const { body, statusCode } = await request(url, {
    headers: { 'User-Agent': USER_AGENT },
    maxRedirections: 3,
    timeout: timeoutMs,
  })

  if (statusCode >= 400) {
    throw new Error(`HTTP ${statusCode}`)
  }

  return body.text()
}

/**
 * 从列表页提取文章链接
 * @param {string} html - 列表页 HTML
 * @param {string} selector - CSS 选择器（如 ".dataList li a"）
 * @param {string} linkPrefix - 相对链接的前缀
 * @param {number} maxArticles
 * @returns {string[]} 绝对链接数组
 */
export function extractLinks(html, selector, linkPrefix, maxArticles) {
  const $ = cheerio.load(html)
  const links = []
  $(selector).each((_, el) => {
    if (links.length >= maxArticles) return false
    let href = $(el).attr('href')
    if (!href) return

    // 相对链接转绝对链接
    if (linkPrefix && !href.startsWith('http')) {
      href = linkPrefix.replace(/\/$/, '') + (href.startsWith('/') ? '' : '/') + href
    }

    if (href.startsWith('http')) {
      links.push(href)
    }
  })
  return links
}

/**
 * 用 cheerio 选择器提取文章详情
 * @param {string} html
 * @param {object} selectors - { title, content, publishedAt, publishedAtAttr }
 * @returns {{ title: string, content: string, publishedAt: string }}
 */
export function extractWithSelectors(html, selectors) {
  const $ = cheerio.load(html)

  // 移除 style/script 标签，避免 CSS/JS 被 .text() 当作正文提取
  $('style, script, noscript, svg, link, meta').remove()

  let title = ''
  if (selectors.title) {
    title = $(selectors.title).first().text().trim()
  }

  let content = ''
  if (selectors.content) {
    content = $(selectors.content).text().trim()
  }

  let publishedAt = ''
  if (selectors.publishedAt) {
    const el = $(selectors.publishedAt).first()
    if (selectors.publishedAtAttr) {
      publishedAt = el.attr(selectors.publishedAtAttr) || ''
    } else {
      publishedAt = el.text().trim()
    }
  }

  return { title, content, publishedAt }
}

/**
 * 从 HTML 静态站抓取新闻
 *
 * @param {object} sourceConfig - yaml 里单个 source 的配置
 * @param {string} sourceConfig.name
 * @param {string} sourceConfig.listUrl
 * @param {object} sourceConfig.selectors
 * @param {string} sourceConfig.selectors.articleLinks
 * @param {string} [sourceConfig.selectors.title]
 * @param {string} [sourceConfig.selectors.content]
 * @param {string} [sourceConfig.selectors.publishedAt]
 * @param {string} [sourceConfig.selectors.publishedAtAttr]
 * @param {string} [sourceConfig.linkPrefix]
 * @param {number} [sourceConfig.maxArticles=20]
 * @param {object} [options]
 * @param {number} [options.retries=3]
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromHtml(sourceConfig, options = {}) {
  const log = createLogger(`html/${sourceConfig.name}`)
  const maxArticles = sourceConfig.maxArticles || DEFAULT_MAX_ARTICLES
  const selectors = sourceConfig.selectors || {}
  const linkPrefix = sourceConfig.linkPrefix || ''
  const startMs = Date.now()

  try {
    // 1. 拉取列表页
    log.step('拉取列表页', { url: sourceConfig.listUrl, maxArticles })
    const listHtml = await fetchPage(sourceConfig.listUrl)
    const links = extractLinks(listHtml, selectors.articleLinks, linkPrefix, maxArticles)

    if (links.length === 0) {
      log.warn('列表页未提取到任何链接', { url: sourceConfig.listUrl })
      return []
    }

    log.success('列表页提取完成', { links: links.length, bytes: listHtml.length })

    // 2. 并发抓取文章详情
    const limit = pLimit(3)
    let completed = 0
    let failed = 0
    const items = await Promise.all(
      links.map((link, idx) =>
        limit(async () => {
          log.step('抓取文章', { progress: `${idx + 1}/${links.length}`, url: link })
          try {
            const detailStart = Date.now()
            const html = await fetchPage(link)

            const hasDetailSelectors = selectors.title || selectors.content || selectors.publishedAt
            let title = ''
            let content = ''
            let publishedAt = ''

            if (hasDetailSelectors) {
              const extracted = extractWithSelectors(html, selectors)
              title = extracted.title
              content = extracted.content
              publishedAt = extracted.publishedAt
            }

            // 如果 cheerio 没拿到正文，降级用 Readability
            if (!content) {
              const article = await extractArticle(link)
              title = title || article.title
              content = article.content
            }

            completed++
            log.success('文章抓取完成', {
              completed: `${completed + failed}/${links.length}`,
              title: title || '',
              length: content?.length || 0,
              ms: Date.now() - detailStart,
            })

            return {
              title: title || '',
              url: link,
              source: sourceConfig.name,
              publishedAt: publishedAt || new Date().toISOString(),
              summary: content ? content.slice(0, 300) : '',
              content,
            }
          } catch (err) {
            failed++
            log.warn('文章抓取失败', {
              completed: `${completed + failed}/${links.length}`,
              reason: err.message,
              url: link,
            })
            return null
          }
        })
      )
    )

    // 过滤掉抓取失败的条目
    const finalItems = items.filter(Boolean)
    log.success('完成', { success: `${finalItems.length}/${links.length}`, ms: Date.now() - startMs })
    return finalItems
  } catch (err) {
    log.error('列表页失败', { reason: err.message, url: sourceConfig.listUrl, ms: Date.now() - startMs })
    return []
  }
}
