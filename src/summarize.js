/**
 * ============================================================
 * 新闻摘要模块 — 构建提示词，调用 LLM 生成结构化简报
 * ============================================================
 *
 * 这个模块负责：
 *   1. 定义 system prompt（LLM 的角色设定）
 *   2. 把新闻列表拼成 user prompt（具体的任务+数据）
 *   3. 调用 llm.js 的 callLLMForJson() 获取结构化结果
 *
 * 设计理念：
 *   - 这个文件不直接接触 LangChain SDK，只通过 callLLMForJson 调用
 *   - system prompt 和 user prompt 分离：system稳定不变，user每次不同
 *   - 提示词中明确"字段没内容就返回空数组"，防止 LLM 编造内容填空
 *
 * LLM 返回的 JSON 结构（主编深加工版）：
 *   {
 *     overview: "本期概览 100-200字",
 *     keyDevelopments: [{title, detail, importance}, ...],
 *     context: "整体背景分析 100-200字",
 *     timeline: [{time: "MM-DD HH:mm", event: "描述"}],
 *     signals: ["值得关注的信号"],
 *     risks: ["风险判断"],
 *     unknowns: ["信息缺口"],
 *     editorReview: "主编复盘 150-300字"
 *   }
 */

import { callLLMForJsonWithMeta } from './llm.js'

/**
 * 系统提示词 —— 定义 LLM 的角色和行为规则
 *
 * 几个关键约束：
 *   "只基于提供的素材" → 防止 LLM 凭空编造新闻
 *   "中文输出"         → 统一用中文写简报
 *   "严格按照 JSON schema 返回" → 保证输出格式可解析
 */
const SYSTEM_PROMPT = `你是一名资深国际新闻主编，兼具记者的敏锐和编辑的深度。
你的任务不仅是简单摘要新闻，而是像真正的编辑部一样，对提供的新闻素材进行深加工：

1. 梳理与整合：把零散的新闻条目串联起来，找出背后的主线、趋势和关联
2. 提炼与升华：从多条新闻中抽取出真正重要的变化，而不是逐条复述
3. 复盘与洞察：以主编视角对整体信息进行回顾，指出值得关注的信号、潜在影响和需要持续跟踪的方向

工作要求：
- 只基于提供的素材，绝不编造任何事实
- 中文输出，语言专业但不生硬，有可读性
- 每条分析都要有实质内容，避免空洞的概括
- 严格按照要求的 JSON schema 返回，不要包含任何额外解释`

/**
 * 构建用户提示词 —— 把新闻数据和格式要求拼在一起
 *
 * @param {Array}  items  - 过滤后的新闻条目列表
 * @param {object} config - 主题配置
 * @returns {string} 完整的用户提示词
 */
function buildUserPrompt(items, config) {
  // 把每条新闻格式化为编号的文本块
  const itemsText = items.map((item, i) =>
    `[${i + 1}] 来源: ${item.source}
时间: ${item.publishedAt}
标题: ${item.title}
摘要: ${item.summary}
URL: ${item.url}`
  ).join('\n\n')  // 两条新闻之间用空行分隔，方便LLM阅读

  // 返回完整的用户提示：任务说明 + JSON schema + 约束 + 原始数据
  return `请以主编身份，基于下面 ${items.length} 条关于"${config.title}"的新闻，撰写一份有深度的编辑简报。

返回 JSON 格式:
{
  "overview": "本期概览，2-3句话勾勒本期新闻的整体画像：发生了什么、集中在哪些方向、背后主线是什么。100-200字",
  "keyDevelopments": [
    {
      "title": "简短概括这个变化",
      "detail": "展开阐述：这个变化具体是什么、为什么重要、涉及哪些关键方、可能带来什么影响。每条80-150字",
      "importance": "high/medium"
    }
  ],
  "context": "整体背景分析：这些新闻的共同背景是什么，放在更大格局中意味着什么。如果单条新闻之间看起来没关联，就如实说明。100-200字",
  "timeline": [
    {"time": "MM-DD HH:mm", "event": "事件描述，包含时间、主体、行动，尽量完整"}
  ],
  "signals": ["值得关注的信号或苗头，说明为什么值得关注，不仅仅罗列现象"],
  "risks": ["风险判断：可能恶化的方向、需要注意的风险点，给出具体理由"],
  "unknowns": ["信息缺口：目前不清楚、但会影响判断的关键问题"],
  "editorReview": "主编复盘：站在更高视角对本轮信息做整体梳理——新闻之间的关联、与之前趋势的呼应、后续值得紧盯的方向、读者应该带走的核心认知。150-300字"
}

写作要求:
- 每个字段都要写满内容，不要用一句话敷衍
- keyDevelopments 3-5 条，按重要性排序，每条都有实质性分析
- timeline 按时间正序，事件描述要完整
- signals、risks、unknowns 各至少 2 条，内容要有实质判断
- 如果某个字段确实没有内容，才返回空数组
- 语言专业有深度，像《经济学人》或《财新》的编辑文章风格

新闻素材:

${itemsText}`
}

/**
 * 生成简报的主函数
 * @param {Array}  items  - 新闻条目
 * @param {object} config - 主题配置
 * @param {object} [options]
 * @param {object} [options.auditor] - 审计日志记录器
 * @returns {Promise<object>} LLM 返回的结构化简报 JSON
 */
export async function summarize(items, config, options = {}) {
  const auditor = options.auditor
  const userPrompt = buildUserPrompt(items, config)
  const startMs = Date.now()

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

  const { result, tokens, model } = await callLLMForJsonWithMeta(SYSTEM_PROMPT, userPrompt)
  const durationMs = Date.now() - startMs

  if (auditor) {
    auditor.event('llm_response_received', {
      tokens,
      model,
      durationMs,
    })
  }

  return result
}
