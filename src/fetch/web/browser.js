/**
 * ============================================================
 * 浏览器管理 — 复用 Phase 2 playwright.js 的 browser 单例
 * ============================================================
 *
 * 每个 fetchFromWeb 调用使用独立 context，失败时关 context 不关 browser。
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'

// 用真实浏览器 UA，避免被反爬系统识别为 bot
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

// 复用 playwright.js 的单例引用
let _browser = null

/** 获取或创建 browser 单例 */
async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
  }
  return _browser
}

/** 检查文件是否存在 */
async function fileExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 注入反检测脚本，隐藏 headless 浏览器特征
 */
const STEALTH_SCRIPT = `
// 隐藏 webdriver 标记
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// 模拟 plugins 数组（headless 下为空）
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

// 模拟 mimeTypes
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

// 模拟 chrome.runtime（headless 下缺失）
window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };

// 覆盖权限查询
const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
window.navigator.permissions.query = (params) =>
  params.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission, onchange: null })
    : originalQuery(params);
`

/**
 * 为一个 source 创建新的 browser context
 *
 * @param {object} sourceConfig
 * @param {boolean} blockResources
 * @param {Function} logger - logger 实例
 * @returns {Promise<{ context: import('playwright-core').BrowserContext, page: import('playwright-core').Page }>}
 */
export async function createContext(sourceConfig, blockResources, logger) {
  const browser = await getBrowser()
  const contextOptions = {}

  // session 文件复用（被动消费）
  const sessionFile = sourceConfig.sessionFile
  if (sessionFile && await fileExists(sessionFile)) {
    contextOptions.storageState = sessionFile
    logger.info('加载登录态', { sessionFile })
  }

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    permissions: ['geolocation'],
    ...contextOptions,
  })

  // 注入反检测脚本
  await context.addInitScript(STEALTH_SCRIPT)

  // 屏蔽图片/字体/CSS 资源以加速
  if (blockResources) {
    await context.route('**/*.{png,jpg,jpeg,svg,gif,webp,woff,woff2,ttf,css,ico}',
      r => r.abort())
  }

  return context
}

/**
 * 安全关闭 context
 * @param {import('playwright-core').BrowserContext} context
 */
export async function closeContext(context) {
  if (!context) return
  try {
    await context.close()
  } catch {
    // 忽略关闭错误
  }
}

/**
 * 浏览器导航到 URL，按策略等待加载
 *
 * @param {import('playwright-core').Page} page
 * @param {string} url
 * @param {object} [waitFor]
 * @param {'networkidle' | 'selector' | 'timeout'} [waitFor.type]
 * @param {string} [waitFor.selector]
 * @param {number} [waitFor.timeoutMs=30000]
 * @returns {Promise<number>} 耗时 ms
 */
export async function navigateAndWait(page, url, waitFor = {}) {
  const type = waitFor.type || 'networkidle'
  const timeoutMs = waitFor.timeoutMs || 30000

  const start = Date.now()

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  })

  if (type === 'networkidle') {
    // 等待网络空闲
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {
      // networkidle 超时不致命，页面已经 domcontentloaded
    })
  } else if (type === 'selector' && waitFor.selector) {
    await page.waitForSelector(waitFor.selector, { timeout: timeoutMs })
  } else if (type === 'timeout') {
    // 单纯等待固定时间
    await page.waitForTimeout(Math.min(timeoutMs, 10000))
  }

  return Date.now() - start
}

/**
 * 截图失败页面到 logs/web-failures/
 * @param {import('playwright-core').Page} page
 * @param {string} sourceName
 */
export async function screenshotFailure(page, sourceName) {
  try {
    const dir = path.join(process.cwd(), 'logs', 'web-failures')
    await fs.mkdir(dir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${ts}-${sourceName.replace(/[/\s]/g, '_')}.png`
    await page.screenshot({ path: path.join(dir, filename), fullPage: false })
  } catch {
    // 截图失败不影响主流程
  }
}

export { getBrowser, fileExists }
