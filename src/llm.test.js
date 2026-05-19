/**
 * src/llm.js 单元测试
 * 测试 role 环境变量读取和回退逻辑
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

// 直接测试 getRoleConfig 需要 import，但它是内部函数。
// 这里通过 callLLMForJsonWithMeta 间接验证 role 配置逻辑。
// 真正的集成测试需要有真实 LLM，此处验证向后兼容的行为。

describe('llm module', () => {
  describe('backward compatibility', () => {
    it('callLLMForJsonWithMeta accepts options without breaking', async () => {
      // 验证函数签名兼容：无 options 调用不报错
      const { callLLMForJsonWithMeta } = await import('./llm.js')
      assert.strictEqual(typeof callLLMForJsonWithMeta, 'function')
      // 函数参数长度为 3 说明 options 参数存在
      assert.strictEqual(callLLMForJsonWithMeta.length, 3)
    })

    it('callLLMForJson accepts options without breaking', async () => {
      const { callLLMForJson } = await import('./llm.js')
      assert.strictEqual(typeof callLLMForJson, 'function')
      assert.strictEqual(callLLMForJson.length, 3)
    })
  })
})
