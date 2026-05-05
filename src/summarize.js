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
 * LLM 返回的 JSON 结构：
 *   {
 *     summary: "一句话概览",
 *     keyDevelopments: ["关键变化1", "关键变化2", ...],
 *     timeline: [{time: "MM-DD HH:mm", event: "描述"}],
 *     risks: ["风险观察1", ...],
 *     unknowns: ["信息缺口1", ...]
 *   }
 */

import { callLLMForJson } from './llm.js'

/**
 * 系统提示词 —— 定义 LLM 的角色和行为规则
 *
 * 几个关键约束：
 *   "只基于提供的素材" → 防止 LLM 凭空编造新闻
 *   "中文输出"         → 统一用中文写简报
 *   "严格按照 JSON schema 返回" → 保证输出格式可解析
 */
const SYSTEM_PROMPT = `你是一名资深的国际新闻编辑。
你的任务是基于提供的新闻条目,生成一份结构化的简报。
严格要求:
- 只基于提供的素材,绝不编造任何事实
- 中文输出
- 严格按照要求的 JSON schema 返回,不要包含任何额外解释`

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
  return `请基于下面 ${items.length} 条关于"${config.title}"的新闻,生成简报。

返回 JSON 格式:
{
  "summary": "一句话概览,40 字以内",
  "keyDevelopments": ["关键变化 1", "关键变化 2"],
  "timeline": [{"time": "MM-DD HH:mm", "event": "事件描述"}],
  "risks": ["风险与观察 1"],
  "unknowns": ["信息缺口 1"]
}

要求:
- keyDevelopments 不超过 5 条,按重要性排序
- timeline 按时间正序
- 如果某个字段没有内容,返回空数组

新闻素材:

${itemsText}`
}

/**
 * 生成简报的主函数
 * @param {Array}  items  - 新闻条目
 * @param {object} config - 主题配置
 * @returns {Promise<object>} LLM 返回的结构化简报 JSON
 */
export async function summarize(items, config) {
  const userPrompt = buildUserPrompt(items, config)
  return await callLLMForJson(SYSTEM_PROMPT, userPrompt)
}
