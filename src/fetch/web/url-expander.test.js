/**
 * url-expander 单元测试
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { expandUrls } from './url-expander.js'

const SRC = { name: 'Test' }

describe('expandUrls', () => {
  // ── 单 url 模式 ──
  it('单 url 模式', () => {
    const result = expandUrls({ ...SRC, url: 'https://example.com/news' })
    assert.equal(result.length, 1)
    assert.equal(result[0].url, 'https://example.com/news')
    assert.equal(result[0].hint, '')
    assert.equal(result[0].page, null)
  })

  it('单 url 模式带 hint', () => {
    const result = expandUrls({ ...SRC, url: 'https://example.com/news', hint: '科技' })
    assert.equal(result[0].hint, '科技')
  })

  // ── urls 数组模式 ──
  it('urls 数组（纯字符串）', () => {
    const result = expandUrls({
      ...SRC,
      urls: ['https://a.com/', 'https://b.com/'],
    })
    assert.equal(result.length, 2)
    assert.equal(result[0].url, 'https://a.com/')
    assert.equal(result[1].url, 'https://b.com/')
    assert.equal(result[0].hint, '')
    assert.equal(result[1].hint, '')
  })

  it('urls 数组（对象，独立 hint）', () => {
    const result = expandUrls({
      ...SRC,
      urls: [
        { url: 'https://a.com/', hint: '亚洲' },
        { url: 'https://b.com/', hint: '中东' },
      ],
    })
    assert.equal(result.length, 2)
    assert.equal(result[0].url, 'https://a.com/')
    assert.equal(result[0].hint, '亚洲')
    assert.equal(result[1].url, 'https://b.com/')
    assert.equal(result[1].hint, '中东')
  })

  it('urls 数组（字符串和对象混用）', () => {
    const result = expandUrls({
      ...SRC,
      urls: [
        'https://a.com/',
        { url: 'https://b.com/', hint: '中东' },
      ],
    })
    assert.equal(result.length, 2)
    assert.equal(result[0].url, 'https://a.com/')
    assert.equal(result[0].hint, '')
    assert.equal(result[1].url, 'https://b.com/')
    assert.equal(result[1].hint, '中东')
  })

  it('顶层 hint 作为默认值，单 URL hint 覆盖', () => {
    const result = expandUrls({
      ...SRC,
      hint: '默认提示',
      urls: [
        'https://a.com/',
        { url: 'https://b.com/', hint: '覆盖' },
      ],
    })
    assert.equal(result[0].hint, '默认提示')
    assert.equal(result[1].hint, '覆盖')
  })

  // ── 分页模板展开 ──
  it('分页模板展开（默认 pageStart=1）', () => {
    const result = expandUrls({
      ...SRC,
      url: 'https://example.com/news?page={page}',
      pages: 3,
    })
    assert.equal(result.length, 3)
    assert.equal(result[0].url, 'https://example.com/news?page=1')
    assert.equal(result[0].page, 1)
    assert.equal(result[1].url, 'https://example.com/news?page=2')
    assert.equal(result[1].page, 2)
    assert.equal(result[2].url, 'https://example.com/news?page=3')
    assert.equal(result[2].page, 3)
  })

  it('分页模板展开（pageStart=0）', () => {
    const result = expandUrls({
      ...SRC,
      url: 'https://example.com/news?p={page}',
      pages: 2,
      pageStart: 0,
    })
    assert.equal(result[0].url, 'https://example.com/news?p=0')
    assert.equal(result[1].url, 'https://example.com/news?p=1')
  })

  it('urls 数组中独立配置分页', () => {
    const result = expandUrls({
      ...SRC,
      urls: [
        { url: 'https://a.com/?p={page}', pages: 2 },
        'https://b.com/single',
        { url: 'https://c.com/?page={page}', pages: 3, pageStart: 0 },
      ],
    })
    assert.equal(result.length, 6)
    assert.equal(result[0].url, 'https://a.com/?p=1')
    assert.equal(result[1].url, 'https://a.com/?p=2')
    assert.equal(result[2].url, 'https://b.com/single')
    assert.equal(result[2].page, null)
    assert.equal(result[3].url, 'https://c.com/?page=0')
    assert.equal(result[4].url, 'https://c.com/?page=1')
    assert.equal(result[5].url, 'https://c.com/?page=2')
  })

  it('顶层 pages 作用于纯字符串 url', () => {
    const result = expandUrls({
      ...SRC,
      urls: ['https://a.com/?p={page}', 'https://b.com/?p={page}'],
      pages: 2,
    })
    assert.equal(result.length, 4)
    assert.equal(result[0].url, 'https://a.com/?p=1')
    assert.equal(result[1].url, 'https://a.com/?p=2')
    assert.equal(result[2].url, 'https://b.com/?p=1')
    assert.equal(result[3].url, 'https://b.com/?p=2')
  })

  // ── 路径中含 {page} ──
  it('{page} 在路径中间', () => {
    const result = expandUrls({
      ...SRC,
      url: 'https://example.com/news/page/{page}',
      pages: 2,
    })
    assert.equal(result[0].url, 'https://example.com/news/page/1')
    assert.equal(result[1].url, 'https://example.com/news/page/2')
  })

  // ── 错误处理 ──
  it('url 和 urls 同时存在时报错', () => {
    assert.throws(
      () => expandUrls({ ...SRC, url: 'https://a.com/', urls: ['https://b.com/'] }),
      /互斥/
    )
  })

  it('url 和 urls 都不存在时报错', () => {
    assert.throws(
      () => expandUrls({ ...SRC }),
      /必须配置/
    )
  })

  it('有 {page} 但没 pages 时报错', () => {
    assert.throws(
      () => expandUrls({ ...SRC, url: 'https://a.com/?p={page}' }),
      /未配置 pages/
    )
  })

  it('有 pages 但没 {page} 时报错', () => {
    assert.throws(
      () => expandUrls({ ...SRC, url: 'https://a.com/news', pages: 3 }),
      /不含.*\{page\}/
    )
  })

  it('pages < 1 时报错', () => {
    assert.throws(
      () => expandUrls({ ...SRC, url: 'https://a.com/?p={page}', pages: 0 }),
      /必须 >= 1/
    )
  })

  // ── 总数上限保护 ──
  it('展开超过 20 个 URL 时报错', () => {
    // 7 个 url 各 3 页 = 21
    const urls = Array.from({ length: 7 }, (_, i) => ({ url: `https://a.com/p${i}?page={page}`, pages: 3 }))
    assert.throws(
      () => expandUrls({ ...SRC, urls }),
      /超过上限/
    )
  })

  it('恰好 20 个 URL 应该通过', () => {
    // 4 个 url 各 5 页 = 20
    const urls = Array.from({ length: 4 }, (_, i) => ({ url: `https://a.com/p${i}?page={page}`, pages: 5 }))
    const result = expandUrls({ ...SRC, urls })
    assert.equal(result.length, 20)
  })
})
