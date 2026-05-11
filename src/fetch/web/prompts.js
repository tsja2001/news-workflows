/**
 * ============================================================
 * AI Prompt 集中管理 — type:web 适配器的所有 prompt
 * ============================================================
 *
 * 所有 AI 调用 prompt 集中在此，不分散到各模块。
 */

/** 从列表页 HTML 提取新闻链接（普通模式） */
export const EXTRACT_LIST_SYSTEM = `你是一个网页内容提取助手。给你一段新闻列表页的 HTML，你需要识别其中所有新闻条目。

返回严格的 JSON 数组，不要 markdown 代码块，不要任何解释：
[
  {
    "title": "新闻标题",
    "url": "新闻详情页的相对或绝对 URL",
    "publishedAt": "ISO8601 时间或空字符串",
    "summary": "如果列表页有摘要则填，否则空字符串"
  }
]

约束：
- 只提取真正的新闻条目，排除导航、推荐、广告
- 如果识别不出 publishedAt，留空字符串（不要瞎猜）
- 如果一条都识别不出，返回空数组 []
- title 不要包含多余的"分类标签"前缀`

/** 从列表页 HTML 提取新闻链接（深度模式）
 *
 * 关键变化：
 * - 强调"穷尽"而非"识别"
 * - 引入 confidence 字段，让 AI 标记不确定性
 * - 引入 section 字段，记录条目来源区块
 * - 明确告诉 AI 不要自行限制数量
 */
export const LIST_EXTRACT_DEEP_SYSTEM = `你是一个网页内容提取助手，任务是从新闻列表页 HTML 中找出**所有**可能的新闻条目。

**请尽可能穷尽地列出**，包括：
- 主列表中的新闻
- 侧栏的"热门"、"推荐"、"编辑精选"
- 页面中段的专题区、深度报道
- 页脚之上的"更多新闻"、"相关阅读"区块
- 任何 <a> 标签指向新闻详情页的链接

返回严格的 JSON 数组，不要 markdown，不要解释：
[
  {
    "title": "新闻标题",
    "url": "新闻详情页 URL（相对或绝对）",
    "publishedAt": "ISO8601 时间或空字符串",
    "summary": "如果列表页有摘要则填，否则空字符串",
    "section": "这条新闻所在的版块/分类（如'头条'/'专题'/'侧栏推荐'/空字符串）",
    "confidence": "high | medium | low"
  }
]

confidence 判定：
- high: 明确是新闻条目，有标题和链接
- medium: 看起来像新闻但不确定（比如可能是专题页入口）
- low: 链接文字短或不像新闻标题，但属于内容区

**排除**：
- 顶部主导航、用户菜单、订阅按钮、登录链接
- 页脚版权、关于我们、联系方式
- 社交媒体分享按钮
- 广告、订阅推广

**不要去重、不要排序、不要筛选数量上限**——把所有候选都列出来，后续会自行处理。

**找不到合适条目时返回空数组 []**。`

/**
 * @param {string} currentUrl
 * @param {string} cleanedHtml
 * @param {string} [hint]
 * @param {object} [options]
 * @param {string} [options.section] - 当前页面的区块名
 * @returns {string}
 */
export function buildExtractListUserPrompt(currentUrl, cleanedHtml, hint, options = {}) {
  let prompt = `URL: ${currentUrl}\n`
  if (hint) prompt += `提示: ${hint}\n`
  if (options.maxItems) prompt += `最多提取 ${options.maxItems} 条\n`
  if (options.section) prompt += `当前页面属于: ${options.section}\n`
  prompt += `\nHTML:\n${cleanedHtml}`
  return prompt
}

/** 从详情页 HTML 提取正文 */
export const EXTRACT_DETAIL_SYSTEM = `你是一个新闻正文提取助手。给你一段新闻详情页的 HTML，提取以下字段：

返回严格的 JSON 对象，不要 markdown，不要解释：
{
  "title": "文章标题",
  "content": "完整正文（纯文本，保留段落分隔）",
  "publishedAt": "ISO8601 时间或空字符串",
  "author": "作者或空字符串"
}

约束：
- content 不要包含相关推荐、广告、评论区内容
- 段落之间用换行符分隔
- 如果某字段不确定，留空字符串`

/**
 * @param {string} url
 * @param {string} cleanedHtml
 * @returns {string}
 */
export function buildExtractDetailUserPrompt(url, cleanedHtml) {
  return `URL: ${url}\n\nHTML:\n${cleanedHtml}`
}
