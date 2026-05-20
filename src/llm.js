/**
 * ============================================================
 * LLM 调用封装模块 — 统一的大模型交互层
 * ============================================================
 *
 * 支持多模型 role 分工：
 *   default     → 兼容旧逻辑，读 LLM_* 环境变量
 *   preprocess  → DeepSeek 预处理，读 LLM_PREPROCESS_*，缺失回退 LLM_*
 *   writer      → Claude 最终成稿，读 LLM_WRITER_*，缺失回退 LLM_*
 *   validator   → 校验阶段，读 LLM_VALIDATOR_*，缺失回退 LLM_*
 */

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { createLogger } from './utils/logger.js'

/**
 * 按 role 读取环境变量配置，缺失时回退到 LLM_* 默认值
 * @param {string} role - default | preprocess | writer | validator
 * @returns {{ apiKey: string, baseURL: string, model: string, temperature: number, maxTokens: number, disableThinking: boolean, omitOpenAICompatibleSamplingParams: boolean }}
 */
export function getRoleConfig(role) {
  const prefix = role === 'default' ? 'LLM' : `LLM_${role.toUpperCase()}`

  const apiKey = process.env[`${prefix}_API_KEY`] || process.env.LLM_API_KEY
  const baseURL = process.env[`${prefix}_BASE_URL`] || process.env.LLM_BASE_URL
  const model = process.env[`${prefix}_MODEL`] || process.env.LLM_MODEL || 'gpt-4o-mini'
  const isBaiClaude = (baseURL || '').includes('api.b.ai') && model.toLowerCase().includes('claude')

  const roleTemp = process.env[`${prefix}_TEMPERATURE`]
  const defaultTemp = process.env.LLM_TEMPERATURE
  const temperature = isBaiClaude
    ? undefined
    : (roleTemp !== undefined
        ? Number(roleTemp)
        : (defaultTemp !== undefined ? Number(defaultTemp) : undefined))

  // maxTokens：预处理需要较大输出（聚类 JSON），默认 16384；其他 stage 不设限
  const roleMaxTokens = process.env[`${prefix}_MAX_TOKENS`]
  const defaultMaxTokens = process.env.LLM_MAX_TOKENS
  const maxTokens = roleMaxTokens !== undefined
    ? Number(roleMaxTokens)
    : (defaultMaxTokens !== undefined ? Number(defaultMaxTokens) : undefined)

  // 思考模式：DeepSeek 默认开启，但新闻简报场景不需要，默认关闭
  // 设置 LLM_DISABLE_THINKING=false 可重新启用
  const disableThinking = process.env.LLM_DISABLE_THINKING !== 'false'
  const omitOpenAICompatibleSamplingParams = isBaiClaude

  return { apiKey, baseURL, model, temperature, maxTokens, disableThinking, omitOpenAICompatibleSamplingParams }
}

function omitDefaultOpenAIParams(model) {
  model.temperature = undefined
  model.topP = undefined
  model.frequencyPenalty = undefined
  model.presencePenalty = undefined
}

/**
 * 按 role 创建 LangChain ChatOpenAI 实例
 * @param {string} role
 * @returns {ChatOpenAI}
 */
export function createModelClient(role = 'default') {
  const config = getRoleConfig(role)

  const kwargs = {}

  // DeepSeek 思考模式默认关闭，避免长时间"思考"导致假死
  // 仅对 DeepSeek 注入此参数，其他 provider 不识别会 403
  if (config.disableThinking && config.baseURL && config.baseURL.includes('deepseek')) {
    kwargs.thinking = { type: 'disabled' }
  }

  const modelOptions = {
    apiKey: config.apiKey,
    model: config.model,
    configuration: {
      baseURL: config.baseURL,
    },
  }

  // temperature 只在明确配置时才传入（Claude 等模型不支持此参数）
  if (config.temperature !== undefined) {
    modelOptions.temperature = config.temperature
  }

  // maxTokens：预处理需要较大输出空间，默认 16384
  if (config.maxTokens !== undefined) {
    modelOptions.maxTokens = config.maxTokens
  }

  if (Object.keys(kwargs).length > 0) {
    modelOptions.modelKwargs = kwargs
  }

  const model = new ChatOpenAI(modelOptions)

  // ChatOpenAI 会默认发送 temperature=1、top_p=1、frequency_penalty=0、presence_penalty=0。
  // b.ai 的 Claude 兼容接口对部分 Claude 模型会返回 "`temperature`/`top_p` is deprecated for this model"，
  // 因此该 provider/model 组合必须显式清掉这些默认 OpenAI 采样参数。
  if (config.omitOpenAICompatibleSamplingParams) {
    omitDefaultOpenAIParams(model)
  } else if (config.temperature === undefined) {
    model.temperature = undefined
    model.topP = undefined
  }

  return model
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
 * @param {object} [options]
 * @param {string} [options.role='default']  - 模型角色
 * @param {string} [options.stage='summarize'] - 阶段标识（用于审计）
 * @returns {Promise<{ result: object, tokens: { input: number, output: number }, model: string, role: string, stage: string }>}
 */
export async function callLLMForJsonWithMeta(systemPrompt, userPrompt, options = {}) {
  const role = options.role || 'default'
  const stage = options.stage || 'summarize'
  const config = getRoleConfig(role)
  const model = createModelClient(role)
  const log = createLogger('llm')
  const startMs = Date.now()

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]

  log.step('调用模型', {
    stage,
    role,
    model: config.model,
    systemChars: systemPrompt.length,
    userChars: userPrompt.length,
    maxTokens: config.maxTokens,
  })

  const aiMsg = await model.invoke(messages)
  const content = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content)

  let inputTokens = 0
  let outputTokens = 0
  if (aiMsg.usage_metadata) {
    inputTokens = aiMsg.usage_metadata.input_tokens || 0
    outputTokens = aiMsg.usage_metadata.output_tokens || 0
  }

  const result = repairAndParseJson(content)
  const durationMs = Date.now() - startMs

  log.success('模型返回并解析完成', {
    stage,
    role,
    model: config.model,
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    responseChars: content.length,
    ms: durationMs,
  })

  return {
    result,
    tokens: { input: inputTokens, output: outputTokens },
    model: config.model,
    role,
    stage,
  }
}

/**
 * 调用 LLM 并要求返回 JSON（仅返回解析结果，向后兼容）
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options]
 * @param {string} [options.role]
 * @param {string} [options.stage]
 * @returns {Promise<object>}
 */
export async function callLLMForJson(systemPrompt, userPrompt, options = {}) {
  const { result } = await callLLMForJsonWithMeta(systemPrompt, userPrompt, options)
  return result
}
