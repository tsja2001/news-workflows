/**
 * ============================================================
 * 详情页提取 — 四种策略：readability / ai / auto / deep
 * ============================================================
 */

import pRetry from 'p-retry'
import { extractWithReadability } from '../extractor.js'
import { cleanHtml } from '../../utils/html-cleaner.js'
import { callLLMForJsonWithMeta } from '../../llm.js'
import { EXTRACT_DETAIL_SYSTEM, buildExtractDetailUserPrompt } from './prompts.js'
import { createLogger } from '../../utils/logger.js'

const MIN_CONTENT_LENGTH = 100

/**
 * Readability 提取
 * @param {string} html
 * @param {string} url
 * @returns {Promise<{ title: string, content: string, publishedAt: string, author: string } | null>}
 */
async function extractByReadability(html, url) {
  const result = extractWithReadability(html, url)
  if (!result) return null
  return {
    title: result.title || '',
    content: result.content || '',
    publishedAt: '',
    author: result.byline || '',
  }
}

/**
 * AI 提取正文
 * @param {string} html
 * @param {string} url
 * @param {number} retries
 * @returns {Promise<{ title: string, content: string, publishedAt: string, author: string }>}
 */
async function extractByAi(html, url, retries = 3) {
  const log = createLogger(`web/detail`)

  const { cleaned, originalLength, cleanedLength } = cleanHtml(html, { mode: 'article' })
  log.step('HTML 瘦身', { originalLength, cleanedLength })

  const userPrompt = buildExtractDetailUserPrompt(url, cleaned)
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'
  log.step('AI 提取正文', { model, htmlLength: cleanedLength })

  try {
    const { result: raw, tokens: aiTokens } = await pRetry(
      async () => {
        const { result, tokens } = await callLLMForJsonWithMeta(EXTRACT_DETAIL_SYSTEM, userPrompt)
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error(`AI 返回格式错误: 期望对象，收到 ${typeof result}`)
        }
        return { result, tokens }
      },
      {
        retries,
        minTimeout: 2000,
        factor: 2,
        onFailedAttempt: err => {
          log.warn('AI 提取正文重试', { attempt: err.attemptNumber, reason: err.message })
        },
      }
    )

    log.success('AI 提取成功', { length: (raw.content || '').length, preview: (raw.content || '').slice(0, 80).replace(/\n/g, ' ') })
    return {
      title: raw.title || '',
      content: raw.content || '',
      publishedAt: raw.publishedAt || '',
      author: raw.author || '',
      _tokens: aiTokens,
    }
  } catch (err) {
    log.warn('AI 提取正文失败', { reason: err.message })
    return { title: '', content: '', publishedAt: '', author: '' }
  }
}

/**
 * 详情页提取主函数
 *
 * @param {string} html - 页面 HTML
 * @param {string} url - 页面 URL
 * @param {'auto' | 'readability' | 'ai' | 'deep'} [strategy='auto']
 * @param {object} [options]
 * @param {object} [options.auditor] - 审计日志记录器
 * @returns {Promise<{ title: string, content: string, publishedAt: string, author: string, _strategy?: string, _readabilityLen?: number, _aiLen?: number, _tokens?: object }>}
 */
export async function extractDetail(html, url, strategy = 'auto', options = {}) {
  const log = createLogger(`web/detail`)

  if (strategy === 'readability') {
    const r = await extractByReadability(html, url)
    if (r && r.content.length >= MIN_CONTENT_LENGTH) {
      log.success('Readability 成功', { length: r.content.length, preview: r.content.slice(0, 80).replace(/\n/g, ' ') })
      return { ...r, _strategy: 'readability' }
    }
    log.warn('Readability 内容不足', { length: r?.content?.length ?? 0 })
    return { ...(r || { title: '', content: '', publishedAt: '', author: '' }), _strategy: 'readability' }
  }

  if (strategy === 'ai') {
    const result = await extractByAi(html, url)
    return { ...result, _strategy: 'ai' }
  }

  // auto: 先 readability，不行再 AI
  if (strategy === 'auto') {
    log.step('尝试 Readability')
    const r = await extractByReadability(html, url)
    if (r && r.content.length >= MIN_CONTENT_LENGTH) {
      log.success('Readability 成功', { length: r.content.length, preview: r.content.slice(0, 80).replace(/\n/g, ' ') })
      return { ...r, _strategy: 'readability' }
    }

    log.warn('Readability 内容不足，降级到 AI', { length: r?.content?.length ?? 0 })
    const aiResult = await extractByAi(html, url)
    return { ...aiResult, _strategy: 'ai' }
  }

  // deep: 两套都跑，取正文更长的结果
  if (strategy === 'deep') {
    log.step('深度提取：并行执行 Readability + AI')

    const [r, aiResult] = await Promise.all([
      extractByReadability(html, url),
      extractByAi(html, url),
    ])

    const rLen = r?.content?.length ?? 0
    const aiLen = aiResult?.content?.length ?? 0

    if (rLen >= aiLen) {
      log.success('深度提取：取 Readability（更长）', {
        readabilityLen: rLen,
        aiLen,
        preview: (r?.content || '').slice(0, 80).replace(/\n/g, ' '),
      })
      return { ...r, _strategy: 'deep_readability', _readabilityLen: rLen, _aiLen: aiLen }
    }

    log.success('深度提取：取 AI（更长）', {
      readabilityLen: rLen,
      aiLen,
      preview: (aiResult?.content || '').slice(0, 80).replace(/\n/g, ' '),
    })
    return { ...aiResult, _strategy: 'deep_ai', _readabilityLen: rLen, _aiLen: aiLen }
  }

  // fallback
  return { title: '', content: '', publishedAt: '', author: '', _strategy: 'unknown' }
}
