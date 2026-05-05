/**
 * ============================================================
 * API 适配器 — 通用 JSON API → NewsItem 映射
 * ============================================================
 *
 * 不为任何具体 API 写专属代码，保持通用性。
 * 通过 yaml 的 responseShape 配置完成字段映射。
 *
 * yaml 示例：
 *   - name: NewsAPI - Iran
 *     type: api
 *     endpoint: "https://newsapi.org/v2/everything"
 *     method: GET
 *     params:
 *       q: "Iran sanctions"
 *       apiKey: "${NEWSAPI_KEY}"
 *     responseShape:
 *       itemsPath: "articles"
 *       fields:
 *         title: "title"
 *         url: "url"
 *         publishedAt: "publishedAt"
 *         summary: "description"
 *         source: "source.name"
 */

import { request } from 'undici'

const USER_AGENT =
  'Mozilla/5.0 (compatible; NewsBriefBot/1.0; +https://github.com/news-workflows)'

/**
 * 按点号路径从对象中取值
 * "source.name" → obj.source.name
 * @param {object} obj
 * @param {string} path
 * @returns {string}
 */
export function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj) ?? ''
}

/**
 * 构建查询字符串
 * @param {object} params
 * @returns {string}
 */
export function buildQuery(params) {
  if (!params) return ''
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

/**
 * 从 responseShape.itemsPath 取出数组
 * itemsPath 如 "articles" 或 "data.news"
 * @param {object} data - API 返回的 JSON
 * @param {string} itemsPath
 * @returns {any[]}
 */
export function getItems(data, itemsPath) {
  const arr = itemsPath ? getByPath(data, itemsPath) : data
  if (!Array.isArray(arr)) {
    throw new Error(`itemsPath "${itemsPath}" 未找到数组，得到的类型: ${typeof arr}`)
  }
  return arr
}

/**
 * 将 API 条目映射为 NewsItem
 * @param {any} rawItem
 * @param {object} fields - yaml 里的 responseShape.fields
 * @param {string} sourceName
 * @returns {import('./types.js').NewsItem}
 */
function mapToNewsItem(rawItem, fields, sourceName) {
  return {
    title: fields.title ? getByPath(rawItem, fields.title) : '',
    url: fields.url ? getByPath(rawItem, fields.url) : '',
    source: fields.source ? getByPath(rawItem, fields.source) : sourceName,
    publishedAt: fields.publishedAt ? getByPath(rawItem, fields.publishedAt) : new Date().toISOString(),
    summary: fields.summary ? getByPath(rawItem, fields.summary) : '',
  }
}

/**
 * 从通用 JSON API 抓取新闻
 *
 * @param {object} sourceConfig - yaml 配置
 * @param {string} sourceConfig.name
 * @param {string} sourceConfig.endpoint - API URL
 * @param {string} [sourceConfig.method='GET']
 * @param {object} [sourceConfig.params]
 * @param {object} sourceConfig.responseShape
 * @param {string} sourceConfig.responseShape.itemsPath
 * @param {object} sourceConfig.responseShape.fields
 * @param {object} [options]
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchFromApi(sourceConfig, options = {}) {
  const endpoint = sourceConfig.endpoint
  const method = sourceConfig.method || 'GET'
  const { responseShape } = sourceConfig

  if (!responseShape?.itemsPath) {
    console.error(`[api] ${sourceConfig.name} 缺少 responseShape.itemsPath`)
    return []
  }

  try {
    const url = endpoint + buildQuery(sourceConfig.params)

    const { body, statusCode } = await request(url, {
      method,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirections: 3,
      timeout: 15000,
    })

    if (statusCode >= 400) {
      throw new Error(`HTTP ${statusCode}`)
    }

    const data = await body.json()
    const rawItems = getItems(data, responseShape.itemsPath)
    const fields = responseShape.fields || {}

    return rawItems.map(raw => mapToNewsItem(raw, fields, sourceConfig.name))
  } catch (err) {
    console.error(`[api] ${sourceConfig.name} 失败: ${err.message}`)
    return []
  }
}
