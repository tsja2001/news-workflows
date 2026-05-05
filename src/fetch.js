/**
 * ============================================================
 * 新闻抓取与过滤模块 — RSS 源拉取 + 多级过滤管线
 * ============================================================
 *
 * 这是整个工作流的数据获取层。处理流程分为5步：
 *   1. 并发拉取所有 RSS 源（单源失败不影响其他源）
 *   2. 时间窗口过滤（丢弃太旧的新闻）
 *   3. 关键词过滤（标题或摘要中命中关键词才保留）
 *   4. URL 去重（同一篇文章只保留一次）
 *   5. 按时间倒序排列，截取前 N 条
 *
 * 关键设计：
 *   - 所有新闻源的数据统一转为 {title, url, source, publishedAt, summary} 格式
 *   - 未来加新的源类型（API、爬虫），只要产出同格式数据，下游代码不用改
 */

import Parser from 'rss-parser'

// 创建 RSS 解析器，设置15秒超时防止某个源卡住
const parser = new Parser({ timeout: 15000 })

/**
 * 拉取单个 RSS 源，转为统一格式
 *
 * 单源失败时返回空数组而不是抛出异常，
 * 这样其他源的结果不受影响（鲁棒性设计）。
 *
 * @param {object} source - { name: "源名称", url: "RSS地址" }
 * @returns {Promise<Array>} 统一格式的新闻条目数组
 */
async function fetchOneSource(source) {
  try {
    // 解析 RSS feed
    const feed = await parser.parseURL(source.url)

    // 将 RSS 条目转为统一的内部格式
    // 不同RSS源的字段名可能不同，这里做了兼容处理
    return feed.items.map(item => ({
      title: item.title || '',
      url: item.link || '',                          // RSS里链接字段叫 link
      source: source.name,                           // 标记来自哪个源
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),  // 发布时间，兼容不同字段名
      summary: item.contentSnippet || item.content || '',  // 内容摘要，按优先级取
    }))
  } catch (err) {
    // 单个源失败只打印错误，不中断整体流程
    console.error(`[fetch] ${source.name} failed: ${err.message}`)
    return []
  }
}

/**
 * 主抓取+过滤流程
 * @param {object} config - 主题配置对象（来自 YAML）
 * @returns {Promise<Array>} 过滤去重后的新闻条目
 */
export async function fetchAndFilter(config) {
  // ── 步骤 1：并发拉取所有源 ────────────────────────────────
  // Promise.all 让多个源同时请求，比逐个请求快很多
  // .flat() 把 [[item1, item2], [item3]] 拍平成 [item1, item2, item3]
  const allItems = (await Promise.all(
    config.sources.map(fetchOneSource)
  )).flat()

  // ── 步骤 2：时间窗口过滤 ──────────────────────────────────
  // 计算截止时间：当前时间 - 配置中指定的回溯小时数
  // 例如 lookbackHours=36，就只保留最近36小时内的新闻
  const cutoff = Date.now() - config.filter.lookbackHours * 3600 * 1000
  const recent = allItems.filter(item =>
    new Date(item.publishedAt).getTime() > cutoff
  )

  // ── 步骤 3：关键词过滤 ────────────────────────────────────
  // 在标题和摘要中查找配置的关键词（大小写不敏感）
  // 命中任意一个关键词就保留
  const keywords = config.filter.keywords.map(k => k.toLowerCase())
  const matched = recent.filter(item => {
    const text = `${item.title} ${item.summary}`.toLowerCase()
    return keywords.some(k => text.includes(k))
  })

  // ── 步骤 4：URL 去重 ──────────────────────────────────────
  // 用 Set 记录已见过的 URL，同一篇报道只保留第一次出现的
  const seen = new Set()
  const deduped = matched.filter(item => {
    if (!item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })

  // ── 步骤 5：排序 + 截断 ───────────────────────────────────
  // 按发布时间倒序（最新的在前），然后只取前 N 条
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  return deduped.slice(0, config.filter.maxItems)
}
