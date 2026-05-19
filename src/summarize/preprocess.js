/**
 * ============================================================
 * DeepSeek 预处理模块 — 研究助理阶段
 * ============================================================
 *
 * 职责：
 *   1. 把 items 转成受控长度的 modelItems（摘录截断）
 *   2. 构建 DeepSeek 预处理 prompt
 *   3. 调用 LLM（role=preprocess）输出中间 JSON
 *   4. 校验中间 JSON 基本结构
 *   5. 记录审计事件
 *
 * DeepSeek 角色限定：研究助理，不成稿、不润色、只整理证据
 */

import { callLLMForJsonWithMeta } from '../llm.js'

/** 默认最大输入条数 */
const DEFAULT_MAX_INPUT_ITEMS = 80
/** 默认每条摘录字符数 */
const DEFAULT_EXCERPT_CHARS = 1000
/** 默认最大聚类数 */
const DEFAULT_MAX_CLUSTERS = 12
/** 默认每个 cluster 最多 facts 数 */
const DEFAULT_MAX_FACTS_PER_CLUSTER = 5

/**
 * 截取正文摘录
 */
function excerptContent(content, maxChars) {
  if (!content) return ''
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars) + '…'
}

/**
 * 构建预处理用的精简 items
 */
function buildPreprocessItems(items, maxItems, excerptChars) {
  const limited = items.slice(0, maxItems)
  return limited.map((item, i) => ({
    id: i + 1,
    source: item.source || '',
    publishedAt: item.publishedAt || '',
    title: item.title || '',
    summary: item.summary || '',
    contentExcerpt: excerptContent(item.content || item.summary || '', excerptChars),
    url: item.url || '',
  }))
}

/**
 * 构建预处理 system prompt
 */
function buildPreprocessSystemPrompt(editorial = {}) {
  const excludeTopics = editorial.excludeTopics || []
  const interests = editorial.interests || []

  let extra = ''
  if (excludeTopics.length) {
    extra += `\n读者不关心的话题（标记为 drop 或 briefOnly）：${excludeTopics.join('、')}`
  }
  if (interests.length) {
    extra += `\n读者最关心的方向（优先提升重要性）：${interests.join('、')}`
  }

  return `你是新闻研究助理，不是主编。你的任务是把大量新闻素材整理成给主编用的案头材料。

不要写最终简报，不要润色，不要扩写，不要做最终结论。
只输出 JSON。
每个事实必须关联 itemId。
对弱相关、重复、娱乐体育、与读者兴趣无关的素材做降级或丢弃建议。
判断要克制，不编造，不猜测。${extra}`
}

/**
 * 构建预处理 user prompt
 */
function buildPreprocessUserPrompt(modelItems, pipelineConfig, config) {
  const maxClusters = pipelineConfig?.maxClusters || DEFAULT_MAX_CLUSTERS
  const maxFacts = pipelineConfig?.maxFactsPerCluster || DEFAULT_MAX_FACTS_PER_CLUSTER
  const excludeTopics = config.editorial?.excludeTopics || []
  const interests = config.editorial?.interests || []

  const itemsText = modelItems.map(item =>
    `[${item.id}] ${item.source} | ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary}
摘录: ${item.contentExcerpt}
URL: ${item.url}`
  ).join('\n\n---\n\n')

  return `请处理以下 ${modelItems.length} 条新闻素材，输出结构化中间 JSON。

${excludeTopics.length ? `读者排除话题：${excludeTopics.join('、')}。命中这些的直接 drop 或降 briefOnly。` : ''}
${interests.length ? `读者关注方向：${interests.join('、')}。相关的优先提升。` : ''}

返回 JSON（不要 markdown 围栏）：
{
  "clusters": [
    {
      "clusterId": "英文短标识",
      "title": "候选主线标题，不超过 20 字",
      "importanceHint": "high 或 medium",
      "reason": "为什么这组新闻值得关注，1-2句",
      "itemIds": [1, 4],
      "facts": [
        {"itemId": 1, "fact": "事实要点，不评价，40字内", "source": "来源名", "url": "https://..."}
      ],
      "whyItMayMatter": "可能的结构性影响，1-2句",
      "openQuestions": ["需要后续确认的问题"]
    }
  ],
  "briefCandidates": [
    {"itemId": 12, "region": "地区/领域", "summary": "一句话短讯素材，30字内", "reason": "相关但不足以展开"}
  ],
  "dropCandidates": [
    {"itemId": 20, "reason": "弱相关/重复/体育娱乐/不感兴趣"}
  ],
  "timelineCandidates": [
    {"time": "MM-DD HH:mm", "event": "事实事件描述", "itemId": 1}
  ]
}

约束：
- clusters 最多 ${maxClusters} 个，每个最多 ${maxFacts} 条 facts
- importanceHint 为 high 的最多 5 个
- 每个 item 最多出现在一个 cluster 中（如果在多个 cluster 中有关联，选最主要的）
- briefCandidates 最多 10 条
- dropCandidates 列出所有建议丢弃的 item
- 未出现在任何 cluster/brief/drop 中的 item，默认视为无特别价值
- 严格只输出 JSON，不输出任何解释文字

新闻素材：

${itemsText}`
}

/**
 * 校验中间 JSON 基本结构
 */
function validatePreprocessResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('预处理输出不是有效 JSON 对象')
  }
  if (!Array.isArray(result.clusters)) {
    result.clusters = []
  }
  if (!Array.isArray(result.briefCandidates)) {
    result.briefCandidates = []
  }
  if (!Array.isArray(result.dropCandidates)) {
    result.dropCandidates = []
  }
  if (!Array.isArray(result.timelineCandidates)) {
    result.timelineCandidates = []
  }

  // 校验每个 cluster 基本字段
  for (const c of result.clusters) {
    if (!Array.isArray(c.itemIds)) c.itemIds = []
    if (!Array.isArray(c.facts)) c.facts = []
    if (!Array.isArray(c.openQuestions)) c.openQuestions = []
  }

  return result
}

/**
 * DeepSeek 预处理主函数
 *
 * @param {Array}  items  - 新闻条目
 * @param {object} config - 主题配置（含 editorial 和 llmPipeline）
 * @param {object} [options]
 * @param {object} [options.auditor] - 审计记录器
 * @returns {Promise<object>} 预处理中间 JSON
 */
export async function preprocessItems(items, config, options = {}) {
  const auditor = options.auditor
  const pipelineConfig = config.llmPipeline?.preprocess || {}
  const maxItems = pipelineConfig.maxInputItems || DEFAULT_MAX_INPUT_ITEMS
  const excerptChars = pipelineConfig.itemExcerptChars || DEFAULT_EXCERPT_CHARS

  const modelItems = buildPreprocessItems(items, maxItems, excerptChars)

  if (auditor) {
    auditor.event('preprocess_input_prepared', {
      totalItems: items.length,
      modelItemsCount: modelItems.length,
      excerptChars,
    })
  }

  const systemPrompt = buildPreprocessSystemPrompt(config.editorial)
  const userPrompt = buildPreprocessUserPrompt(modelItems, pipelineConfig, config)

  const startMs = Date.now()
  const { result, tokens, model } = await callLLMForJsonWithMeta(systemPrompt, userPrompt, {
    role: 'preprocess',
    stage: 'preprocess',
  })
  const durationMs = Date.now() - startMs

  const validated = validatePreprocessResult(result)

  if (auditor) {
    auditor.event('preprocess_completed', {
      model,
      tokens,
      durationMs,
      clustersCount: validated.clusters.length,
      briefCandidatesCount: validated.briefCandidates.length,
      dropCandidatesCount: validated.dropCandidates.length,
      timelineCount: validated.timelineCandidates.length,
    })
  }

  return {
    result: validated,
    modelItems,
    meta: { model, tokens, durationMs },
  }
}
