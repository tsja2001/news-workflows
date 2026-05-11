/**
 * ============================================================
 * AI 提取列表 — 从瘦身后的 HTML 中提取新闻链接列表
 * ============================================================
 */

import pRetry from 'p-retry'
import { callLLMForJsonWithMeta } from '../../llm.js'
import { EXTRACT_LIST_SYSTEM, LIST_EXTRACT_DEEP_SYSTEM, buildExtractListUserPrompt } from './prompts.js'
import { createLogger } from '../../utils/logger.js'

/** confidence 权重：用于排序 */
const CONFIDENCE_WEIGHT = { high: 0, medium: 1, low: 2 }

/**
 * URL 合法化：相对路径转绝对路径，过滤无效链接
 * @param {string} rawUrl
 * @param {string} baseUrl
 * @returns {string | null}
 */
export function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * 过滤并合法化 AI 返回的链接列表
 * @param {object[]} rawItems
 * @param {string} baseUrl
 * @returns {import('../types.js').NewsItem[]}
 */
function normalizeAndFilter(rawItems, baseUrl) {
  if (!Array.isArray(rawItems)) return []

  return rawItems
    .map(item => {
      const normalized = normalizeUrl(item.url, baseUrl)
      if (!normalized) return null
      return {
        title: (item.title || '').trim(),
        url: normalized,
        source: '', // 由上层填入
        publishedAt: item.publishedAt || '',
        summary: (item.summary || '').trim(),
        // deep 模式的额外字段
        confidence: item.confidence || 'medium',
        section: item.section || '',
      }
    })
    .filter(Boolean)
}

/**
 * 按 confidence 排序：high → medium → low
 * @param {import('../types.js').NewsItem[]} items
 * @returns {import('../types.js').NewsItem[]}
 */
export function sortByConfidence(items) {
  return [...items].sort(
    (a, b) => (CONFIDENCE_WEIGHT[a.confidence] ?? 2) - (CONFIDENCE_WEIGHT[b.confidence] ?? 2)
  )
}

/**
 * 用 AI 从 HTML 中提取新闻链接列表
 *
 * @param {string} html - 瘦身后的 HTML
 * @param {string} pageUrl - 列表页 URL
 * @param {object} [options]
 * @param {string} [options.hint] - 给 AI 的提示
 * @param {'normal'|'deep'} [options.extractDepth='deep'] - 提取深度
 * @param {number} [options.retries=3]
 * @param {object} [options.auditor] - 审计日志记录器（scoped）
 * @returns {Promise<import('../types.js').NewsItem[]>}
 */
export async function extractList(html, pageUrl, options = {}) {
  const log = createLogger(`web/list`)
  const hint = options.hint
  const extractDepth = options.extractDepth || 'deep'
  const maxItems = options.maxItems || 50
  const retries = options.retries ?? 3
  const auditor = options.auditor
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'

  const depthLabel = extractDepth === 'deep' ? '深度提取' : '提取'
  log.step(`AI ${depthLabel}列表`, { htmlLen: html.length, maxItems, model })

  const systemPrompt = extractDepth === 'deep' ? LIST_EXTRACT_DEEP_SYSTEM : EXTRACT_LIST_SYSTEM
  const userPrompt = buildExtractListUserPrompt(pageUrl, html, hint, { maxItems })
  const startMs = Date.now()

  try {
    const { result: raw, tokens } = await pRetry(
      async () => {
        const { result, tokens } = await callLLMForJsonWithMeta(systemPrompt, userPrompt)
        if (!Array.isArray(result)) {
          throw new Error(`AI 返回格式错误: 期望数组，收到 ${typeof result}`)
        }
        return { result, tokens }
      },
      {
        retries,
        minTimeout: 2000,
        factor: 2,
        onFailedAttempt: err => {
          log.warn(`AI ${depthLabel}列表重试`, { attempt: err.attemptNumber, reason: err.message })
        },
      }
    )

    const items = normalizeAndFilter(raw, pageUrl)
    const durationMs = Date.now() - startMs

    if (items.length === 0) {
      log.warn('提取到 0 条')
    } else {
      const dist = { high: 0, medium: 0, low: 0 }
      for (const item of items) {
        if (dist[item.confidence] !== undefined) dist[item.confidence]++
      }
      log.success('提取完成', {
        count: items.length,
        sample: items[0]?.title,
        confidence: `high=${dist.high} medium=${dist.medium} low=${dist.low}`,
      })
    }

    // 审计
    if (auditor) {
      auditor.event('list_extracted', {
        url: pageUrl,
        count: items.length,
        candidates: items.map(i => ({
          title: i.title,
          url: i.url,
          publishedAt: i.publishedAt,
          summary: i.summary?.slice(0, 200),
          section: i.section,
          confidence: i.confidence,
        })),
        tokens,
        durationMs,
      })
    }

    return items
  } catch (err) {
    log.error(`AI ${depthLabel}列表失败`, { reason: err.message })
    return []
  }
}
