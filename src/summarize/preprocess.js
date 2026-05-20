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
import { createLogger } from '../utils/logger.js'

/** 默认最大输入条数 */
const DEFAULT_MAX_INPUT_ITEMS = 80
/** 默认每条摘录字符数 */
const DEFAULT_EXCERPT_CHARS = 1000
/** 默认最大聚类数 */
const DEFAULT_MAX_CLUSTERS = 12
/** 默认每个 cluster 最多 facts 数 */
const DEFAULT_MAX_FACTS_PER_CLUSTER = 5
/** 默认编辑包最大中文字符数 */
const DEFAULT_MAX_PACKET_CHARS = 8000
/** 默认编辑包最大主线数 */
const DEFAULT_MAX_DEVELOPMENTS = 6
/** 默认编辑包最大短讯数 */
const DEFAULT_MAX_BRIEFS = 6

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
function buildPreprocessSystemPrompt(editorial = {}, outputMode = 'clusters') {
  const excludeTopics = editorial.excludeTopics || []
  const interests = editorial.interests || []

  let extra = ''
  if (excludeTopics.length) {
    extra += `\n读者不关心的话题（标记为 drop 或 briefOnly）：${excludeTopics.join('、')}`
  }
  if (interests.length) {
    extra += `\n读者最关心的方向（优先提升重要性）：${interests.join('、')}`
  }

  const modeLine = outputMode === 'editorialPacket'
    ? '\n你现在要输出 editorialPacket：这是给最终主编直接定稿用的压缩编辑包。'
    : ''

  return `你是新闻研究助理，不是主编。你的任务是把大量新闻素材整理成给主编用的案头材料。${modeLine}

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
 * 构建 editorialPacket 预处理 user prompt
 */
function buildEditorialPacketUserPrompt(modelItems, pipelineConfig, config) {
  const maxDevelopments = pipelineConfig?.maxDevelopments || DEFAULT_MAX_DEVELOPMENTS
  const maxFacts = pipelineConfig?.maxFactsPerDevelopment || pipelineConfig?.maxFactsPerCluster || DEFAULT_MAX_FACTS_PER_CLUSTER
  const maxBriefs = pipelineConfig?.maxBriefs || DEFAULT_MAX_BRIEFS
  const maxPacketChars = pipelineConfig?.maxPacketChars || DEFAULT_MAX_PACKET_CHARS
  const excludeTopics = config.editorial?.excludeTopics || []
  const interests = config.editorial?.interests || []
  const persona = config.editorial?.persona || ''
  const tone = config.editorial?.tone || ''

  const itemsText = modelItems.map(item =>
    `[${item.id}] ${item.source} | ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary}
摘录: ${item.contentExcerpt}
URL: ${item.url}`
  ).join('\n\n---\n\n')

  return `请处理以下 ${modelItems.length} 条新闻素材，输出给最终主编使用的 editorialPacket JSON。

最终主编人设：${persona || '私人内参编辑'}
最终语气要求：${tone || '口语化、有判断'}
${excludeTopics.length ? `读者排除话题：${excludeTopics.join('、')}。命中这些的直接丢弃或降为短讯。` : ''}
${interests.length ? `读者关注方向：${interests.join('、')}。相关的优先进入主线。` : ''}

你的职责：
- 阅读原始素材，完成筛选、压缩、去重、合并同类报道
- 剔除弱相关、重复、体育娱乐、低价值素材
- 判断哪些新闻值得展开，并给出推荐排序
- 每条主线提取 2-${maxFacts} 条关键事实
- 每条事实必须保留 source、url、itemId
- 输出可直接交给 Claude 定稿的 editorialPacket，总长度尽量不超过 ${maxPacketChars} 个中文字符

返回 JSON（不要 markdown 围栏）：
{
  "meta": {
    "sourceItemCount": ${modelItems.length},
    "selectedItemCount": 0,
    "droppedItemCount": 0,
    "packetCharCount": 0
  },
  "coreThesis": "本期最大主线和判断，80-150字",
  "recommendedOrder": ["主线短标题1", "主线短标题2"],
  "keyDevelopmentsDraft": [
    {
      "title": "短标题，不超过25字",
      "importance": "high 或 medium",
      "whatHappened": "事实草稿，80-140字",
      "whyItMatters": "重要性草稿，80-140字",
      "suggestedEditorTake": "给 Claude 的观点建议，60-120字",
      "evidence": [
        {"itemId": 1, "source": "Reuters", "url": "https://...", "fact": "关键事实，40字内"}
      ]
    }
  ],
  "briefsDraft": [
    {"region": "地区/领域", "summary": "短讯草稿，40-80字", "evidenceItemIds": [12]}
  ],
  "timelineDraft": [
    {"time": "MM-DD HH:mm", "event": "事件描述", "itemId": 1}
  ],
  "signals": ["值得关注的信号"],
  "risks": ["风险判断"],
  "unknowns": ["关键未知问题"],
  "droppedSummary": [
    {"reason": "重复/低价值/偏题", "count": 12}
  ]
}

约束：
- keyDevelopmentsDraft 最多 ${maxDevelopments} 条，high importance 最多 5 条
- briefsDraft 最多 ${maxBriefs} 条
- 每条 keyDevelopment 至少 2 条 evidence；如果确实只有 1 条来源，必须在 unknowns 说明证据不足
- 每个 item 最多作为一个主线的核心证据
- selectedItemCount 统计被 evidence 或 briefsDraft 引用的去重 item 数
- droppedItemCount 统计 droppedSummary count 总和；无法精确时按 sourceItemCount - selectedItemCount 估算
- packetCharCount 填你输出 JSON 的估算字符数
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

function uniqueNumberArray(values) {
  return Array.from(new Set((values || [])
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v > 0)))
}

function truncateText(value, maxChars) {
  if (typeof value !== 'string') return ''
  if (value.length <= maxChars) return value
  return value.slice(0, Math.max(0, maxChars - 1)) + '…'
}

function refreshPacketMeta(packet, maxPacketChars) {
  const stats = getEditorialPacketStats(packet)
  packet.meta.sourceItemCount = Number(packet.meta.sourceItemCount) || stats.sourceItemCount
  packet.meta.selectedItemCount = stats.selectedItemCount
  packet.meta.droppedItemCount = stats.droppedItemCount || Math.max(0, packet.meta.sourceItemCount - stats.selectedItemCount)
  packet.meta.maxPacketChars = maxPacketChars
  packet.meta.packetCharCount = JSON.stringify(packet).length
  packet.meta.packetOverLimit = packet.meta.packetCharCount > maxPacketChars
}

function packetLength(packet) {
  return JSON.stringify(packet).length
}

function trimPacketText(packet, limits) {
  packet.coreThesis = truncateText(packet.coreThesis, limits.coreThesis)
  packet.recommendedOrder = (packet.recommendedOrder || [])
    .slice(0, limits.recommendedOrder)
    .map(v => truncateText(v, 30))

  for (const d of packet.keyDevelopmentsDraft || []) {
    d.title = truncateText(d.title, 25)
    d.whatHappened = truncateText(d.whatHappened, limits.developmentText)
    d.whyItMatters = truncateText(d.whyItMatters, limits.developmentText)
    d.suggestedEditorTake = truncateText(d.suggestedEditorTake, limits.editorTake)
    d.evidence = (d.evidence || []).slice(0, limits.evidencePerDevelopment)
    for (const e of d.evidence) {
      e.source = truncateText(e.source, 40)
      e.url = truncateText(e.url, 180)
      e.fact = truncateText(e.fact, limits.fact)
    }
  }

  for (const b of packet.briefsDraft || []) {
    b.region = truncateText(b.region, 20)
    b.summary = truncateText(b.summary, limits.brief)
  }
  for (const t of packet.timelineDraft || []) {
    t.time = truncateText(t.time, 20)
    t.event = truncateText(t.event, limits.timeline)
  }

  packet.signals = (packet.signals || []).map(v => truncateText(v, limits.listItem))
  packet.risks = (packet.risks || []).map(v => truncateText(v, limits.listItem))
  packet.unknowns = (packet.unknowns || []).map(v => truncateText(v, limits.listItem))
}

/**
 * 模型偶尔会超出 maxPacketChars；这里做保守压缩，优先保留主线和 evidence。
 */
function compactEditorialPacketToLimit(packet, maxPacketChars) {
  if (packetLength(packet) <= maxPacketChars) return packet

  const passes = [
    { coreThesis: 240, developmentText: 180, editorTake: 140, fact: 80, brief: 90, timeline: 90, listItem: 90, recommendedOrder: 6, evidencePerDevelopment: 3 },
    { coreThesis: 180, developmentText: 130, editorTake: 100, fact: 60, brief: 70, timeline: 70, listItem: 70, recommendedOrder: 5, evidencePerDevelopment: 3 },
    { coreThesis: 120, developmentText: 90, editorTake: 70, fact: 45, brief: 50, timeline: 50, listItem: 50, recommendedOrder: 4, evidencePerDevelopment: 2 },
  ]

  for (const limits of passes) {
    trimPacketText(packet, limits)
    if (packetLength(packet) <= maxPacketChars) return packet
  }

  const trimArray = (name, minLength = 0) => {
    while ((packet[name]?.length || 0) > minLength && packetLength(packet) > maxPacketChars) {
      packet[name].pop()
    }
  }

  trimArray('timelineDraft', 0)
  trimArray('signals', 0)
  trimArray('risks', 0)
  trimArray('unknowns', 0)
  trimArray('briefsDraft', 0)
  trimArray('recommendedOrder', 1)
  trimArray('keyDevelopmentsDraft', 1)

  while (packetLength(packet) > maxPacketChars) {
    const d = packet.keyDevelopmentsDraft?.[0]
    if (!d) break
    if ((d.evidence?.length || 0) > 1) {
      d.evidence.pop()
      continue
    }

    packet.coreThesis = truncateText(packet.coreThesis, 80)
    d.whatHappened = truncateText(d.whatHappened, 60)
    d.whyItMatters = truncateText(d.whyItMatters, 60)
    d.suggestedEditorTake = truncateText(d.suggestedEditorTake, 50)
    if (d.evidence?.[0]) d.evidence[0].fact = truncateText(d.evidence[0].fact, 35)
    break
  }

  return packet
}

/**
 * 统计 editorialPacket 的规模信息
 */
export function getEditorialPacketStats(packet) {
  const selectedIds = new Set()
  for (const d of packet.keyDevelopmentsDraft || []) {
    for (const e of d.evidence || []) {
      if (e.itemId) selectedIds.add(Number(e.itemId))
    }
  }
  for (const b of packet.briefsDraft || []) {
    for (const id of b.evidenceItemIds || []) {
      if (id) selectedIds.add(Number(id))
    }
  }
  const droppedItemCount = (packet.droppedSummary || [])
    .reduce((sum, d) => sum + (Number(d.count) || 0), 0)

  return {
    sourceItemCount: Number(packet.meta?.sourceItemCount) || 0,
    selectedItemCount: selectedIds.size,
    droppedItemCount,
    packetCharCount: JSON.stringify(packet).length,
    keyDevelopmentsDraftCount: packet.keyDevelopmentsDraft?.length || 0,
    briefsDraftCount: packet.briefsDraft?.length || 0,
    timelineDraftCount: packet.timelineDraft?.length || 0,
  }
}

/**
 * 校验 editorialPacket 中间 JSON 基本结构
 */
export function validateEditorialPacketResult(result, maxPacketChars = DEFAULT_MAX_PACKET_CHARS) {
  if (!result || typeof result !== 'object') {
    throw new Error('预处理 editorialPacket 输出不是有效 JSON 对象')
  }

  if (!result.meta || typeof result.meta !== 'object') result.meta = {}
  if (typeof result.coreThesis !== 'string') result.coreThesis = ''
  if (!Array.isArray(result.recommendedOrder)) result.recommendedOrder = []
  if (!Array.isArray(result.keyDevelopmentsDraft)) result.keyDevelopmentsDraft = []
  if (!Array.isArray(result.briefsDraft)) result.briefsDraft = []
  if (!Array.isArray(result.timelineDraft)) result.timelineDraft = []
  if (!Array.isArray(result.signals)) result.signals = []
  if (!Array.isArray(result.risks)) result.risks = []
  if (!Array.isArray(result.unknowns)) result.unknowns = []
  if (!Array.isArray(result.droppedSummary)) result.droppedSummary = []

  result.recommendedOrder = result.recommendedOrder.filter(v => typeof v === 'string')
  result.signals = result.signals.filter(v => typeof v === 'string')
  result.risks = result.risks.filter(v => typeof v === 'string')
  result.unknowns = result.unknowns.filter(v => typeof v === 'string')

  for (const d of result.keyDevelopmentsDraft) {
    if (typeof d.title !== 'string') d.title = ''
    if (d.importance !== 'high' && d.importance !== 'medium') d.importance = 'medium'
    if (typeof d.whatHappened !== 'string') d.whatHappened = ''
    if (typeof d.whyItMatters !== 'string') d.whyItMatters = ''
    if (typeof d.suggestedEditorTake !== 'string') d.suggestedEditorTake = ''
    if (!Array.isArray(d.evidence)) d.evidence = []
    d.evidence = d.evidence.map(e => ({
      itemId: Number(e.itemId) || 0,
      source: typeof e.source === 'string' ? e.source : '',
      url: typeof e.url === 'string' ? e.url : '',
      fact: typeof e.fact === 'string' ? e.fact : '',
    })).filter(e => e.itemId > 0 || e.fact)
  }

  for (const b of result.briefsDraft) {
    if (typeof b.region !== 'string') b.region = ''
    if (typeof b.summary !== 'string') b.summary = ''
    b.evidenceItemIds = uniqueNumberArray(b.evidenceItemIds)
  }

  for (const t of result.timelineDraft) {
    if (typeof t.time !== 'string') t.time = ''
    if (typeof t.event !== 'string') t.event = ''
    t.itemId = Number(t.itemId) || 0
  }

  for (const d of result.droppedSummary) {
    if (typeof d.reason !== 'string') d.reason = ''
    d.count = Number(d.count) || 0
  }

  compactEditorialPacketToLimit(result, maxPacketChars)
  refreshPacketMeta(result, maxPacketChars)

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
  const log = createLogger('preprocess')
  const pipelineConfig = config.llmPipeline?.preprocess || {}
  const maxItems = pipelineConfig.maxInputItems || DEFAULT_MAX_INPUT_ITEMS
  const excerptChars = pipelineConfig.itemExcerptChars || DEFAULT_EXCERPT_CHARS
  const outputMode = pipelineConfig.outputMode || 'clusters'
  const maxPacketChars = pipelineConfig.maxPacketChars || DEFAULT_MAX_PACKET_CHARS

  const modelItems = buildPreprocessItems(items, maxItems, excerptChars)
  log.step('预处理输入准备完成', {
    totalItems: items.length,
    modelItems: modelItems.length,
    outputMode,
    excerptChars,
    maxPacketChars,
  })

  if (auditor) {
    auditor.event('preprocess_input_prepared', {
      totalItems: items.length,
      modelItemsCount: modelItems.length,
      excerptChars,
      outputMode,
    })
  }

  const systemPrompt = buildPreprocessSystemPrompt(config.editorial, outputMode)
  const userPrompt = outputMode === 'editorialPacket'
    ? buildEditorialPacketUserPrompt(modelItems, pipelineConfig, config)
    : buildPreprocessUserPrompt(modelItems, pipelineConfig, config)

  const startMs = Date.now()
  const { result, tokens, model } = await callLLMForJsonWithMeta(systemPrompt, userPrompt, {
    role: 'preprocess',
    stage: 'preprocess',
  })
  const durationMs = Date.now() - startMs
  log.success('预处理模型完成', {
    model,
    tokens: (tokens.input || 0) + (tokens.output || 0),
    ms: durationMs,
  })

  const validated = outputMode === 'editorialPacket'
    ? validateEditorialPacketResult(result, maxPacketChars)
    : validatePreprocessResult(result)
  const packetStats = outputMode === 'editorialPacket'
    ? getEditorialPacketStats(validated)
    : null
  log.success('预处理结果校验完成', {
    outputMode,
    clusters: validated.clusters?.length || 0,
    briefCandidates: validated.briefCandidates?.length || 0,
    dropCandidates: validated.dropCandidates?.length || 0,
    packetChars: packetStats?.packetChars,
  })

  if (auditor) {
    auditor.event('preprocess_completed', {
      model,
      tokens,
      durationMs,
      outputMode,
      clustersCount: validated.clusters?.length || 0,
      briefCandidatesCount: validated.briefCandidates?.length || 0,
      dropCandidatesCount: validated.dropCandidates?.length || 0,
      timelineCount: validated.timelineCandidates?.length || validated.timelineDraft?.length || 0,
      editorialPacket: packetStats,
    })
  }

  return {
    result: validated,
    modelItems,
    meta: { role: 'preprocess', stage: 'preprocess', model, tokens, durationMs },
  }
}
