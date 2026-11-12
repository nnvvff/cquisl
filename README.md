# CQUISL 国际战略性诉讼数据库

公开网站：https://nnvvff.github.io/cquisl/

本项目迁移自原公开研究网站。`source/` 保存版本 97 的公开前端构建文件，不是豆包导出的工程源码。
原样保留站点样式、地图、案例数据、筛选逻辑、研究成果、项目介绍及原案例详情组件。
只适配托管路径和资源链接。案例使用原网站的弹窗卡片，打开和关闭案例时保留案例库的浏览位置。
`scripts/build.py` 列出了全部运行时代码改动，并验证反向恢复后与原 JS 文件完全一致。

## 更新案例

1. 更新原站公开构建文件，或提供豆包导出的完整工程后再更新工程。
2. 运行 `python3 scripts/build.py`。
3. 提交修改后的文件到 `main`。

GitHub Pages 从 `main` 分支的 `docs/` 目录发布。
构建只使用 Python 标准库，无需安装前端依赖。

## 原始应用与附件

构建脚本不会重新编码或替换原 JS 内嵌的案例数据，也不会改变原有筛选逻辑。
不再生成或发布单独的案例 HTML，站点地图仅包含首页、案例库、研究成果和项目介绍。
`case-snapshots/` 保留早期导出的历史快照，目前构建不再使用。
案例内容及项目署名沿用原站点，迁移不构成对案例法律分析的重新核验。

`python3 scripts/download_pdfs.py` 可下载原站点的 PDF 附件；下载报告位于 `data/pdf-download-report.json`。
正式发布的 PDF 文件保存在 `docs/pdfs/`。

站点地图：https://nnvvff.github.io/cquisl/sitemap.xml
