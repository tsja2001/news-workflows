/**
 * ============================================================
 * LLM 调用封装模块 — 统一的大模型交互层
 * ============================================================
 */

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { JsonOutputParser } from '@langchain/core/output_parsers'

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
 * 调用 LLM 并返回 JSON 解析结果 + token 元信息
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{ result: object, tokens: { input: number, output: number }, model: string }>}
 */
export async function callLLMForJsonWithMeta(systemPrompt, userPrompt) {
  const model = createModel()
  const parser = new JsonOutputParser()
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

  const result = await parser.parse(content)

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
