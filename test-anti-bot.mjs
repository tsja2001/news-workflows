/**
 * 临时测试脚本：诊断 Reuters 和 Al Jazeera 的反爬问题
 * 运行: node test-anti-bot.mjs
 */

import { chromium } from 'playwright-core'

const TEST_URLS = [
  { name: 'Reuters World', url: 'https://www.reuters.com/world/' },
  { name: 'Al Jazeera News', url: 'https://www.aljazeera.com/news/' },
  { name: 'AP News World', url: 'https://apnews.com/world-news' },
]

// 当前使用的 bot UA
const BOT_UA = 'Mozilla/5.0 (compatible; NewsBriefBot/1.0; +https://github.com/news-workflows)'

// 真实浏览器 UA
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

async function test(url, ua, name) {
  console.log(`\n=== 测试: ${name} ===`)
  console.log(`UA: ${ua.slice(0, 60)}...`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })
  const page = await context.newPage()

  try {
    console.log(`正在导航到 ${url}...`)
    const start = Date.now()

    // 使用 domcontentloaded + networkidle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`  domcontentloaded 完成 (${Date.now() - start}ms)`)

    // 额外等待 networkidle
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      console.log('  networkidle 超时')
    })
    console.log(`  总等待完成 (${Date.now() - start}ms)`)

    const html = await page.content()
    console.log(`  HTML 大小: ${html.length} bytes`)

    if (html.length < 5000) {
      console.log('  ⚠️ HTML 太小，打印前 2000 字符:')
      console.log(html.slice(0, 2000))
    } else {
      console.log('  ✓ HTML 大小正常')
      // 打印前 500 char
      console.log('  前 500 字符:')
      console.log(html.slice(0, 500))
    }

    // 截图
    await page.screenshot({
      path: `.claude/test-${name.replace(/[/\s]/g, '_')}.png`,
      fullPage: false,
    })
    console.log('  ✓ 截图已保存')
  } catch (err) {
    console.log(`  ✗ 失败: ${err.message}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  console.log('═══ 测试 1: Bot UA 访问 Reuters ═══')
  await test('https://www.reuters.com/world/', BOT_UA, 'Reuters-bot-ua')

  console.log('\n═══ 测试 2: 真实 UA 访问 Reuters ═══')
  await test('https://www.reuters.com/world/', REAL_UA, 'Reuters-real-ua')

  console.log('\n═══ 测试 3: 真实 UA 访问 Al Jazeera ═══')
  await test('https://www.aljazeera.com/news/', REAL_UA, 'AlJazeera-real-ua')

  console.log('\n═══ 测试 4: 真实 UA 访问 AP News ═══')
  await test('https://apnews.com/world-news', REAL_UA, 'APNews-real-ua')

  console.log('\n完成。')
}

main().catch(console.error)
