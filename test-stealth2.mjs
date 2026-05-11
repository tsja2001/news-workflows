/**
 * 测试 playwright-extra + stealth plugin 绕过 DataDome
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

async function test(url, name) {
  console.log(`\n=== ${name} ===`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })
  const page = await context.newPage()
  const start = Date.now()

  try {
    const isWebdriver = await page.evaluate(() => navigator.webdriver)
    console.log(`  webdriver: ${isWebdriver}`)

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`  domcontentloaded (${Date.now() - start}ms)`)

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('  networkidle 超时')
    })

    // 等待 captcha 执行
    console.log('  等待 8 秒...')
    await page.waitForTimeout(8000)

    const html = await page.content()
    console.log(`  HTML: ${html.length} bytes`)

    if (html.includes('captcha-delivery.com') || html.length < 5000) {
      console.log('  ✗ 仍被 DataDome 拦截')
    } else {
      console.log('  ✓ 成功绕过!')
    }
  } catch (err) {
    console.log(`  ✗ 失败: ${err.message}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  console.log('═══ playwright-extra + stealth ═══')
  await test('https://www.reuters.com/world/', 'Reuters')
  await test('https://www.aljazeera.com/news/', 'Al Jazeera')
  console.log('\n完成。')
}

main().catch(console.error)
