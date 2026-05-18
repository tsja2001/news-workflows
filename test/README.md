# Source Probe 使用说明

探针工具用于快速诊断每个新闻源的健康状况，避免完整运行一次才能发现问题。

## 基本用法

```bash
npm run probe <topic-id>
```

例如：

```bash
npm run probe global-geopolitical-conflicts-test
```

## 常用参数

| 参数 | 说明 |
|------|------|
| `--all` | 强制重测所有源（忽略之前的通过记录） |
| `--source <关键词>` | 只测名称包含关键词的源，如 `--source "Reuters"` |
| `--full` | 同时估算 summarize 阶段的 token 用量 |
| `--timeout <秒>` | 覆盖默认超时，如 `--timeout 60` |
| `--reset` | 清除该 topic 的所有历史状态，然后退出 |

## 运行效果

每个源测完实时打印一行结果：

```
[1/21] ✓ PASS     Reuters 全球与区域          web    12篇  45.2s
[2/21] ✗ TIMEOUT  Al Jazeera 全球与中东        web    0篇  120.0s
[3/21] - SKIP     Guardian 世界与地区          web    (上次通过于 2026-05-15)
```

四种状态：
- **PASS** — 正常获取到文章，下次默认跳过
- **EMPTY** — 运行正常但没拿到文章，每次重测
- **TIMEOUT** — 超时未响应，每次重测
- **ERROR** — 抛出异常，每次重测

结束后打印汇总、失败源清单、内容质量统计，并在 `test/probe/results/` 生成详细 JSON 报告。

## 状态持久化

通过的源会记录到 `test/probe/state.json`，默认 **3 天内**不再重复测试。可通过 `--pass-ttl <天>` 调整有效期。

已通过 + 未过期 + 未传 `--all` → 显示为灰色的 `[SKIP]`。
