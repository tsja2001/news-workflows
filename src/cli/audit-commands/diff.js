/**
 * npm run audit -- diff <runId1> <runId2>
 */

import { getAuditDir, findRun, parseJsonl, formatDuration } from './utils.js'

export async function cmdDiff(runId1, runId2) {
  const auditDir = getAuditDir()
  const run1 = findRun(runId1, auditDir)
  const run2 = findRun(runId2, auditDir)

  if (!run1) { console.error(`未找到运行记录: ${runId1}`); process.exit(1) }
  if (!run2) { console.error(`未找到运行记录: ${runId2}`); process.exit(1) }

  console.log(`对比: ${run1.topic} 两次运行`)
  console.log(`  早: ${(run1.startedAt || '').replace('T', ' ').slice(0, 16)} → LLM 输入 ${run1.llm?.itemCount || '?'} 条`)
  console.log(`  晚: ${(run2.startedAt || '').replace('T', ' ').slice(0, 16)} → LLM 输入 ${run2.llm?.itemCount || '?'} 条`)
  console.log()

  // 收集两次运行的最终 URL
  function collectFinalUrls(run) {
    const events = parseJsonl(run.jsonlPath)
    const urls = new Set()
    for (const evt of events) {
      if (evt.event === 'llm_input_prepared') {
        for (const item of evt.data?.items || []) {
          urls.add(item.url)
        }
      }
    }
    return urls
  }

  const urls1 = collectFinalUrls(run1)
  const urls2 = collectFinalUrls(run2)

  const only1 = [...urls1].filter(u => !urls2.has(u))
  const only2 = [...urls2].filter(u => !urls1.has(u))

  if (only2.length > 0) {
    console.log(`新增条目 (${only2.length}):`)
    // 从 run2 的事件中找出标题
    const events2 = parseJsonl(run2.jsonlPath)
    for (const url of only2.slice(0, 10)) {
      const title = findTitle(url, events2)
      console.log(`  - ${title} (${url.slice(0, 70)}...)`)
    }
    if (only2.length > 10) console.log(`  ... 还有 ${only2.length - 10} 条`)
    console.log()
  }

  if (only1.length > 0) {
    console.log(`消失的条目 (${only1.length}):`)
    const events1 = parseJsonl(run1.jsonlPath)
    for (const url of only1.slice(0, 10)) {
      const title = findTitle(url, events1)
      console.log(`  - ${title} (${url.slice(0, 70)}...)`)
    }
    if (only1.length > 10) console.log(`  ... 还有 ${only1.length - 10} 条`)
    console.log()
  }

  if (only2.length === 0 && only1.length === 0) {
    console.log('两次运行的最终条目完全相同。')
  }

  // 源对比
  console.log('源对比:')
  const srcMap1 = new Map(run1.sources.map(s => [s.name, s]))
  const srcMap2 = new Map(run2.sources.map(s => [s.name, s]))
  const allSrcNames = new Set([...srcMap1.keys(), ...srcMap2.keys()])

  for (const name of allSrcNames) {
    const s1 = srcMap1.get(name)
    const s2 = srcMap2.get(name)
    const s1detail = s1 ? `${s1.detailsSucceeded || 0}/${s1.detailsFetched || 0}` : 'N/A'
    const s2detail = s2 ? `${s2.detailsSucceeded || 0}/${s2.detailsFetched || 0}` : 'N/A'
    const change = s1 && s2 ? `(${s1detail} → ${s2detail})` : ''
    console.log(`  ${name}: ${s1detail} → ${s2detail} ${change}`)
  }
}

function findTitle(url, events) {
  for (const evt of events) {
    if (evt.event === 'list_extracted') {
      for (const c of evt.data?.candidates || []) {
        if (c.url === url) return c.title
      }
    }
    if (evt.event === 'detail_extracted' && evt.data?.url === url) {
      return evt.data.title || evt.data.url
    }
    if (evt.event === 'llm_input_prepared') {
      for (const item of evt.data?.items || []) {
        if (item.url === url) return item.title
      }
    }
  }
  return url
}
