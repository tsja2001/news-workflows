# Phase 2.6.2: AI 穷尽提取 + 放开数量

## 变更摘要

让 AI 提取得更彻底，默认抓取数量上限放开，适配"不在意 token 和耗时"的深度抓取场景。

## 1. 深度提取模式（extractDepth: deep）

### 新 prompt

新增 `LIST_EXTRACT_DEEP_SYSTEM`，关键变化：
- 强调"穷尽"而非"识别"——包括侧栏推荐、专题区、更多新闻等所有区块
- 引入 `confidence` 字段（high / medium / low），AI 标记不确定性而非直接丢弃
- 引入 `section` 字段，记录条目来源区块（头条/专题/侧栏推荐等）
- 明确要求不去重、不排序、不限制数量

### 候选优先级

提取后按 confidence 排序：high → medium → low，low 条目不丢弃而是排在最后。

### 配置

```yaml
- name: 某站
  type: web
  url: ...
  extractDepth: deep   # 'normal' | 'deep'，默认 'deep'
```

## 2. 深度详情提取（detailExtraction: deep）

新增 `deep` 策略：
1. 同时执行 Readability 和 AI 提取
2. 取正文长度更长者
3. 两个结果都记录（`_readabilityLen` / `_aiLen`），便于审计

```yaml
- name: 某站
  type: web
  url: ...
  detailExtraction: deep   # 'auto' | 'readability' | 'ai' | 'deep'
```

## 3. 默认值调整

| 配置 | 旧默认 | 新默认 |
|------|-------|-------|
| `maxArticles` | 10 | 50 |
| `detailConcurrency` | 2 | 3 |
| `filter.maxItems` | 40 | 80 |

## 4. 硬上限保护

- 候选池最多 500 条（超出截断并 warn）
- maxArticles 最大 100（超出报错）

## 修改文件

- `src/fetch/web/prompts.js` — 新增 `LIST_EXTRACT_DEEP_SYSTEM`
- `src/fetch/web/extract-list.js` — 支持 extractDepth 参数、confidence 解析、`sortByConfidence()` 排序
- `src/fetch/web/extract-detail.js` — 新增 `deep` 策略
- `src/fetch/web.js` — 默认值调整、confidence 排序接入、候选池上限
- `src/fetch/index.js` — filter.maxItems 默认 80

## 测试

```bash
npm test
```
