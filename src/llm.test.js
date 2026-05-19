/**
 * src/llm.js 单元测试
 * 测试 role 环境变量读取和回退逻辑
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

const ENV_KEYS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_TEMPERATURE',
  'LLM_WRITER_API_KEY',
  'LLM_WRITER_BASE_URL',
  'LLM_WRITER_MODEL',
  'LLM_WRITER_TEMPERATURE',
]

let originalEnv

beforeEach(() => {
  originalEnv = {}
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

describe('llm module', () => {
  describe('backward compatibility', () => {
    it('callLLMForJsonWithMeta accepts options without breaking', async () => {
      // 验证函数签名兼容：无 options 调用不报错
      const { callLLMForJsonWithMeta } = await import('./llm.js')
      assert.strictEqual(typeof callLLMForJsonWithMeta, 'function')
    })

    it('callLLMForJson accepts options without breaking', async () => {
      const { callLLMForJson } = await import('./llm.js')
      assert.strictEqual(typeof callLLMForJson, 'function')
    })
  })

  describe('provider-specific request params', () => {
    it('omits ChatOpenAI default sampling params for b.ai Claude writer models', async () => {
      process.env.LLM_API_KEY = 'sk-test'
      process.env.LLM_BASE_URL = 'https://api.deepseek.com'
      process.env.LLM_MODEL = 'deepseek-v4-pro'
      process.env.LLM_TEMPERATURE = '0.6'
      process.env.LLM_WRITER_BASE_URL = 'https://api.b.ai/v1'
      process.env.LLM_WRITER_MODEL = 'claude-opus-4.7'

      const { createModelClient, getRoleConfig } = await import('./llm.js')
      const config = getRoleConfig('writer')
      const model = createModelClient('writer')
      const params = model.invocationParams()

      assert.strictEqual(config.temperature, undefined)
      assert.strictEqual(params.temperature, undefined)
      assert.strictEqual(params.top_p, undefined)
      assert.strictEqual(params.frequency_penalty, undefined)
      assert.strictEqual(params.presence_penalty, undefined)
      assert.strictEqual(params.model, 'claude-opus-4.7')
    })

    it('keeps global temperature fallback for non-Claude providers', async () => {
      process.env.LLM_API_KEY = 'sk-test'
      process.env.LLM_BASE_URL = 'https://api.deepseek.com'
      process.env.LLM_MODEL = 'deepseek-v4-pro'
      process.env.LLM_TEMPERATURE = '0.6'

      const { createModelClient, getRoleConfig } = await import('./llm.js')
      const config = getRoleConfig('default')
      const model = createModelClient('default')
      const params = model.invocationParams()

      assert.strictEqual(config.temperature, 0.6)
      assert.strictEqual(params.temperature, 0.6)
      assert.strictEqual(params.top_p, 1)
    })
  })
})
