/**
 * ============================================================
 * 新闻摘要模块 — 编排层
 * ============================================================
 *
 * 支持两种模式：
 *   single  — 单模型直接成稿（向后兼容，默认模式）
 *   hybrid  — DeepSeek 预处理 + Claude 最终成稿
 *
 * 模式由 yaml 的 llmPipeline.mode 控制，未配置时默认 single。
 */

import { callLLMForJsonWithMeta } from './llm.js'
import { createLogger } from './utils/logger.js'

const DEFAULT_PERSONA = '资深国际新闻主编'
const DEFAULT_TONE = '专业克制，有判断但不情绪化'

function attachRunStats(report, models) {
  if (!report || typeof report !== 'object') return report
  Object.defineProperty(report, '_runStats', {
    value: { models: models.filter(Boolean) },
    enumerable: false,
    configurable: true,
  })
  return report
}

/**
 * 构建系统提示词 —— 根据 editorial 配置动态生成 LLM 角色设定
 */
function buildSystemPrompt(editorial = {}) {
  const persona = editorial.persona || DEFAULT_PERSONA
  const tone = editorial.tone || DEFAULT_TONE

  return `你是${persona}。你的工作不是替主流媒体复述新闻，而是替这位读者把事情吃透、说清。

要做的几件事：
1. **看清主线**：从一堆零散素材里抽出几条真正重要的变化，按"对读者重要"排序，不按"哪条最近"排序。
2. **替他过滤**：读者明确告诉过你他不关心哪些话题。即使素材里出现，也不要塞进 keyDevelopments；可以放到 briefs 一行带过，或者直接不提。
3. **替他判断**：每条变化下面除了"发生了什么"、"为什么重要"，再加一句"编辑怎么看"——你的立场、判断、提醒。可以口语，可以辛辣，但要有素材依据，不能凭空发挥。
4. **不装客观**：这份简报是给一个人看的，不是发稿。少用"或将"、"可能"、"有观察人士认为"这种官话；多用"说白了"、"我看…"、"别看…其实…"这种直接判断。

写作风格：${tone}

硬性规则：
- 只基于提供的素材，绝不编造事实或细节
- 中文输出
- 严格按 JSON schema 返回，不要带任何额外解释或 markdown 围栏（不要用 \`\`\`json）
- 字段没内容就返回空数组/空字符串，不要凑数`
}

/**
 * 构建用户提示词 —— 把新闻数据和格式要求拼在一起
 *
 * @param {Array}  items  - 过滤后的新闻条目列表
 * @param {object} config - 主题配置
 * @returns {string} 完整的用户提示词
 */
function buildUserPrompt(items, config) {
  const editorial = config.editorial || {}
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

  const itemsText = items.map((item, i) =>
    `[${i + 1}] 来源: ${item.source}
时间: ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary}
URL: ${item.url}`
  ).join('\n\n')

  return `请基于下面 ${items.length} 条关于"${config.title}"的新闻，撰写一份编辑简报。
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
- timeline 按时间正序，事件描述要完整自洽（脱离上下文也能看懂）
- signals/risks/unknowns 各 2-4 条，每条要有"为什么"
- editorTake 是个人观点，可以带情绪、可以辛辣，但要有素材依据

新闻素材：

${itemsText}`
}

/**
 * 单模型总结（向后兼容）
 */
async function summarizeSingleModel(items, config, options = {}) {
  const auditor = options.auditor
  const log = createLogger('summarize')
  const userPrompt = buildUserPrompt(items, config)
  const startMs = Date.now()
  log.step('单模型总结准备完成', {
    items: items.length,
    userChars: userPrompt.length,
  })

  if (auditor) {
    auditor.event('llm_input_prepared', {
      itemCount: items.length,
      items: items.map(i => ({
        title: i.title,
        url: i.url,
        source: i.source,
        publishedAt: i.publishedAt,
        contentLength: (i.content || '').length,
      })),
    })
  }

  const systemPrompt = buildSystemPrompt(config.editorial)
  const { result, tokens, model } = await callLLMForJsonWithMeta(systemPrompt, userPrompt)
  const durationMs = Date.now() - startMs
  log.success('单模型总结完成', {
    model,
    tokens: (tokens.input || 0) + (tokens.output || 0),
    ms: durationMs,
  })

  if (auditor) {
    auditor.event('llm_response_received', {
      tokens,
      model,
      durationMs,
    })
  }

  return attachRunStats(result, [{ role: 'default', stage: 'summarize', model, tokens, durationMs }])
}

/**
 * Hybrid 总结：DeepSeek 预处理 + Claude 成稿 + 可选校验
 * 单阶段失败时按配置回退（默认回退到单模型）
 */
async function summarizeHybrid(items, config, options = {}) {
  const auditor = options.auditor
  const log = createLogger('summarize')
  log.step('Hybrid 总结开始', { items: items.length })

  // 阶段 1：预处理（失败时回退单模型）
  let prepResult
  try {
    const { preprocessItems } = await import('./summarize/preprocess.js')
    prepResult = await preprocessItems(items, config, { auditor })
  } catch (err) {
    console.error(`[hybrid] 预处理失败: ${err.message}，回退到单模型模式`)
    if (auditor) {
      auditor.event('preprocess_failed', { error: err.message, fallback: 'single_model' })
    }
    return await summarizeSingleModel(items, config, options)
  }

  // 阶段 2：最终成稿（失败策略由配置决定）
  try {
    const { writeFinalReport } = await import('./summarize/write-report.js')
    const writerResult = await writeFinalReport(prepResult.modelItems, prepResult.result, config, { auditor })
    const { result } = writerResult
    const models = [prepResult.meta, writerResult.meta]

    // 阶段 3：可选校验
    if (config.llmPipeline?.validation?.enabled) {
      const { validateReport } = await import('./summarize/validate.js')
      log.step('校验最终简报', { keyDevelopments: result.keyDevelopments?.length || 0 })
      const validated = await validateReport(result, config, { auditor })
      if (validated.issues.length > 0) {
        console.error(`[校验] 发现 ${validated.issues.length} 个问题，已修复 ${validated.fixed.length} 个`)
      }
      log.success('校验完成', { issues: validated.issues.length, fixed: validated.fixed.length })
      return attachRunStats(validated.report, models)
    }

    log.success('Hybrid 总结完成', { keyDevelopments: result.keyDevelopments?.length || 0, briefs: result.briefs?.length || 0 })
    return attachRunStats(result, models)
  } catch (err) {
    const onFailure = config.llmPipeline?.writer?.onFailure || 'fail'
    console.error(`[hybrid] 最终成稿失败: ${err.message}`)

    if (auditor) {
      auditor.event('writer_failed', { error: err.message, onFailure })
    }

    if (onFailure === 'fallbackToPreprocessModel') {
      console.error(`[hybrid] 回退到单模型模式`)
      return await summarizeSingleModel(items, config, options)
    }

    throw err
  }
}

/**
 * 生成简报的主函数（编排层）
 *
 * @param {Array}  items  - 新闻条目
 * @param {object} config - 主题配置（含 editorial 和可选的 llmPipeline）
 * @param {object} [options]
 * @param {object} [options.auditor]
 * @returns {Promise<object>} LLM 返回的结构化简报 JSON
 */
export async function summarize(items, config, options = {}) {
  const mode = config.llmPipeline?.mode || 'single'

  if (mode === 'hybrid') {
    return await summarizeHybrid(items, config, options)
  }

  return await summarizeSingleModel(items, config, options)
}
