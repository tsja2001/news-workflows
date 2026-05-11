/**
 * ============================================================
 * type: web 适配器 — 通用 AI 网页抓取
 * ============================================================
 */

import pLimit from 'p-limit'
import { createLogger } from '../utils/logger.js'
import { cleanHtml } from '../utils/html-cleaner.js'
import { createContext, closeContext, navigateAndWait, screenshotFailure } from './web/browser.js'
import { extractList, sortByConfidence } from './web/extract-list.js'
import { extractDetail } from './web/extract-detail.js'
import { expandUrls } from './web/url-expander.js'

const MAX_CANDIDATE_POOL = 500
const MAX_ARTICLES_HARD_LIMIT = 100
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * @param {object} sourceConfig
 * @param {object} [options]
 * @param {number} [options.retries=3]
 * @param {object} [options.auditor] - 审计日志记录器（scoped）
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromWeb(sourceConfig, options = {}) {
  const log = createLogger(`web/${sourceConfig.name}`)
  const maxArticles = sourceConfig.maxArticles || 50
  const fetchDetail = sourceConfig.fetchDetail !== false
  const detailExtraction = sourceConfig.detailExtraction || 'auto'
  const detailConcurrency = sourceConfig.detailConcurrency || 3
  const extractDepth = sourceConfig.extractDepth || 'deep'
  const blockResources = sourceConfig.blockResources !== false
  const pageDelayMs = sourceConfig.pageDelayMs ?? 1000
  const auditor = options.auditor

  if (maxArticles > MAX_ARTICLES_HARD_LIMIT) {
    throw new Error(`Source "${sourceConfig.name}": maxArticles 不能超过 ${MAX_ARTICLES_HARD_LIMIT}`)
  }

  const startTime = Date.now()
  let context

  try {
    const expandedUrls = expandUrls(sourceConfig)
    log.info('URL 展开', { count: expandedUrls.length, depth: extractDepth })

    if (auditor) {
      auditor.event('source_started', {
        urls: expandedUrls.map(u => u.url),
        maxArticles,
        detailExtraction,
        extractDepth,
      })
    }

    context = await createContext(sourceConfig, blockResources, log)

    const allCandidates = []
    let totalTokensIn = 0
    let totalTokensOut = 0

    for (let i = 0; i < expandedUrls.length; i++) {
      const { url, hint, page } = expandedUrls[i]
      const idx = i + 1
      const pageLabel = page !== null ? ` (第${page}页)` : ''
      log.step(`列表页 ${idx}/${expandedUrls.length}${pageLabel}`, { url })

      try {
        const pageCtx = await context.newPage()
        const loadMs = await navigateAndWait(pageCtx, url, sourceConfig.waitFor)
        const fullHtml = await pageCtx.content()
        log.success('页面加载完成', { ms: loadMs, bytes: fullHtml.length })

        // HTML < 5KB 说明可能是反爬页面、paywall 或重定向，直接跳过
        if (fullHtml.length < 5000) {
          log.warn('页面内容过少，疑似反爬或空页面', { bytes: fullHtml.length })
          await pageCtx.close().catch(() => {})
          continue
        }

        if (auditor) {
          auditor.event('list_page_loaded', { url, page, htmlBytes: fullHtml.length, durationMs: loadMs })
        }

        const { cleaned, originalLength, cleanedLength, truncated } = cleanHtml(fullHtml, {
          mode: 'list',
          maxChars: 1000000,
        })
        if (truncated) {
          log.warn('HTML 超过上限已截断', { maxChars: 1000000 })
        }

        const listItems = await extractList(cleaned, url, {
          hint,
          extractDepth,
          maxItems: maxArticles,
          retries: options.retries,
          auditor,
        })

        for (const item of listItems) {
          item._page = page
          item._listUrl = url
        }

        allCandidates.push(...listItems)

        if (allCandidates.length > MAX_CANDIDATE_POOL) {
          log.warn('候选池达到上限，截断', { max: MAX_CANDIDATE_POOL })
          allCandidates.length = MAX_CANDIDATE_POOL
          break
        }

        // 统计 section 分布用于终端显示
        const sections = {}
        for (const item of listItems) {
          if (item.section) {
            sections[item.section] = (sections[item.section] || 0) + 1
          }
        }
        const sectionSummary = Object.entries(sections).slice(0, 3).map(([k, v]) => `${k}:${v}条`).join(' ')

        log.success('提取完成', {
          candidates: listItems.length,
          totalSoFar: allCandidates.length,
        })
        if (sectionSummary) {
          console.log(`        ├─ ${sectionSummary}`)
        }

        await pageCtx.close().catch(() => {})
      } catch (err) {
        log.warn('列表页失败，跳过', { url, reason: err.message })
      }

      if (i < expandedUrls.length - 1 && pageDelayMs > 0) {
        await sleep(pageDelayMs)
      }
    }

    if (allCandidates.length === 0) {
      log.error('所有列表 URL 均失败或为空')
      if (auditor) auditor.event('source_failed', { reason: '所有列表 URL 均失败', durationMs: Date.now() - startTime })
      return []
    }

    // URL 去重
    const seen = new Set()
    const deduped = []
    const droppedDup = []
    for (const item of allCandidates) {
      if (!seen.has(item.url)) {
        seen.add(item.url)
        deduped.push(item)
      } else {
        droppedDup.push({ url: item.url, reason: 'duplicate' })
      }
    }

    if (deduped.length < allCandidates.length) {
      log.info(`URL 去重: ${allCandidates.length} → ${deduped.length}`)
    }

    // confidence 排序 + 截取
    const sorted = sortByConfidence(deduped)
    const selected = sorted.slice(0, maxArticles)

    if (auditor) {
      const dropped = [
        ...droppedDup,
        ...sorted.slice(maxArticles).map(item => ({ url: item.url, reason: 'exceeded_maxArticles', confidence: item.confidence })),
      ]
      auditor.event('candidates_filtered', {
        before: allCandidates.length,
        after: selected.length,
        dropped: dropped.slice(0, 100), // 最多记 100 条删除记录
      })
    }

    const dist = { high: 0, medium: 0, low: 0 }
    for (const item of selected) {
      if (dist[item.confidence] !== undefined) dist[item.confidence]++
    }
    log.info(`候选池: ${allCandidates.length} → 去重 ${deduped.length} → 选取 ${selected.length}`, {
      confidence: `high=${dist.high} medium=${dist.medium} low=${dist.low}`,
    })

    // 详情页抓取
    if (!fetchDetail) {
      const items = selected.map(item => ({
        ...item,
        source: sourceConfig.name,
        publishedAt: item.publishedAt || new Date().toISOString(),
      }))
      if (auditor) auditor.event('source_completed', { totalCandidates: allCandidates.length, detailsFetched: 0, detailsSucceeded: 0, detailsFailed: 0, durationMs: Date.now() - startTime })
      log.success('完成（仅列表）', { count: items.length, ms: Date.now() - startTime })
      return items
    }

    const detailPage = await context.newPage()
    const limit = pLimit(detailConcurrency)
    const finalItems = []
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < selected.length; i++) {
      const result = await limit(async () => {
        const listItem = selected[i]
        const idx = i + 1
        log.step(`抓取详情 ${idx}/${selected.length}`, { url: listItem.url })

        try {
          const detailStart = Date.now()
          await detailPage.goto(listItem.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          })

          const detailHtml = await detailPage.content()
          const detailMs = Date.now() - detailStart
          log.success('详情页加载完成', { url: listItem.url, ms: detailMs, bytes: detailHtml.length })

          const detail = await extractDetail(detailHtml, listItem.url, detailExtraction, { auditor })
          const contentLen = detail.content?.length || 0
          log.success('内容提取完成', { title: detail.title, contentLength: contentLen, strategy: detail._strategy })

          if (auditor) {
            auditor.event('detail_extracted', {
              url: listItem.url,
              title: detail.title || listItem.title,
              strategy: detail._strategy,
              length: contentLen,
              readabilityLen: detail._readabilityLen,
              aiLen: detail._aiLen,
              tokens: detail._tokens,
              durationMs: detailMs,
            })
          }

          return {
            title: detail.title || listItem.title,
            url: listItem.url,
            source: sourceConfig.name,
            publishedAt: detail.publishedAt || listItem.publishedAt || new Date().toISOString(),
            summary: listItem.summary || detail.content?.slice(0, 300) || '',
            content: detail.content || '',
          }
        } catch (err) {
          log.warn('详情页失败，跳过', { url: listItem.url, reason: err.message })
          if (auditor) {
            auditor.event('detail_failed', { url: listItem.url, reason: err.message, durationMs: 0 })
          }
          return {
            title: listItem.title,
            url: listItem.url,
            source: sourceConfig.name,
            publishedAt: listItem.publishedAt || new Date().toISOString(),
            summary: listItem.summary,
            content: '',
          }
        }
      })

      finalItems.push(result)
      if (result.content) successCount++
      else failCount++
    }

    const totalMs = Date.now() - startTime
    log.success('完成', {
      success: `${successCount}/${finalItems.length}`,
      ms: totalMs,
    })

    if (auditor) {
      auditor.event('source_completed', {
        totalCandidates: allCandidates.length,
        detailsFetched: selected.length,
        detailsSucceeded: successCount,
        detailsFailed: failCount,
        durationMs: totalMs,
      })
    }

    return finalItems
  } catch (err) {
    log.error('列表页失败', { reason: err.message })
    if (auditor) auditor.event('source_failed', { reason: err.message, durationMs: Date.now() - startTime })
    try {
      const page = context?.pages?.()?.[0]
      if (page) await screenshotFailure(page, sourceConfig.name)
    } catch {
      // ignore
    }
    return []
  } finally {
    await closeContext(context)
  }
}
