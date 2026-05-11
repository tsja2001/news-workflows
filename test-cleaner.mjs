/**
 * 深度诊断：测试 HTML cleaner + 尝试绕过 DataDome
 */

import { chromium } from 'playwright-core'
import { cleanHtml } from './src/utils/html-cleaner.js'
import fs from 'fs/promises'

const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

async function testAlJazeeraCleaning() {
  console.log('\n═══ Al Jazeera HTML 清洗诊断 ═══')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  })
  const page = await context.newPage()

  await page.goto('https://www.aljazeera.com/news/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const raw = await page.content()
  console.log(`原始 HTML: ${raw.length} bytes`)

  // 保存原始 HTML
  await fs.writeFile('.claude/test-aj-raw.html', raw)
  console.log('✓ 原始 HTML 已保存到 .claude/test-aj-raw.html')

  // 测试清洗
  const { cleaned, originalLength, cleanedLength } = cleanHtml(raw, { mode: 'list', maxChars: 1000000 })
  console.log(`清洗后: ${originalLength} → ${cleanedLength} bytes (${(cleanedLength / originalLength * 100).toFixed(1)}%)`)

  // 检查是否有很多 <a> 标签
  const aCount = (raw.match(/<a /gi) || []).length
  const aCountClean = (cleaned.match(/<a /gi) || []).length
  console.log(`<a> 标签数: ${aCount} (原始) vs ${aCountClean} (清洗后)`)

  // 保存清洗后的
  await fs.writeFile('.claude/test-aj-cleaned.html', cleaned)
  console.log('✓ 清洗后 HTML 已保存到 .claude/test-aj-cleaned.html')

  // 测试不同 cleanHtml 模式
  // 手动不删 header/footer/nav/aside 试试
  const { cleaned: cleaned2 } = cleanHtml(raw, { mode: 'article', maxChars: 1000000 })
  console.log(`article 模式清洗后: ${cleaned2.length} bytes`)

  await context.close()
  await browser.close()
}

async function testReutersWait() {
  console.log('\n═══ Reuters DataDome 等待测试 ═══')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })
  const page = await context.newPage()

  const start = Date.now()

  // 监听页面跳转（DataDome 通过后可能会跳转）
  let redirected = false
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      const url = frame.url()
      if (!url.includes('captcha-delivery.com')) {
        console.log(`  页面导航到: ${url}`)
        redirected = true
      }
    }
  })

  await page.goto('https://www.reuters.com/world/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  // 等待更长时间让 captcha JS 执行
  console.log('  等待 15 秒让 captcha 执行...')
  await page.waitForTimeout(15000)

  const html = await page.content()
  console.log(`  最终 HTML: ${html.length} bytes`)
  console.log(`  是否重定向: ${redirected}`)

  if (html.length < 5000) {
    console.log('  仍然是 captcha 页面 — DataDome 拦截了 headless 浏览器')
    // 尝试截图
    await page.screenshot({ path: '.claude/test-reuters-final.png' })
    console.log('  ✓ 截图已保存')
  } else {
    console.log('  ✓ 成功突破!')
    await fs.writeFile('.claude/test-reuters-passed.html', html)
  }

  await context.close()
  await browser.close()
}

async function testReutersHeadlessNew() {
  console.log('\n═══ Reuters headless: "new" 模式测试 ═══')

  // 新版 headless 模式更接近 headed
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--headless=new',  // 新版 headless 模式
      '--no-sandbox',
    ],
  })
  const context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })
  const page = await context.newPage()

  const start = Date.now()
  await page.goto('https://www.reuters.com/world/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  // 等 network idle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

  // 再等 10 秒
  console.log('  等待 10 秒...')
  await page.waitForTimeout(10000)

  const html = await page.content()
  console.log(`  最终 HTML: ${html.length} bytes (耗时 ${Date.now() - start}ms)`)

  // 检查是否还是 captcha
  const isCaptcha = html.includes('captcha-delivery.com')
  console.log(`  是否是 captcha: ${isCaptcha}`)

  if (html.length < 5000) {
    console.log('  ✗ 仍然是 captcha')
  } else {
    console.log('  ✓ 成功!')
  }

  await context.close()
  await browser.close()
}

async function main() {
  await testAlJazeeraCleaning()
  await testReutersWait()
  await testReutersHeadlessNew()
  console.log('\n完成。')
}

main().catch(console.error)
