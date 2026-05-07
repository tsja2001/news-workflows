# Phase 2.6.3: 审计日志（JSONL）

## 变更摘要

每次抓取生成完整的 JSONL 审计日志，记录从"AI 看到的所有候选"到"最终进入简报的条目"的完整流转。

## 新增模块

### `src/utils/auditor.js`

审计日志记录器：
- `createAuditor({ topic, logDir })` — 创建审计器
- `auditor.event(eventType, data)` — 写入一条事件
- `auditor.scoped(source, sourceType)` — 创建带 source 上下文的子审计器
- `auditor.finalize()` — 生成 summary.json 并关闭

JSONL 文件位置：`logs/audit/{date}/{topic}-{runId}.jsonl`
Summary 文件：`logs/audit/{date}/{topic}-{runId}.summary.json`

### 事件类型

| event | 触发时机 |
|-------|---------|
| `run_started` | 流程启动 |
| `source_started` | 单个 source 开始 |
| `list_page_loaded` | 列表页渲染完成 |
| `list_extracted` | AI 提取列表完成 |
| `candidates_filtered` | 候选去重 + 排序完成 |
| `detail_extracted` | 详情抓取成功 |
| `detail_failed` | 详情抓取失败 |
| `source_completed` | source 处理完成 |
| `source_failed` | source 整体失败 |
| `pipeline_filter` | 过滤管线每一步 |
| `llm_input_prepared` | 发给 LLM 的最终列表 |
| `llm_response_received` | LLM 返回 |
| `run_completed` | 全流程完成 |

## 修改文件

- `src/utils/auditor.js` — 新模块
- `src/llm.js` — 新增 `callLLMForJsonWithMeta()`，返回 token 用量
- `src/fetch/web.js` — 接入审计事件
- `src/fetch/web/extract-list.js` — 接入审计（list_extracted）
- `src/fetch/web/extract-detail.js` — 接入审计（detail_extracted）
- `src/fetch/common.js` — 过滤管线事件
- `src/fetch/index.js` — 传递审计器到 adapter 和过滤
- `src/fetch.js` — 传递审计器
- `src/summarize.js` — LLM 输入/响应事件
- `src/index.js` — 创建/销毁审计器
- `.env.example` — 新增价格配置变量

## 约束

- JSONL 单条事件 ≤ 100KB
- 不写 HTML 全文、prompt 全文、文章正文
- 终端日志单行 ≤ 250 字符（继承 2.5.1 规则）
- 用 `appendFileSync` 确保并发安全

## 测试

```bash
npm test
# 运行后检查审计日志
ls logs/audit/$(date +%Y-%m-%d)/
```
