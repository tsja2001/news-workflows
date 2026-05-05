/**
 * ============================================================
 * src/fetch/api.js 单元测试
 * ============================================================
 * 测试字段映射、查询字符串构建、itemsPath 提取等纯函数
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getByPath, buildQuery, getItems } from '../fetch/api.js'

describe('api adapter', () => {
  describe('getByPath', () => {
    it('extracts simple field', () => {
      assert.strictEqual(getByPath({ title: 'Hello' }, 'title'), 'Hello')
    })

    it('extracts nested field via dot notation', () => {
      const obj = { source: { name: 'BBC' } }
      assert.strictEqual(getByPath(obj, 'source.name'), 'BBC')
    })

    it('extracts deeply nested field', () => {
      const obj = { a: { b: { c: 'deep' } } }
      assert.strictEqual(getByPath(obj, 'a.b.c'), 'deep')
    })

    it('returns empty string for missing path', () => {
      assert.strictEqual(getByPath({}, 'missing.path'), '')
      assert.strictEqual(getByPath(null, 'anything'), '')
    })
  })

  describe('buildQuery', () => {
    it('builds query string from params', () => {
      const qs = buildQuery({ q: 'Iran sanctions', language: 'en' })
      assert.ok(qs.includes('q=Iran%20sanctions'))
      assert.ok(qs.includes('language=en'))
      assert.ok(qs.startsWith('?'))
    })

    it('returns empty string for empty/null params', () => {
      assert.strictEqual(buildQuery({}), '')
      assert.strictEqual(buildQuery(null), '')
    })
  })

  describe('getItems', () => {
    it('extracts array via simple path', () => {
      const data = { articles: [{ title: 'a' }, { title: 'b' }] }
      const items = getItems(data, 'articles')
      assert.strictEqual(items.length, 2)
      assert.strictEqual(items[1].title, 'b')
    })

    it('extracts array via dotted path', () => {
      const data = { data: { news: [{ id: 1 }] } }
      const items = getItems(data, 'data.news')
      assert.strictEqual(items.length, 1)
    })

    it('throws when path does not point to array', () => {
      const data = { notArray: 'string' }
      assert.throws(() => getItems(data, 'notArray'))
    })
  })
})
