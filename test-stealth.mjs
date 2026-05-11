/**
 * 测试反检测绕过效果
 */
import { chromium } from 'playwright-core'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

const STEALTH_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    plugins.item = (i) => plugins[i] || null;
    plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
    plugins.refresh = () => {};
    return plugins;
  }
});
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const types = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    types.item = (i) => types[i] || null;
    types.namedItem = (name) => types.find(t => t.type === name) || null;
    return types;
  }
});
window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
window.navigator.permissions.query = (params) =>
  params.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission, onchange: null })
    : originalQuery(params);
`

async function test(url, name) {
  console.log(`\n=== 测试: ${name} (带反检测) ===`)

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  })

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })

  await context.addInitScript(STEALTH_SCRIPT)

  const page = await context.newPage()
  const start = Date.now()

  try {
    // 检查 webdriver 是否被隐藏
    const isWebdriver = await page.evaluate(() => navigator.webdriver)
    console.log(`  navigator.webdriver: ${isWebdriver}`)

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`  domcontentloaded (${Date.now() - start}ms)`)

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('  networkidle 超时')
    })

    // 额外等待（DataDome 可能需要几秒执行 JS 挑战）
    console.log('  额外等待 5 秒让 JS 执行...')
    await page.waitForTimeout(5000)

    const html = await page.content()
    const isCaptcha = html.includes('captcha-delivery.com') || html.includes('DataDome')

    console.log(`  HTML: ${html.length} bytes, 是否是 captcha: ${isCaptcha}`)

    if (html.length < 5000) {
      console.log('  ⚠️ 仍然是 captcha')
      console.log('  前 300 字符:', html.slice(0, 300))
    } else {
      console.log('  ✓ 成功获取页面内容!')
      const aCount = (html.match(/<a /gi) || []).length
      console.log(`  <a> 标签数: ${aCount}`)
    }
  } catch (err) {
    console.log(`  ✗ 失败: ${err.message}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  console.log('═══ 带反检测措施的测试 ═══')

  await test('https://www.reuters.com/world/', 'Reuters-stealth')
  await test('https://www.aljazeera.com/news/', 'AlJazeera-stealth')
  await test('https://apnews.com/world-news', 'APNews-stealth')

  console.log('\n完成。')
}

main().catch(console.error)
