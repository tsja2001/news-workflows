/**
 * ============================================================
 * LLM 调用封装模块 — 统一的大模型交互层
 * ============================================================
 */

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'

function createModel() {
  return new ChatOpenAI({
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    configuration: {
      baseURL: process.env.LLM_BASE_URL,
    },
  })
}

/**
 * 修复 LLM 返回的非标准 JSON：
 *   1. 剥离 markdown 代码块（```json ... ```）
 *   2. 尝试定位第一个 [ 或 { 开始解析
 *   3. 修复 JS 风格的 unquoted key（如 {title: "..."} → {"title": "..."})
 */
function repairAndParseJson(raw) {
  let text = raw.trim()

  // 剥离 markdown 代码块
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }

  // 尝试从第一个 JSON 边界开始解析
  const jsonStart = Math.min(
    text.indexOf('[') === -1 ? Infinity : text.indexOf('['),
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{')
  )
  if (jsonStart !== Infinity && jsonStart > 0) {
    text = text.slice(jsonStart)
    // 去掉尾部多余文本（试试找到对应的闭合）
    const firstChar = text[0]
    const closer = firstChar === '[' ? ']' : '}'
    const lastClose = text.lastIndexOf(closer)
    if (lastClose !== -1) {
      text = text.slice(0, lastClose + 1)
    }
  }

  // 尝试直接解析
  try {
    return JSON.parse(text)
  } catch {
    // 尝试修复 JS 风格的 unquoted key: {title: "..."} → {"title": "..."}
    const fixed = text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
    return JSON.parse(fixed)
  }
}

/**
 * 调用 LLM 并返回 JSON 解析结果 + token 元信息
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{ result: object, tokens: { input: number, output: number }, model: string }>}
 */
export async function callLLMForJsonWithMeta(systemPrompt, userPrompt) {
  const model = createModel()
  const modelName = process.env.LLM_MODEL || 'gpt-4o-mini'

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]

  const aiMsg = await model.invoke(messages)
  const content = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content)

  let inputTokens = 0
  let outputTokens = 0
  if (aiMsg.usage_metadata) {
    inputTokens = aiMsg.usage_metadata.input_tokens || 0
    outputTokens = aiMsg.usage_metadata.output_tokens || 0
  }

  const result = repairAndParseJson(content)

  return {
    result,
    tokens: { input: inputTokens, output: outputTokens },
    model: modelName,
  }
}

/**
 * 调用 LLM 并要求返回 JSON（仅返回解析结果，向后兼容）
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<object>}
 */
export async function callLLMForJson(systemPrompt, userPrompt) {
  const { result } = await callLLMForJsonWithMeta(systemPrompt, userPrompt)
  return result
}
