# 审计日志文档

每次 `npm run brief <topic>` 运行会生成一份 JSONL 审计日志和一份 JSON 汇总文件。

## 文件位置

```
logs/audit/{YYYY-MM-DD}/
├── {topic}-{runId}.jsonl         # 主审计日志（JSONL）
└── {topic}-{runId}.summary.json  # 汇总（JSON）
```

## 统一信封

每条事件都有相同的顶层字段：

```json
{
  "ts": "2026-05-05T14:30:52.123Z",
  "topic": "us-iran",
  "runId": "20260505-143052-abc12",
  "source": "BBC News",
  "sourceType": "web",
  "event": "list_extracted",
  "data": { ... }
}
```

## 事件类型详解

### list_extracted

AI 从列表页提取出的所有候选链接：

```json
{
  "event": "list_extracted",
  "data": {
    "url": "https://bbc.com/news/world/middle_east",
    "count": 32,
    "candidates": [
      {
        "title": "新闻标题",
        "url": "https://...",
        "publishedAt": "2026-05-05T08:00:00Z",
        "summary": "摘要...",
        "section": "头条",
        "confidence": "high"
      }
    ],
    "tokens": { "input": 4521, "output": 842 },
    "durationMs": 5234
  }
}
```

### candidates_filtered

候选池去重 + 排序后的结果：

```json
{
  "event": "candidates_filtered",
  "data": {
    "before": 87,
    "after": 50,
    "dropped": [
      { "url": "...", "reason": "duplicate" },
      { "url": "...", "reason": "exceeded_maxArticles", "confidence": "low" }
    ]
  }
}
```

### detail_extracted

详情页抓取成功：

```json
{
  "event": "detail_extracted",
  "data": {
    "url": "https://...",
    "title": "新闻标题",
    "strategy": "readability",
    "length": 2341,
    "readabilityLen": 2341,
    "aiLen": 2100,
    "tokens": { "input": 800, "output": 300 },
    "durationMs": 1200
  }
}
```

### detail_failed

详情页抓取失败：

```json
{
  "event": "detail_failed",
  "data": {
    "url": "https://...",
    "reason": "timeout",
    "durationMs": 30000
  }
}
```

### pipeline_filter

过滤管线每一步（time / keyword / url_dedup / truncate）：

```json
{
  "event": "pipeline_filter",
  "data": {
    "stage": "time",
    "before": 100,
    "after": 80,
    "dropped": 20
  }
}
```

### llm_input_prepared

最终发给 LLM 的新闻列表（不含正文内容，只含长度）：

```json
{
  "event": "llm_input_prepared",
  "data": {
    "itemCount": 67,
    "items": [
      { "title": "...", "url": "...", "source": "...", "publishedAt": "...", "contentLength": 2341 }
    ]
  }
}
```

### llm_response_received

LLM 返回：

```json
{
  "event": "llm_response_received",
  "data": {
    "tokens": { "input": 45234, "output": 5821 },
    "model": "deepseek-chat",
    "durationMs": 12345
  }
}
```

## 查询方法

### 用 jq 查询

```bash
# 查看所有 list_extracted 事件的候选标题
cat logs/audit/2026-05-05/us-iran-*.jsonl | jq -r 'select(.event == "list_extracted") | .data.candidates[].title'

# 查看所有失败的详情页
cat logs/audit/2026-05-05/us-iran-*.jsonl | jq 'select(.event == "detail_failed")'

# 查看过滤管线汇总
cat logs/audit/2026-05-05/us-iran-*.jsonl | jq 'select(.event == "pipeline_filter")'

# 统计各 source 的 tokens
cat logs/audit/2026-05-05/us-iran-*.jsonl | jq -r '[.source, .data.tokens.input // 0] | @tsv'
```

### 查看 summary

```bash
cat logs/audit/2026-05-05/us-iran-*.summary.json | jq .
```

## 约束

- 单条事件 ≤ 100KB（超出截断）
- 不写 HTML 全文、prompt 全文、文章正文（只写长度）
- 循环引用自动替换为 `[Circular]`
- 用 `appendFileSync` 写入，确保进程崩溃时不丢数据

## 成本估算

summary.json 中的成本估算基于 `.env` 中的价格配置：

```
LLM_INPUT_PRICE_PER_1M_TOKENS=0.14   # 输入价格（元/百万 token）
LLM_OUTPUT_PRICE_PER_1M_TOKENS=0.28  # 输出价格（元/百万 token）
```

默认值为 DeepSeek 标准价格的近似值，可根据实际 API 供应商调整。
