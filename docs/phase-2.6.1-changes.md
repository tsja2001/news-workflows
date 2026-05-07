# Phase 2.6.1: 多 listUrl + 分页支持

## 变更摘要

让一个 source 能覆盖多个版块、多页内容，避免为不同版块拆成多个 source。

## 新增配置字段

### 多 URL（urls 数组）

```yaml
# 老格式（继续支持）
- name: BBC 中东
  type: web
  url: "https://bbc.com/news/world/middle_east"

# 新格式 1：多 URL 纯字符串数组
- name: BBC News（多版块）
  type: web
  urls:
    - "https://bbc.com/news/world/middle_east"
    - "https://bbc.com/news/world/asia"
  maxArticles: 30

# 新格式 2：每个 URL 带独立 hint
- name: BBC News（细致版）
  type: web
  urls:
    - url: "https://bbc.com/news/world/middle_east"
      hint: "中东相关"
    - url: "https://bbc.com/news/world/asia"
      hint: "亚洲相关"
```

### 分页（{page} 占位符）

```yaml
- name: 多页新闻站
  type: web
  url: "https://example.com/news?page={page}"
  pages: 3        # 抓 page=1, 2, 3
  pageStart: 1    # 默认 1
  pageDelayMs: 2000  # 页间延迟，默认 1000ms
```

### 字段语义

- `url`（单数）和 `urls`（数组）互斥，必须有一个
- `urls` 数组支持混用纯字符串和 `{ url, hint }` 对象
- 顶层 `hint` 作为默认提示，per-URL hint 优先
- `{page}` 必须有对应的 `pages`
- 全局硬上限：单个 source 最多展开 20 个 URL

## 新增文件

- `src/fetch/web/url-expander.js` — URL 展开模块
- `src/fetch/web/url-expander.test.js` — 单元测试

## 修改文件

- `src/fetch/web.js` — 主流程改为多 URL 迭代处理，新增 URL 去重、页间延迟
- `src/fetch/web/extract-list.js` — 移除内部 maxArticles 截断，由 web.js 统一截断
- `src/config.js` — 新增 `validateSource()` 校验 url/urls 互斥、{page}/pages 配对

## 测试

```bash
# 新建多 URL 测试配置
cat > config/topics/_test-multi-url.yaml <<'EOF'
id: _test-multi-url
title: 多URL测试
sources:
  - name: HN 多版块
    type: web
    urls:
      - "https://news.ycombinator.com/"
      - "https://news.ycombinator.com/newest"
    maxArticles: 5
output:
  dir: "/tmp/news-test"
EOF

npm run brief _test-multi-url
npm test
```
