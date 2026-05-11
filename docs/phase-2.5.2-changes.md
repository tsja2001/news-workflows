# Phase 2.5.2 变更说明

## 新增 type: web

极简配置即可抓取任何新闻网站，Playwright 处理渲染 + AI 提取内容。

### yaml 配置

```yaml
sources:
  - name: BBC 中东
    type: web
    url: "https://www.bbc.com/news/world/middle_east"
    # 以下均为可选
    maxArticles: 10
    hint: "新闻列表在主面板，忽略侧边推荐"
    waitFor:
      type: networkidle          # networkidle | selector | timeout
    sessionFile: "state/sessions/example.json"
    fetchDetail: true
    detailExtraction: auto       # auto | readability | ai
    detailConcurrency: 2
```

### 新增模块

- `src/fetch/web.js` — 主入口 `fetchFromWeb()`
- `src/fetch/web/prompts.js` — AI prompt 集中管理
- `src/fetch/web/browser.js` — Playwright context 管理 + 导航 + 截图
- `src/fetch/web/extract-list.js` — AI 提取链接列表 + URL 合法化
- `src/fetch/web/extract-detail.js` — 三种正文提取策略（auto/readability/ai）

### 流程

1. 浏览器打开列表页 → HTML 瘦身（list 模式）
2. AI 提取链接列表 → URL 合法化
3. 逐个访问详情页 → 正文提取（readability / AI / auto）

### 测试

- `src/fetch/web/extract-list.test.js`：URL 合法化测试
- `src/fetch/web/extract-detail.test.js`：三种策略分支 + readability 成功路径

### 其他

- `state/sessions/` 加入 `.gitignore`
- `config/topics/_test-web.yaml` 新增测试配置
- `src/fetch/index.js` ADAPTERS 注册 web 类型
