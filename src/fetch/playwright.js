/**
 * ============================================================
 * Playwright 适配器 — JS 渲染站爬虫
 * ============================================================
 *
 * 适用于需要 JS 执行才能渲染内容的 SPA 新闻站。
 *
 * 使用前需要手动安装 Chromium：
 *   npx playwright install chromium
 *
 * 性能要点：
 *   - browser 实例全局复用（单例），不每次启动
 *   - 每个 source 使用独立 context，失败不影响其他
 *   - 默认屏蔽图片/字体/CSS 资源，只保留 HTML 和 JS
 *   - 列表页 → 收集链接 → 逐个访问文章页
 */

import { chromium } from 'playwright-core'
import { createLogger } from '../utils/logger.js'

const USER_AGENT =
  'Mozilla/5.0 (compatible; NewsBriefBot/1.0; +https://github.com/news-workflows)'

let _browser = null

/**
 * 获取或创建 browser 单例
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true })
  }
  return _browser
}

/**
 * 关闭 browser 实例，一般在进程退出前调用
 */
export async function shutdownPlaywright() {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
}

/**
 * 用 Playwright 抓取 JS 渲染的新闻站
 *
 * @param {object} sourceConfig - yaml 配置
 * @param {string} sourceConfig.name
 * @param {string} sourceConfig.listUrl - 列表页 URL
 * @param {string} [sourceConfig.waitFor] - 等待此 CSS 出现再继续
 * @param {number} [sourceConfig.waitTimeoutMs=10000]
 * @param {object} sourceConfig.selectors
 * @param {string} sourceConfig.selectors.articleLinks - 列表页文章链接选择器
 * @param {string} [sourceConfig.selectors.title]
 * @param {string} [sourceConfig.selectors.content]
 * @param {string} [sourceConfig.selectors.publishedAt]
 * @param {boolean} [sourceConfig.blockResources=true] - 是否屏蔽图片/字体/CSS
 * @param {number} [sourceConfig.maxArticles=15]
 * @param {object} [options]
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromPlaywright(sourceConfig, options = {}) {
  const log = createLogger(`playwright/${sourceConfig.name}`)
  const maxArticles = sourceConfig.maxArticles || 15
  const selectors = sourceConfig.selectors || {}
  const waitTimeout = sourceConfig.waitTimeoutMs || 10000
  const blockResources = sourceConfig.blockResources !== false
  const startMs = Date.now()

  let context
  try {
    log.step('启动浏览器上下文', { blockResources })
    const browser = await getBrowser()
    context = await browser.newContext({ userAgent: USER_AGENT })

    // 屏蔽图片/字体/CSS 资源以加速
    if (blockResources) {
      await context.route('**/*.{png,jpg,jpeg,svg,gif,webp,woff,woff2,ttf,css}', r => r.abort())
    }

    const page = await context.newPage()

    // 1. 访问列表页
    log.step('访问列表页', { url: sourceConfig.listUrl, waitTimeout })
    await page.goto(sourceConfig.listUrl, {
      waitUntil: 'domcontentloaded',
      timeout: waitTimeout,
    })

    // 等待关键元素出现
    if (sourceConfig.waitFor) {
      await page.waitForSelector(sourceConfig.waitFor, { timeout: waitTimeout })
    }

    // 2. 提取文章链接
    if (!selectors.articleLinks) {
      log.warn('缺少 selectors.articleLinks')
      return []
    }

    const links = await page.$$eval(selectors.articleLinks, (els, limit) =>
      els.slice(0, limit).map(el => el.href).filter(Boolean),
      maxArticles
    )

    if (links.length === 0) {
      log.warn('列表页未提取到链接', { url: sourceConfig.listUrl })
      return []
    }

    log.success('列表页提取完成', { links: links.length })

    // 3. 逐个访问文章页提取内容
    const items = []
    let failed = 0
    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      try {
        const detailStart = Date.now()
        log.step('抓取文章', { progress: `${i + 1}/${links.length}`, url: link })
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: waitTimeout })

        let title = ''
        let content = ''
        let publishedAt = ''

        if (selectors.title) {
          title = await page.$eval(selectors.title, el => el.textContent?.trim() || '').catch(() => '')
        }
        if (selectors.content) {
          content = await page.$eval(selectors.content, el => el.textContent?.trim() || '').catch(() => '')
        }
        if (selectors.publishedAt) {
          publishedAt = await page.$eval(selectors.publishedAt, el =>
            el.getAttribute('datetime') || el.textContent?.trim() || ''
          ).catch(() => '')
        }

        if (!content) {
          content = await page.$eval('article, main, [role="main"]', el =>
            el.textContent?.trim() || ''
          ).catch(() => '')
        }

        if (!title) {
          title = await page.title()
        }

        log.success('文章抓取完成', {
          completed: `${items.length + failed + 1}/${links.length}`,
          title,
          length: content?.length || 0,
          ms: Date.now() - detailStart,
        })

        items.push({
          title: title || '',
          url: link,
          source: sourceConfig.name,
          publishedAt: publishedAt || new Date().toISOString(),
          summary: content ? content.slice(0, 300) : '',
          content,
        })
      } catch (err) {
        failed++
        log.warn('文章抓取失败', {
          completed: `${items.length + failed}/${links.length}`,
          reason: err.message,
          url: link,
        })
      }
    }

    log.success('完成', { success: `${items.length}/${links.length}`, failed, ms: Date.now() - startMs })
    return items
  } catch (err) {
    log.error('失败', { reason: err.message, ms: Date.now() - startMs })
    return []
  } finally {
    if (context) await context.close()
  }
}
