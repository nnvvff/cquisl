# CQUISL 国际战略性诉讼数据库

公开网站：https://nnvvff.github.io/cquisl/

本项目迁移自原公开研究网站，保留原有地图、案例筛选、研究成果与项目介绍。
`data/cases.json` 是案例数据；每条案例发布为 `docs/cases/c-XXXX.html`，可直接访问、分享和抓取。

## 更新案例

1. 修改 `data/cases.json`。
2. 运行 `python3 scripts/build.py`。
3. 提交 `data/`、`docs/` 及修改过的源码到 `main`。

GitHub Pages 从 `main` 分支的 `docs/` 目录发布。
构建只使用 Python 标准库，无需安装前端依赖。

## 原始应用与附件

`source/` 保存原公开站点版本 97 的前端构建文件。构建脚本更新案例数据，调整部署路径，并把案例选择操作改为打开独立 HTML。
案例内容及项目署名沿用原站点，迁移不构成对案例法律分析的重新核验。

`python3 scripts/download_pdfs.py` 可下载原站点的 PDF 附件；下载报告位于 `data/pdf-download-report.json`。
正式发布的 PDF 文件保存在 `docs/pdfs/`。

站点地图：https://nnvvff.github.io/cquisl/sitemap.xml
