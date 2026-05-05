/**
 * ============================================================
 * src/config.js 单元测试
 * ============================================================
 * 测试 resolveEnvVars env 变量替换
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { resolveEnvVars } from '../config.js'

describe('config', () => {
  describe('resolveEnvVars', () => {
    let saved

    beforeEach(() => {
      saved = process.env.TEST_VAR
      process.env.TEST_VAR = 'resolved-value'
    })

    afterEach(() => {
      if (saved === undefined) {
        delete process.env.TEST_VAR
      } else {
        process.env.TEST_VAR = saved
      }
    })

    it('replaces ${VAR} in strings', () => {
      const result = resolveEnvVars('hello ${TEST_VAR} world')
      assert.strictEqual(result, 'hello resolved-value world')
    })

    it('replaces multiple ${VAR} in same string', () => {
      process.env.B = 'B'
      const result = resolveEnvVars('${TEST_VAR}:${B}')
      assert.strictEqual(result, 'resolved-value:B')
      delete process.env.B
    })

    it('throws for undefined variable', () => {
      assert.throws(
        () => resolveEnvVars('${UNDEFINED_VAR_12345}'),
        /UNDEFINED_VAR_12345/
      )
    })

    it('recursively replaces in objects', () => {
      const obj = {
        url: 'https://api.example.com?key=${TEST_VAR}',
        nested: { val: '${TEST_VAR}' },
      }
      const result = resolveEnvVars(obj)
      assert.strictEqual(result.url, 'https://api.example.com?key=resolved-value')
      assert.strictEqual(result.nested.val, 'resolved-value')
    })

    it('recursively replaces in arrays', () => {
      const arr = ['a ${TEST_VAR}', { key: '${TEST_VAR}' }]
      const result = resolveEnvVars(arr)
      assert.strictEqual(result[0], 'a resolved-value')
      assert.strictEqual(result[1].key, 'resolved-value')
    })

    it('passes through non-string primitives', () => {
      assert.strictEqual(resolveEnvVars(42), 42)
      assert.strictEqual(resolveEnvVars(true), true)
      assert.strictEqual(resolveEnvVars(null), null)
    })
  })
})
