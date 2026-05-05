/**
 * ============================================================
 * 正文提取模块 — 统一提取网页正文
 * ============================================================
 *
 * 任何拿到 article URL 的地方都能调用 extractArticle() 提取正文。
 *
 * 策略：
 *   1. undici 拉取 HTML（带 UA、超时）
 *   2. 优先用 Mozilla Readability（Firefox 阅读模式核心）
 *   3. Readability 失败时降级为 cheerio 选择器
 *   4. 提取的正文做长度校验（< 100 字视为失败）
 */

import { request } from 'undici'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import * as cheerio from 'cheerio'

const MIN_CONTENT_LENGTH = 100
const DEFAULT_TIMEOUT = 15000

const USER_AGENT =
  'Mozilla/5.0 (compatible; NewsBriefBot/1.0; +https://github.com/news-workflows)'

/**
 * 拉取页面 HTML
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function fetchHtml(url, timeoutMs) {
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
 * 用 Readability 提取正文
 * @param {string} html
 * @param {string} url
 * @returns {{ title: string, content: string, excerpt: string, byline: string } | null}
 */
export function extractWithReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (!article) return null

    return {
      title: article.title || '',
      content: article.textContent || '',
      excerpt: article.excerpt || '',
      byline: article.byline || '',
    }
  } catch {
    return null
  }
}

/**
 * 用 cheerio 降级提取正文
 * @param {string} html
 * @returns {{ title: string, content: string, excerpt: string, byline: string } | null}
 */
export function extractWithCheerio(html) {
  try {
    const $ = cheerio.load(html)
    const title = $('title').text() || $('h1').first().text() || ''

    // 按优先级尝试常见正文容器
    const selectors = ['article', 'main', '[role="main"]', '.article-body', '.post-content', '#content']
    let content = ''
    for (const sel of selectors) {
      const el = $(sel)
      if (el.length > 0) {
        content = el.text().trim()
        if (content.length >= MIN_CONTENT_LENGTH) break
      }
    }

    // 如果选择器都找不到正文，取 body 文本
    if (!content) {
      content = $('body').text().trim()
    }

    return {
      title,
      content,
      excerpt: content.slice(0, 200),
      byline: '',
    }
  } catch {
    return null
  }
}

/**
 * 抓取页面并提取正文
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<{ title: string, content: string, excerpt: string, byline: string }>}
 */
export async function extractArticle(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT

  try {
    const html = await fetchHtml(url, timeoutMs)

    // 优先 Readability
    let result = extractWithReadability(html, url)

    // 降级 cheerio
    if (!result || result.content.length < MIN_CONTENT_LENGTH) {
      const fallback = extractWithCheerio(html)
      if (fallback && fallback.content.length >= (result?.content.length || 0)) {
        result = fallback
      }
    }

    // 长度校验
    if (!result || result.content.length < MIN_CONTENT_LENGTH) {
      return { title: '', content: '', excerpt: '', byline: '' }
    }

    return result
  } catch (err) {
    console.error(`[extractor] ${url} 失败: ${err.message}`)
    return { title: '', content: '', excerpt: '', byline: '' }
  }
}
