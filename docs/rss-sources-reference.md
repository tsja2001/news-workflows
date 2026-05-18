# 全球新闻 RSS 源参考清单

> 面向地缘冲突与国际安全议题的 RSS 源整理。分为官方源和社区维护源两类。
> 所有 URL 基于知识库整理，部分已通过实际运行验证，初次使用前建议用 RSS 阅读器验证一次。

---

## 一、可靠性说明

| 标记 | 含义 |
|------|------|
| ✅ 官方 | 媒体机构官方维护，长期稳定 |
| 🔧 RSSHub | 社区维护的转换工具，需自行部署或用公共实例 |
| 🔍 Google News | 谷歌新闻聚合，实时但不保证来源稳定 |
| ⚠️ 验证 | 地址来自文档/社区，建议先手动测试 |
| ❌ 无 RSS | 官方已停止提供，需要替代方案 |
| 📰 全文 | RSS 包含完整正文 |
| 📝 摘要 | RSS 只有标题+摘要，需要 `fetchFullContent: true` 回抓 |

---

## 二、全球通讯社 / 综合国际新闻

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| Reuters 世界新闻 | `https://news.google.com/rss/search?q=when:1d+site:reuters.com&hl=en-US&gl=US&ceid=US:en` | 🔍 Google | 📝 摘要 | Reuters 官方 RSS 已于 2020 年停止，此为替代 |
| Reuters via RSSHub | `https://rsshub.app/reuters/world` | 🔧 RSSHub | 📝 摘要 | 需要可访问的 RSSHub 实例 |
| AP 国际新闻 | `https://news.google.com/rss/search?q=when:1d+site:apnews.com&hl=en-US&gl=US&ceid=US:en` | 🔍 Google | 📝 摘要 | AP 官方 RSS 已停止 |
| AP via RSSHub | `https://rsshub.app/apnews/topics/world-news` | 🔧 RSSHub | 📝 摘要 | ⚠️ 验证 |
| BBC 世界新闻 | `http://feeds.bbci.co.uk/news/world/rss.xml` | ✅ 官方 | 📝 摘要 | 长期稳定，BBC 官方维护 |
| BBC 中文 | `http://feeds.bbci.co.uk/zhongwen/simp/world/rss.xml` | ✅ 官方 | 📝 摘要 | 中文版 |
| Al Jazeera 全部 | `https://www.aljazeera.com/xml/rss/all.xml` | ✅ 官方 | 📝 摘要 | **已验证可用**，更新频繁 |
| Al Jazeera 英文新闻 | `https://www.aljazeera.com/xml/rss/all.xml` | ✅ 官方 | 📝 摘要 | 同上，全站覆盖 |
| The Guardian 世界 | `https://www.theguardian.com/world/rss` | ✅ 官方 | 📰 全文 | Guardian 极少数提供全文的主流媒体 |
| France24 英文 | `https://www.france24.com/en/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证（官方声称有） |
| France24 国际 | `https://www.france24.com/en/international/rss` | ✅ 官方 | 📝 摘要 | 分类 feed |
| DW 英文全部 | `https://rss.dw.com/rdf/rss-en-all` | ✅ 官方 | 📝 摘要 | 德国之声，官方维护 |
| DW 英文头条 | `https://rss.dw.com/rdf/rss-en-top` | ✅ 官方 | 📝 摘要 | 只要头条 |
| RFI 英文 | `https://www.rfi.fr/en/rss` | ✅ 官方 | 📝 摘要 | 法国国际广播，覆盖非洲尤佳 |
| NPR 世界新闻 | `https://feeds.npr.org/1004/rss.xml` | ✅ 官方 | 📝 摘要 | 美国公共广播 |
| NPR 政治 | `https://feeds.npr.org/1014/rss.xml` | ✅ 官方 | 📝 摘要 | |
| New York Times 世界 | `https://rss.nytimes.com/services/xml/rss/nyt/World.xml` | ✅ 官方 | 📝 摘要 | 正文有付费墙，摘要可免费获取 |
| Washington Post 世界 | `https://feeds.washingtonpost.com/rss/world` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Foreign Policy | `https://foreignpolicy.com/feed/` | ✅ 官方 | 📝 摘要 | 地缘政治深度分析 |
| The Economist 世界 | `https://www.economist.com/world/rss.xml` | ✅ 官方 | 📝 摘要 | 付费墙，摘要可用 |
| 联合国新闻 | `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | ✅ 官方 | 📝 摘要 | 联合国官方，覆盖安理会等 |

---

## 三、俄乌 / 欧洲 / 北约

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| Kyiv Independent | `https://kyivindependent.com/feed/` | ✅ 官方 | 📰 全文 | **已验证**，乌克兰视角头部媒体 |
| Kyiv Post | `https://www.kyivpost.com/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Ukrinform 英文 | `https://www.ukrinform.net/rss/block-lastnews` | ✅ 官方 | 📝 摘要 | 乌克兰官方通讯社英文版 |
| Radio Free Europe/RFL | `https://www.rferl.org/api/zvtijmeslt` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，RFE/RL 侧重东欧/中亚 |
| RFE/RL Ukraine | `https://www.rferl.org/api/epipeqiqnye` | ✅ 官方 | 📝 摘要 | 乌克兰专题 |
| The Moscow Times | `https://www.themoscowtimes.com/rss/news` | ✅ 官方 | 📝 摘要 | 流亡俄罗斯独立媒体，提供俄罗斯视角 |
| Meduza 英文 | `https://meduza.io/en/rss/all` | ✅ 官方 | 📰 全文 | 俄罗斯独立媒体（拉脱维亚注册）|
| Bellingcat | `https://www.bellingcat.com/feed/` | ✅ 官方 | 📰 全文 | 开源情报调查，东欧/冲突核查 |
| NATO 新闻 | `https://www.nato.int/cps/en/natolive/news.htm?selectedLocale=en&format=rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| 欧盟外交行动署 EEAS | Google News 替代: `https://news.google.com/rss/search?q=site:eeas.europa.eu&hl=en` | 🔍 Google | 📝 摘要 | 官方网站无 RSS |

---

## 四、中东 / 北非

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | ✅ 官方 | 📝 摘要 | **已验证**，中东报道最强 |
| Times of Israel | `https://www.timesofisrael.com/feed/` | ✅ 官方 | 📝 摘要 | **已验证**，以色列主要英文媒体 |
| Times of Israel Breaking | `https://www.timesofisrael.com/blogs/liveblog/feed/` | ✅ 官方 | 📝 摘要 | 实时动态 liveblog |
| Jerusalem Post | `https://www.jpost.com/rss/rssfeedsworld.aspx` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Middle East Eye | `https://www.middleeasteye.net/rss` | ✅ 官方 | 📝 摘要 | 独立中东媒体，批判性视角 |
| Arab News | `https://www.arabnews.com/rss.xml` | ✅ 官方 | 📝 摘要 | 沙特英文媒体，海湾视角 |
| Haaretz 英文 | `https://www.haaretz.com/cmlink/1.628752` | ✅ 官方 | 📝 摘要 | 以色列自由派媒体，部分付费 |
| Al-Monitor 中东 | `https://www.al-monitor.com/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，深度中东分析 |
| MEI (中东研究所) | `https://www.mei.edu/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，学术分析 |
| 伊朗国际英文 | `https://www.iranintl.com/en/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，伊朗独立媒体 |

---

## 五、亚太 / 印太安全

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| SCMP 中国外交 | `https://www.scmp.com/rss/91/feed` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，SCMP 分类 ID 可能变化 |
| SCMP 亚洲 | `https://www.scmp.com/rss/2/feed` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Nikkei Asia | `https://asia.nikkei.com/rss/feed/nar` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，日经亚洲版 |
| The Diplomat | `https://thediplomat.com/feed/` | ✅ 官方 | 📝 摘要 | 亚太地缘政治专业媒体 |
| The Hindu 国际 | `https://www.thehindu.com/news/international/feeder/default.rss` | ✅ 官方 | 📝 摘要 | 印度主要英文媒体，南亚视角 |
| Asia Times | `https://asiatimes.com/feed/` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| NK News (朝鲜) | `https://www.nknews.org/feed/` | ✅ 官方 | 📝 摘要 | 朝鲜半岛专业媒体 |
| 38North (朝核) | `https://www.38north.org/feed/` | ✅ 官方 | 📝 摘要 | 朝鲜核武器监测 |
| Irrawaddy (缅甸) | `https://www.irrawaddy.com/feed` | ✅ 官方 | 📝 摘要 | 缅甸独立媒体（泰国注册）|
| VOA 亚太 | `https://www.voanews.com/api/ztoq_oiqnm` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Radio Free Asia | `https://www.rfa.org/english/RSS` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，覆盖中国/朝鲜/缅甸 |

---

## 六、非洲

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| RFI 非洲英文 | `https://www.rfi.fr/en/africa/rss` | ✅ 官方 | 📝 摘要 | 法国国际广播，非洲覆盖最强 |
| Africa Report | `https://www.theafricareport.com/feed/` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| AllAfrica 苏丹 | `https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf` | ✅ 官方 | 📝 摘要 | 非洲新闻聚合，可按国家筛选 |
| Sudan Tribune | `https://sudantribune.com/feed/` | ✅ 官方 | 📰 全文 | **已验证**，苏丹冲突专门报道 |
| The EastAfrican | `https://www.theeastafrican.co.ke/tea/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，东非地区 |
| Africa Confidential | Google News 替代 | 🔍 Google | 📝 摘要 | 订阅制，无免费 RSS |
| VOA 非洲 | `https://www.voaafrica.com/api/zq-o_eomit` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |

---

## 七、美洲 / 拉美

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| InSightCrime | `https://insightcrime.org/news/feed/` | ✅ 官方 | 📰 全文 | **已验证**，拉美有组织犯罪专业媒体 |
| InSightCrime 分析 | `https://insightcrime.org/analysis/feed/` | ✅ 官方 | 📰 全文 | 深度分析文章 |
| LAPR (拉美报告) | `https://www.thelancet.com/action/showFeed?jc=lanam&type=etoc&feed=rss` | ⚠️ 验证 | 📝 摘要 | |
| Venezuela Investigative | Google News 替代 | 🔍 Google | 📝 摘要 | |
| Merco Press (南美) | `https://en.mercopress.com/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，南美/马岛专题 |

---

## 八、国际组织 / 冲突数据 / 人道危机

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| 联合国新闻 | `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | ✅ 官方 | 📝 摘要 | 覆盖安理会、维和、制裁 |
| UN DPPA | Google News 替代: `https://news.google.com/rss/search?q=site:un.org+peace+security` | 🔍 Google | 📝 摘要 | DPPA 无 RSS |
| ReliefWeb 全部更新 | `https://reliefweb.int/updates/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，人道危机实时更新 |
| ReliefWeb 冲突 | `https://reliefweb.int/taxonomy/term/4597/updates/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，按主题筛选 |
| International Crisis Group | `https://www.crisisgroup.org/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Crisis Group CrisisWatch | `https://www.crisisgroup.org/crisiswatch/feed` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，月度冲突预警 |
| ACLED | ❌ 无 RSS | — | — | 只有 API/数据下载，用 Google News 替代 |
| CFR Global Conflict | Google News: `https://news.google.com/rss/search?q=site:cfr.org+conflict` | 🔍 Google | 📝 摘要 | CFR RSS 有限，建议用 Google News |
| SIPRI | `https://www.sipri.org/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，斯德哥尔摩国际和平研究所 |
| ICRC (红十字会) | `https://www.icrc.org/en/feed` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Amnesty International | `https://www.amnesty.org/en/latest/feed/` | ✅ 官方 | 📝 摘要 | 人权视角 |

---

## 九、智库 / 深度分析

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| Foreign Affairs | `https://www.foreignaffairs.com/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，部分付费 |
| War on the Rocks | `https://warontherocks.com/feed/` | ✅ 官方 | 📰 全文 | 美国安全政策，质量极高 |
| Lawfare (安全法律) | `https://www.lawfaremedia.org/feed` | ✅ 官方 | 📰 全文 | ⚠️ 验证 |
| Chatham House | `https://www.chathamhouse.org/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| RAND Corporation | `https://www.rand.org/pubs/rss/latest.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Brookings | `https://www.brookings.edu/feed/` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Wilson Center | `https://www.wilsoncenter.org/rss.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| Carnegie Endowment | `https://carnegieendowment.org/rss/solr/all` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| IISS (国际战略研究所) | `https://www.iiss.org/rss` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |

---

## 十、中文信息源

| 源 | URL | 类型 | 内容 | 备注 |
|----|-----|------|------|------|
| 新华社国际 | `http://www.xinhuanet.com/world/news_world.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证，官方视角 |
| 新华社 via RSSHub | `https://rsshub.app/xinhua/world` | 🔧 RSSHub | 📝 摘要 | 社区维护 |
| 环球时报英文 | `https://www.globaltimes.cn/rss/outbrain.xml` | ✅ 官方 | 📝 摘要 | ⚠️ 验证 |
| 观察者网 via RSSHub | `https://rsshub.app/guancha/headline` | 🔧 RSSHub | 📝 摘要 | 需要 RSSHub 实例 |
| BBC 中文 | `http://feeds.bbci.co.uk/zhongwen/simp/world/rss.xml` | ✅ 官方 | 📝 摘要 | 已验证，BBC 官方中文版 |
| 美联社中文 via RSSHub | `https://rsshub.app/apnews/topics/chinese` | 🔧 RSSHub | 📝 摘要 | ⚠️ 验证 |

---

## 十一、Google News RSS：强力补充

Google News RSS 可以按关键词/站点/话题实时生成 feed，无需任何账号，覆盖面极广。

### 基础格式

```
https://news.google.com/rss/search?q=<关键词>&hl=<语言>&gl=<国家>&ceid=<国家:语言>
```

### 实用示例

```yaml
# 替代 Reuters（限制在 reuters.com 域名）
- https://news.google.com/rss/search?q=when:1d+site:reuters.com+world&hl=en-US&gl=US&ceid=US:en

# 替代 AP
- https://news.google.com/rss/search?q=when:1d+site:apnews.com&hl=en-US&gl=US&ceid=US:en

# 俄乌冲突聚合
- https://news.google.com/rss/search?q=Ukraine+Russia+war+when:2d&hl=en-US&gl=US&ceid=US:en

# 中东冲突聚合
- https://news.google.com/rss/search?q=Gaza+Israel+Hamas+ceasefire+when:2d&hl=en-US&gl=US&ceid=US:en

# 台海/南海
- https://news.google.com/rss/search?q=Taiwan+Strait+South+China+Sea+when:2d&hl=en-US&gl=US&ceid=US:en

# 非洲冲突
- https://news.google.com/rss/search?q=Sudan+Sahel+conflict+when:2d&hl=en-US&gl=US&ceid=US:en

# 中文聚合
- https://news.google.com/rss/search?q=地缘冲突+战争&hl=zh-CN&gl=CN&ceid=CN:zh-Hans
```

**Google News RSS 的优点**：
- 无需注册，免费
- 聚合多个来源，覆盖面广
- 支持时间过滤（`when:1d` = 最近1天，`when:2d` = 最近2天）
- 支持限定来源（`site:reuters.com`）
- 支持中英文

**缺点**：
- Google 可能随时改变 feed 格式或 URL 结构
- 无法获取完整正文（只有标题+摘要+来源）
- 同一事件可能有很多重复条目

---

## 十二、RSSHub 使用说明

[RSSHub](https://github.com/DIYgod/RSSHub) 是开源的 RSS 生成服务，可以把任意网页转成 RSS。

### 公共实例

以下公共实例可直接使用（稳定性不保证，建议自建）：

```
https://rsshub.app          # 官方实例（有速率限制）
https://rsshub.rssforever.com  # 社区镜像
https://hub.slarker.me         # 社区镜像
```

### 建议的 RSSHub 路由

```
# Reuters
/reuters/world
/reuters/politics

# AP
/apnews/topics/world-news
/apnews/topics/international-news

# Kyiv Independent
/kyivindependent/latest

# SCMP
/scmp/section/china
/scmp/section/asia

# 新华社
/xinhua/world

# 观察者网
/guancha/headline
```

### 自建 RSSHub（推荐）

```bash
# Docker 一行部署
docker run -d --name rsshub -p 1200:1200 diygod/rsshub
# 然后用 http://localhost:1200 替换 https://rsshub.app
```

---

## 十三、优先推荐列表（开箱即用）

以下是基于实际运行验证或高度可信的来源，建议优先配置：

| 优先级 | 源名称 | RSS 地址 | 特点 |
|--------|--------|----------|------|
| ⭐⭐⭐ | Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 已验证，中东最强 |
| ⭐⭐⭐ | BBC 世界 | `http://feeds.bbci.co.uk/news/world/rss.xml` | 极稳定，全球覆盖 |
| ⭐⭐⭐ | The Guardian | `https://www.theguardian.com/world/rss` | 含全文，质量高 |
| ⭐⭐⭐ | DW 英文 | `https://rss.dw.com/rdf/rss-en-all` | 稳定，欧洲视角 |
| ⭐⭐⭐ | Kyiv Independent | `https://kyivindependent.com/feed/` | 已验证，俄乌专业 |
| ⭐⭐⭐ | Times of Israel | `https://www.timesofisrael.com/feed/` | 已验证，中东 |
| ⭐⭐⭐ | InSightCrime | `https://insightcrime.org/news/feed/` | 已验证，拉美 |
| ⭐⭐⭐ | War on the Rocks | `https://warontherocks.com/feed/` | 全文，安全分析极佳 |
| ⭐⭐⭐ | The Diplomat | `https://thediplomat.com/feed/` | 亚太专业 |
| ⭐⭐⭐ | Meduza 英文 | `https://meduza.io/en/rss/all` | 全文，俄罗斯独立视角 |
| ⭐⭐⭐ | Sudan Tribune | `https://sudantribune.com/feed/` | 已验证，非洲 |
| ⭐⭐⭐ | 联合国新闻 | `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | 官方，覆盖安理会 |
| ⭐⭐ | RFI 英文 | `https://www.rfi.fr/en/rss` | 非洲/法语区强 |
| ⭐⭐ | NPR 世界 | `https://feeds.npr.org/1004/rss.xml` | 美国公共广播 |
| ⭐⭐ | Irrawaddy | `https://www.irrawaddy.com/feed` | 缅甸独立媒体 |
| ⭐⭐ | Foreign Policy | `https://foreignpolicy.com/feed/` | 地缘政治深度 |
| ⭐⭐ | Middle East Eye | `https://www.middleeasteye.net/rss` | 中东独立视角 |
| ⭐⭐ | The Diplomat | `https://thediplomat.com/feed/` | 印太专业 |
| ⭐ | Google News 俄乌 | 见第十一节 | 聚合，有重复 |
| ⭐ | Google News 中东 | 见第十一节 | 聚合，有重复 |
