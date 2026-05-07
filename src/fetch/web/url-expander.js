/**
 * ============================================================
 * URL 展开模块 — 把 source 的 url/urls + pages 展开为最终抓取列表
 * ============================================================
 *
 * 支持：
 *   1. 单 url（向后兼容）和多 urls 数组
 *   2. {page} 模板分页展开
 *   3. 每个 URL 可带独立 hint
 *   4. 全局硬上限保护（最多 20 个 URL/source）
 */

/** 单个 source 最多展开的 URL 数量 */
const MAX_EXPANDED_URLS = 20

/**
 * 把 source 的 url/urls + pages 配置展开为最终要抓的 URL 列表
 *
 * @param {object} source - yaml 里单个 source 的配置
 * @param {string} [source.url] - 单 URL（老格式）
 * @param {Array<string|{url:string, hint?:string, pages?:number, pageStart?:number}>} [source.urls] - 多 URL（新格式）
 * @param {string} [source.hint] - 顶层默认提示
 * @param {number} [source.pages] - 顶层分页数
 * @param {number} [source.pageStart] - 分页起始值，默认 1
 * @returns {Array<{ url: string, hint: string, page: number | null }>}
 */
export function expandUrls(source) {
  const hasUrl = typeof source.url === 'string' && source.url.length > 0
  const hasUrls = Array.isArray(source.urls) && source.urls.length > 0

  // url 和 urls 互斥
  if (hasUrl && hasUrls) {
    throw new Error(`Source "${source.name}": 'url' 和 'urls' 互斥，只能有一个`)
  }
  if (!hasUrl && !hasUrls) {
    throw new Error(`Source "${source.name}": 必须配置 'url' 或 'urls'`)
  }

  // 顶层默认值
  const defaultHint = source.hint || ''
  const defaultPages = source.pages
  const defaultPageStart = source.pageStart ?? 1

  // 标准化为统一的 raw 数组
  const rawEntries = hasUrl
    ? [{ url: source.url, hint: defaultHint, pages: defaultPages, pageStart: defaultPageStart }]
    : source.urls.map(entry => {
        if (typeof entry === 'string') {
          return { url: entry, hint: defaultHint, pages: defaultPages, pageStart: defaultPageStart }
        }
        return {
          url: entry.url,
          hint: entry.hint || defaultHint,
          pages: entry.pages ?? defaultPages,
          pageStart: entry.pageStart ?? defaultPageStart,
        }
      })

  // 展开分页
  const expanded = []
  for (const entry of rawEntries) {
    const hasTemplate = entry.url.includes('{page}')

    if (hasTemplate) {
      // 有 {page} 必须有 pages
      if (entry.pages == null) {
        throw new Error(
          `Source "${source.name}": URL "${entry.url}" 包含 {page} 占位符但未配置 pages`
        )
      }
      if (entry.pages < 1) {
        throw new Error(
          `Source "${source.name}": pages 必须 >= 1，当前为 ${entry.pages}`
        )
      }

      for (let p = 0; p < entry.pages; p++) {
        const pageNum = entry.pageStart + p
        expanded.push({
          url: entry.url.replace(/\{page\}/g, String(pageNum)),
          hint: entry.hint,
          page: pageNum,
        })
      }
    } else {
      // 没有 {page} 但有 pages → 报错
      if (entry.pages != null) {
        throw new Error(
          `Source "${source.name}": URL "${entry.url}" 不含 {page} 占位符，不能配置 pages`
        )
      }
      expanded.push({
        url: entry.url,
        hint: entry.hint,
        page: null,
      })
    }
  }

  // 总数上限保护
  if (expanded.length > MAX_EXPANDED_URLS) {
    throw new Error(
      `Source "${source.name}": 展开后共 ${expanded.length} 个 URL，超过上限 ${MAX_EXPANDED_URLS}。请减少 pages 或 urls 数量`
    )
  }

  return expanded
}
