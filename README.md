# 国际战略性诉讼数据库International Strategic Litigation Database

网站：https://nnvvff.github.io/cquisl/

重庆大学法学院大创项目《国际战略性诉讼的扩散理据与中国因应研究》成果展示平台。
收录306件案件，覆盖85个国家和地区、6大法律领域，支持检索、筛选、地图及案例原文查看。

## 数据与母版

当前同步[公开母版](https://4kqzd0m8f7y5w.aiforce.cloud/app/app_17b6n690wyg/database)第102版（2026-11-15）。
相较原第97版，更新23条记录，306个案件ID无新增或删除，保留南非9案。
`data/cases.json` 是完整案例快照；`data/master-version.json` 固定原始脚本及数据校验值。
`source/original.html` 和该版本公开构建文件保留原始内容，并非平台导出的完整工程源码。

有效国家/地区为85项。5条无明确归属记录中的 `/` 保留在数据内，但不计入国家数量及地图。
多国案件会分别归入各国；各国关联数之和353不等于去重案件总数306。
同步沿用母版对案例的分类和分析，不构成对法律内容的重新核验。

## 构建与检查

```sh
python3 scripts/build.py
npm ci --ignore-scripts
npm test
```

GitHub Pages从`main`的`docs/`发布。构建仅需Python标准库；Acorn为开发测试依赖。
构建保留原页面、地图、筛选及案例弹窗，只施加可逆且断言匹配数量的补丁：
托管路径、地图排除未知标记、图表组件状态更新、团队图片本地链接、版本日期与原平台遥测初始化。
反向恢复补丁后，运行脚本必须与母版原文件完全一致。
测试进一步解析发布脚本中的306条实际运行数据，逐字段与快照对照。

页面先提供可检索的静态正文与导航，再加载React。应用样式内联，使用系统字体回退，
移除了启动过程对原平台外部字体和遥测脚本的依赖。启动失败、断网或超过8秒时显示状态及手动重试，
不会自动反复刷新。原图表的类构造器被误作React状态更新函数的问题已修复。
这些改动改善页面加载过程；GitHub Pages在部分网络的连接超时仍由托管线路决定。

## 文书附件

原有PDF保存在`docs/pdfs/`，本次不替换附件内容。266条本地文书引用沿用`/cquisl/pdfs/`链接。
`python3 scripts/download_pdfs.py`可下载母版附件；原下载报告为`data/pdf-download-report.json`。
案例仍通过原弹窗打开，关闭时保留案例库的筛选及滚动位置，不发布独立案例HTML。

## 真实访问统计

页面保留个人主页的`/analytics.js`，与个人主页共用Cloudflare Web Analytics项目。
后台按路径前缀`/cquisl`筛选数据库浏览量；个人主页按路径`/`单独查看。

新增[统计报表](https://nnvvff.github.io/cquisl/analytics/)使用独立的Worker和D1数据库，统计：
页面浏览、访问次数、案例打开、搜索和文书链接点击，以及7/30/90天趋势。
该数据从新服务接入后开始累计，与旧Cloudflare统计来源分别显示，不回填或拼接历史人数。
访问次数不等于独立人数；文书点击不代表成功下载。网络拦截、关闭页面等会造成漏报。

[排除自己的访问](https://nnvvff.github.io/analytics-settings/)使用原有当前浏览器开关，
Cloudflare和新事件统计共用`haomin.analytics.exclude`设置。每个浏览器/设备需分别开启。
报表页本身不注入统计脚本，验证记录单独标记为测试，不进入正式计数。
后端不向公开报表返回个人信息、访问令牌、搜索词或原始访问记录。

后端源代码、免费额度、限额、去重及协议见[analytics-worker/README.md](analytics-worker/README.md)。
生产基础地址在`data/analytics-config.json`中配置；该地址不含访问凭证。

## 搜索展示

四个主页面包含双语标题、独立canonical、描述、WebSite/WebPage结构化数据和无需执行JS即可读取的正文。
站点地图：https://nnvvff.github.io/cquisl/sitemap.xml

统计报表标记为不索引。根域名的robots.txt由个人主页仓库维护，列出两站的站点地图。
网站代码和提交抓取请求无法保证立即收录或特定搜索排名。

Bing站长后台已验证本网站，验证文件`docs/BingSiteAuth.xml`需保留。
2026-11-15已向Bing提交上述站点地图及四个主页面；后台确认首页已收录，
当时显示的最后抓取日期为2026-11-12，最新标题仍需等待搜索结果更新。
后续内容更新可在[Bing站长后台](https://www.bing.com/webmasters?siteUrl=https%3A%2F%2Fnnvvff.github.io%2Fcquisl%2F)提交网址。
