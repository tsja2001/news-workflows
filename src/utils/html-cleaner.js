/**
 * ============================================================
 * HTML 瘦身工具 — 将页面 HTML 压缩为 LLM 友好的小文本
 * ============================================================
 *
 * 用 cheerio 操作 DOM，降低 token 消耗，同时保留足够结构信息。
 *
 * 两种模式：
 *   - list: 用于列表页，保留所有 <a> 标签和 class/id，移除导航/侧栏等
 *   - article: 用于详情页，只保留主内容区
 */

import * as cheerio from 'cheerio'

// 需要移除的标签
const REMOVE_TAGS = [
  'script', 'style', 'link', 'meta', 'noscript',
  'svg', 'iframe', 'canvas', 'picture', 'video', 'audio',
]

// 列表模式下需要移除的非内容区标签
const NON_CONTENT_TAGS = ['header', 'footer', 'nav', 'aside']

// 列表模式下需要移除的非内容区 role
const NON_CONTENT_ROLES = ['banner', 'navigation', 'complementary', 'contentinfo']

// article 模式下优先查找的主内容选择器（按优先级）
const ARTICLE_SELECTORS = ['article', 'main', '[role="main"]']

/**
 * 移除 HTML 注释
 * @param {string} html
 * @returns {string}
 */
function removeComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 移除 base64 内联资源
 */
function removeBase64(html) {
  return html.replace(/data:image\/[^"'\s)]*/g, '')
    .replace(/data:font\/[^"'\s)]*/g, '')
}

/**
 * 折叠连续空白
 */
function collapseWhitespace(html) {
  return html.replace(/\s+/g, ' ').trim()
}

/**
 * 截断 class 属性：只保留前 N 个 class
 */
function truncateClass(classAttr, maxClasses = 3) {
  const classes = classAttr.split(/\s+/).filter(Boolean)
  if (classes.length <= maxClasses) return classAttr
  return classes.slice(0, maxClasses).join(' ')
}

/**
 * 清理 HTML
 *
 * @param {string} html - 原始 HTML
 * @param {object} [options]
 * @param {'list' | 'article'} [options.mode='list']
 * @param {number} [options.maxChars=1000000]
 * @returns {{ cleaned: string, originalLength: number, cleanedLength: number, truncated: boolean }}
 */
export function cleanHtml(html, options = {}) {
  const mode = options.mode || 'list'
  const maxChars = options.maxChars || 1000000
  const originalLength = html.length

  // 预清理：注释、base64、空白
  let work = removeComments(html)
  work = removeBase64(work)

  const $ = cheerio.load(work)

  // —— 必做清理 ——

  // 移除不需要的标签
  for (const tag of REMOVE_TAGS) {
    $(tag).remove()
  }

  // 遍历所有元素做属性清理
  $('*').each((_, el) => {
    if (el.type !== 'tag') return

    const attrs = $(el).attr()
    if (!attrs) return

    for (const [name] of Object.entries(attrs)) {
      // 移除事件属性
      if (name.startsWith('on')) {
        $(el).removeAttr(name)
        continue
      }
      // 移除 style 属性
      if (name === 'style') {
        $(el).removeAttr(name)
        continue
      }
      // 移除 data-* 属性
      if (name.startsWith('data-')) {
        $(el).removeAttr(name)
        continue
      }
      // 列表模式截断 class（保留前 3 个），文章模式移除 class
      if (name === 'class') {
        if (mode === 'list') {
          const truncated = truncateClass(attrs[name])
          if (truncated !== attrs[name]) $(el).attr('class', truncated)
        } else {
          $(el).removeAttr('class')
        }
        continue
      }
      // 文章模式也移除 id
      if (name === 'id' && mode === 'article') {
        $(el).removeAttr('id')
      }
    }
  })

  // —— 模式相关清理 ——

  if (mode === 'list') {
    // 移除非内容区标签
    for (const tag of NON_CONTENT_TAGS) {
      $(tag).remove()
    }
    // 移除非内容区 role
    for (const role of NON_CONTENT_ROLES) {
      $(`[role="${role}"]`).remove()
    }
  }

  if (mode === 'article') {
    // 查找主内容区
    let $main = null
    for (const sel of ARTICLE_SELECTORS) {
      const el = $(sel)
      if (el.length > 0) {
        $main = el.first()
        break
      }
    }

    // 如果选择器都没找到，找文本量最大的 div
    if (!$main || $main.length === 0) {
      let maxText = 0
      $('div').each((_, el) => {
        const text = $(el).text().trim()
        if (text.length > maxText) {
          maxText = text.length
          $main = $(el)
        }
      })
    }

    if ($main && $main.length > 0) {
      // 只保留主内容区
      $('body').html($main.html() || '')
    }
  }

  // —— 移除空的 div/span ——
  // 多次遍历，因为移除一个可能让它的父元素变空
  for (let i = 0; i < 3; i++) {
    $('div:empty, span:empty').remove()
  }

  // —— 序列化 ——
  let cleaned = mode === 'article'
    ? $('body').html() || ''
    : $.html()

  cleaned = collapseWhitespace(cleaned)
  let cleanedLength = cleaned.length

  // —— 截断 ——
  let truncated = false
  if (cleanedLength > maxChars) {
    cleaned = cleaned.slice(0, maxChars)
    cleanedLength = cleaned.length
    truncated = true
  }

  return { cleaned, originalLength, cleanedLength, truncated }
}
