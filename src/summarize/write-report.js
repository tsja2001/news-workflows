/**
 * ============================================================
 * Claude 最终成稿模块 — 主编阶段
 * ============================================================
 *
 * 职责：
 *   1. 基于 DeepSeek 中间稿和精简原始素材构建 Claude prompt
 *   2. 调用 LLM（role=writer）生成最终 report JSON
 *   3. 输出与 output.js 完全兼容的 report 结构
 *
 * Claude 角色限定：最终主编，可以推翻研究助理排序
 */

import { callLLMForJsonWithMeta } from '../llm.js'
import { createLogger } from '../utils/logger.js'

/** 默认 Claude 最多读取的原始素材数 */
const DEFAULT_MAX_SOURCE_ITEMS = 35
/** 默认 writer 输入模式 */
const DEFAULT_INPUT_MODE = 'clusters'

const DEFAULT_PERSONA = '资深国际新闻主编'
const DEFAULT_TONE = '专业克制，有判断但不情绪化'

/**
 * 从中间稿中提取涉及的 itemId 集合
 */
function collectReferencedItemIds(prepResult) {
  const ids = new Set()
  for (const c of prepResult.clusters || []) {
    for (const id of c.itemIds || []) ids.add(id)
    for (const f of c.facts || []) {
      if (f.itemId) ids.add(f.itemId)
    }
  }
  for (const b of prepResult.briefCandidates || []) {
    if (b.itemId) ids.add(b.itemId)
  }
  return ids
}

/**
 * 构建给 Claude 的精简原始素材包（只包含被引用的 item）
 */
function buildWriterSourceItems(modelItems, prepResult, maxItems) {
  const referencedIds = collectReferencedItemIds(prepResult)

  // 优先取被引用的 item，如果不够 maxItems 再补其他
  const referenced = modelItems.filter(m => referencedIds.has(m.id))
  const remaining = modelItems.filter(m => !referencedIds.has(m.id))
  const selected = [...referenced, ...remaining].slice(0, maxItems)

  return selected.map(item =>
    `[${item.id}] ${item.source} | ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary}
URL: ${item.url}`
  ).join('\n\n')
}

function countSourceItemsText(sourceItemsText) {
  if (!sourceItemsText) return 0
  return sourceItemsText.split('\n\n').filter(Boolean).length
}

/**
 * 构建 writer prompt 输入包
 */
export function buildWriterPromptInput(modelItems, prepResult, config) {
  const pipelineConfig = config.llmPipeline?.writer || {}
  const inputMode = pipelineConfig.inputMode || DEFAULT_INPUT_MODE
  const includeRawSourceItems = pipelineConfig.includeRawSourceItems === true
  const maxSourceItems = pipelineConfig.maxSourceItems || DEFAULT_MAX_SOURCE_ITEMS

  const sourceItemsText = includeRawSourceItems
    ? buildWriterSourceItems(modelItems, prepResult, maxSourceItems)
    : ''
  const prepJson = inputMode === 'editorialPacket'
    ? JSON.stringify(prepResult)
    : JSON.stringify(prepResult, null, 2)

  return {
    inputMode,
    includeRawSourceItems,
    maxSourceItems,
    sourceItemsText,
    sourceItemsCount: countSourceItemsText(sourceItemsText),
    prepJson,
    inputCharCount: prepJson.length + sourceItemsText.length,
    targetOutputChars: pipelineConfig.targetOutputChars || 0,
    maxInputOutputRatio: pipelineConfig.maxInputOutputRatio || 0,
  }
}

/**
 * 构建 Claude 的 system prompt
 */
function buildWriterSystemPrompt(editorial = {}) {
  const persona = editorial.persona || DEFAULT_PERSONA
  const tone = editorial.tone || DEFAULT_TONE
  const mergeContext = editorial.mergeContextIntoOverview !== false

  return `你是${persona}。你是这份私人内参的最终主编，负责把案头主任准备好的编辑包定稿。

你的工作不是替主流媒体复述新闻，而是替读者把事情吃透、说清。

要做的几件事：
1. **最终定稿**：案头主任已经完成筛选、压缩和证据整理。你负责标题、排序、表达和最终判断。
2. **替他过滤**：读者明确告诉过你他不关心哪些话题。即使素材里出现，也不要塞进 keyDevelopments；可以放到 briefs 一行带过，或者直接不提。
3. **替他判断**：每条变化下面除了"发生了什么"、"为什么重要"，再加一句"编辑怎么看"——你的立场、判断、提醒。可以口语，可以辛辣，但要有素材依据，不能凭空发挥。
4. **不装客观**：这份简报是给一个人看的，不是发稿。少用"或将"、"可能"、"有观察人士认为"这种官话；多用"说白了"、"我看…"、"别看…其实…"这种直接判断。

写作风格：${tone}

硬性规则：
- 只基于 editorialPacket 或提供的素材，绝不编造事实或细节
- 不新增来源、数字、人物、时间、地点
- 不重新扩展素材范围，不做大范围事实重筛
- 中文输出
- 严格按 JSON schema 返回，不要带任何额外解释或 markdown 围栏（不要用 \`\`\`json）
- 字段没内容就返回空数组/空字符串，不要凑数`
}

/**
 * 构建 Claude 的 user prompt
 */
export function buildWriterUserPrompt(promptInput, prepResult, config) {
  const editorial = config.editorial || {}
  const pipelineConfig = config.llmPipeline?.writer || {}
  const interests = editorial.interests || []
  const excludeTopics = editorial.excludeTopics || []
  const tldrEnabled = editorial.tldr?.enabled !== false
  const tldrMax = editorial.tldr?.maxItems ?? 5
  const kdHigh = editorial.keyDevelopmentsLimit?.high ?? 5
  const kdMedium = editorial.keyDevelopmentsLimit?.medium ?? 3
  const lowHandling = editorial.lowAttentionHandling || 'brief'
  const mergeContext = editorial.mergeContextIntoOverview !== false

  const interestsBlock = interests.length
    ? `\n读者最关心的方向（优先呈现这些）：\n${interests.map(i => `- ${i}`).join('\n')}\n`
    : ''
  const excludeBlock = excludeTopics.length
    ? `\n读者明确不感兴趣的话题（请剔除或降到 briefs）：\n${excludeTopics.map(t => `- ${t}`).join('\n')}\n`
    : ''

  const inputMode = promptInput.inputMode || DEFAULT_INPUT_MODE
  const targetOutputChars = pipelineConfig.targetOutputChars || promptInput.targetOutputChars
  const ratio = pipelineConfig.maxInputOutputRatio || promptInput.maxInputOutputRatio

  const prepSummary = inputMode === 'editorialPacket'
    ? promptInput.prepJson
    : JSON.stringify({
        clusters: (prepResult.clusters || []).map(c => ({
          clusterId: c.clusterId,
          title: c.title,
          importanceHint: c.importanceHint,
          reason: c.reason,
          itemIds: c.itemIds,
          facts: c.facts,
          whyItMayMatter: c.whyItMayMatter,
          openQuestions: c.openQuestions,
        })),
        briefCandidates: prepResult.briefCandidates || [],
        dropCandidates: (prepResult.dropCandidates || []).map(d => ({ itemId: d.itemId, reason: d.reason })),
        timelineCandidates: prepResult.timelineCandidates || [],
      }, null, 2)

  const sourceBlock = promptInput.includeRawSourceItems
    ? `\n原始新闻素材（只作核对，不要扩展素材范围）：\n${promptInput.sourceItemsText}`
    : ''

  const modeIntro = inputMode === 'editorialPacket'
    ? `请基于 DeepSeek 案头主任提供的 editorialPacket 撰写本期编辑简报。

你只做最终主编定稿：
- 使用 editorialPacket 中已经筛选好的事实、证据和推荐排序
- 可以调整标题、排序、合并条目、压缩条目、强化 editorTake
- 不新增事实，不新增来源、数字、人物、时间、地点
- 不重新扩展素材范围，不读取大批量原始素材
- suggestedEditorTake 是建议，你可以重写，但必须仍以 evidence 里的 fact 为依据`
    : `请基于以下素材撰写本期编辑简报。

研究助理为你准备了聚类分析（见下方 JSON），你应将其作为参考而非最终答案。你可以：
- 提升/降低某个 cluster 的重要性
- 合并或拆分 cluster
- 从 briefCandidates 中提拔值得展开的
- 重新排序、重新选题`

  return `${modeIntro}

${interestsBlock}${excludeBlock}

返回 JSON 格式（严格遵守，不要加 markdown 围栏）：
{
  ${tldrEnabled ? `"tldr": ["30 秒速读 bullet，3-${tldrMax} 条，每条 30-50 字，覆盖本期最该知道的事"],` : ''}
  "overview": "本期概览，1 段 100-150 字。${mergeContext ? '同时把宏观背景（更大格局、共同主线）融进来，不再单独出 context。' : ''}",
  "keyDevelopments": [
    {
      "title": "短句标题，不超过 25 字",
      "what": "【发生了什么】1-2 句，60-100 字。只讲事实，不评价",
      "why": "【为什么重要】1-2 句，60-100 字。讲影响、利益相关、结构性意义",
      "editorTake": "【编辑怎么看】1-2 句，60-120 字。带立场的判断、提醒、吐槽，可口语化",
      "importance": "high 或 medium"
    }
  ],
  ${mergeContext ? '' : '"context": "整体背景分析 100-200 字",'}
  "briefs": ["低关注度短讯。格式：【主题/地区】 一句话讲清楚 + 一句话点评。30-80 字一条，最多 6 条"],
  "timeline": [
    {"time": "MM-DD HH:mm", "event": "事件描述，包含时间、主体、行动"}
  ],
  "signals": ["值得关注的信号或苗头，每条说明为什么值得关注，不空洞"],
  "risks": ["风险判断：可能恶化的方向、具体路径、为什么"],
  "unknowns": ["信息缺口：会影响判断但目前不清楚的关键问题"],
  "editorReview": "结尾深度复盘 150-300 字。承担'宏观判断'职责。不要重复 overview，要往前推一层：这组新闻怎么改变了之前的认知框架、哪些关联被忽视、读者带走的核心 take。"
}

写作要求：
- keyDevelopments：高关注度最多 ${kdHigh} 条，中关注度最多 ${kdMedium} 条。按"对读者重要"排序，不按时间。
- ${lowHandling === 'drop' ? '低关注度素材直接丢弃，不要出现在任何字段' : lowHandling === 'expand' ? '低关注度也可放入 keyDevelopments（importance: medium）' : '低关注度素材进 briefs 区（短讯），不要塞进 keyDevelopments'}
- 命中读者排除主题的素材：${lowHandling === 'drop' ? '直接丢弃' : '降到 briefs 或不提'}
- briefs 每条要有"【地区】"前缀，便于扫读
- timeline 按时间正序，事件描述要完整自洽
- signals/risks/unknowns 各 2-4 条，每条要有"为什么"
- editorTake 是个人观点，可以带情绪、可以辛辣，但要有素材依据
${targetOutputChars ? `- 目标输出约 ${targetOutputChars} 个中文字符，避免无效铺陈` : ''}
${ratio ? `- Claude 输入/输出目标比例最多 ${ratio}:1；如果信息太多，优先保留 keyDevelopments 和 editorTake` : ''}

${inputMode === 'editorialPacket' ? 'editorialPacket' : '研究助理的聚类参考'}：
\`\`\`json
${prepSummary}
\`\`\`
${sourceBlock}`
}

/**
 * Claude 最终成稿主函数
 *
 * @param {Array}  modelItems     - 受控长度的模型输入条目
 * @param {object} prepResult     - DeepSeek 预处理结果
 * @param {object} config         - 主题配置
 * @param {object} [options]
 * @param {object} [options.auditor]
 * @returns {Promise<object>} 最终 report JSON（兼容 output.js）
 */
export async function writeFinalReport(modelItems, prepResult, config, options = {}) {
  const auditor = options.auditor
  const log = createLogger('writer')
  const promptInput = buildWriterPromptInput(modelItems, prepResult, config)
  log.step('最终成稿输入准备完成', {
    inputMode: promptInput.inputMode,
    sourceItems: promptInput.sourceItemsCount,
    inputChars: promptInput.inputCharCount,
    targetOutputChars: promptInput.targetOutputChars,
    includeRawSourceItems: promptInput.includeRawSourceItems,
  })

  if (auditor) {
    auditor.event('writer_input_prepared', {
      inputMode: promptInput.inputMode,
      includeRawSourceItems: promptInput.includeRawSourceItems,
      sourceItemsCount: promptInput.sourceItemsCount,
      inputCharCount: promptInput.inputCharCount,
      targetOutputChars: promptInput.targetOutputChars,
      maxInputOutputRatio: promptInput.maxInputOutputRatio,
      clustersCount: prepResult.clusters?.length || 0,
      briefCandidatesCount: prepResult.briefCandidates?.length || 0,
      keyDevelopmentsDraftCount: prepResult.keyDevelopmentsDraft?.length || 0,
      briefsDraftCount: prepResult.briefsDraft?.length || 0,
    })
  }

  const systemPrompt = buildWriterSystemPrompt(config.editorial)
  const userPrompt = buildWriterUserPrompt(promptInput, prepResult, config)

  const startMs = Date.now()
  const { result, tokens, model } = await callLLMForJsonWithMeta(systemPrompt, userPrompt, {
    role: 'writer',
    stage: 'final_write',
  })
  const durationMs = Date.now() - startMs
  log.success('最终成稿完成', {
    model,
    tokens: (tokens.input || 0) + (tokens.output || 0),
    keyDevelopments: result.keyDevelopments?.length || 0,
    briefs: result.briefs?.length || 0,
    ms: durationMs,
  })

  if (auditor) {
    auditor.event('writer_completed', {
      model,
      tokens,
      durationMs,
      keyDevelopmentsCount: result.keyDevelopments?.length || 0,
      briefsCount: result.briefs?.length || 0,
      inputMode: promptInput.inputMode,
      includeRawSourceItems: promptInput.includeRawSourceItems,
      inputCharCount: promptInput.inputCharCount,
      targetOutputChars: promptInput.targetOutputChars,
      maxInputOutputRatio: promptInput.maxInputOutputRatio,
      fallback: false,
    })
  }

  return {
    result,
    meta: { role: 'writer', stage: 'final_write', model, tokens, durationMs },
  }
}
