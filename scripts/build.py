"""Build CQUISL's portable app and one fully rendered HTML file per case."""
from datetime import datetime
from html import escape
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import quote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
BASE = "/cquisl"
ORIGIN = "https://nnvvff.github.io"
CASES = json.loads((ROOT / "data/cases.json").read_text())
TITLE = "CQUISL · 国际战略性诉讼数据库"
TODAY = datetime.now(ZoneInfo("Asia/Hong_Kong")).date()
DESCRIPTION = f"收录全球{len(CASES)}件国际战略性诉讼案例，提供案名、国家、法律领域、法院与年份检索，以及研究成果和原始法律文书。"
STYLE = "index-D_rqEQot.css"
APP = "index-B_9R2EZn.js"
APP_VERSION = ""
FORUM = {"domestic": "国内法院", "regional": "区域法院", "international": "国际法院", "International": "国际法院"}


def esc(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return escape(str(value if value is not None else ""), quote=True)


def case_url(case):
    return f"{BASE}/cases/{case['id']}.html"


def page_url(path):
    return ORIGIN + BASE + "/" + path


def header():
    return f'''<header class="site-header"><div class="site-header-inner">
    <a class="brand" href="{BASE}/"><span class="brand-mark" aria-hidden="true">⚖</span><span><strong>国际战略性诉讼数据库</strong><small>International Strategic Litigation Database</small></span></a>
    <nav aria-label="主导航"><a href="{BASE}/">首页</a><a href="{BASE}/database/">案例数据库</a><a href="{BASE}/research/">研究成果</a><a href="{BASE}/about/">关于项目</a></nav>
    </div></header>'''


def footer():
    return f'''<footer class="site-footer"><div class="footer-inner"><div><strong>国际战略性诉讼数据库</strong><p>重庆大学法学院大创项目《国际战略性诉讼的扩散理据与中国因应研究》成果展示平台</p></div><a href="mailto:cquisl@163.com">cquisl@163.com</a></div><div class="copyright">© {TODAY.year} 重庆大学法学院 · 国际战略性诉讼研究团队</div></footer>'''


def document(title, description, path, content, *, app=False, structured=None, noindex=False):
    canonical = page_url(path)
    structured = structured or {"@context": "https://schema.org", "@type": "WebPage", "name": title,
                                 "description": description, "url": canonical, "inLanguage": "zh-CN"}
    ld = json.dumps(structured, ensure_ascii=False).replace("<", "\\u003c")
    scripts = f'<script>window.__BASENAME__={json.dumps(BASE)};</script><script type="module" src="{BASE}/assets/{APP}?v={APP_VERSION}"></script>' if app else ""
    body = f'<div id="root">{content}</div>' if app else content
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{esc(title)}</title><meta name="description" content="{esc(description)}"><meta name="robots" content="{'noindex,follow' if noindex else 'index,follow'}">
    <link rel="canonical" href="{esc(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(description)}"><meta property="og:url" content="{esc(canonical)}">
    <meta property="og:site_name" content="CQUISL"><link rel="icon" href="{BASE}/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="{BASE}/assets/{STYLE}"><link rel="stylesheet" href="{BASE}/assets/cquisl.css">
    <script type="application/ld+json">{ld}</script>{scripts}</head><body>{body}</body></html>'''


def paragraph(value):
    return "".join(f"<p>{esc(part).replace(chr(10), '<br>')}</p>" for part in str(value).split("\n\n") if part.strip())


def resource_url(resource):
    url = resource.get("url", "")
    if url.startswith("/pdfs/"):
        return BASE + url
    if url.startswith(("https://", "http://")):
        return url
    return ""


def case_content(case, index):
    cn, en = case["name_cn"], case.get("name_en", "")
    meta = [
        ("立案年份", case.get("year")),
        ("国家/地区", "、".join(case.get("countries", [])) or case.get("region", "—")),
        ("法院类型", FORUM.get(case.get("forum_type"), case.get("forum_type", "—"))),
        ("诉讼状态", case.get("status", "—")),
        ("细分领域", case.get("field", "—")),
        ("受理法院", case.get("court", "—")),
        ("案卷编号", case.get("case_number", "—")),
        ("诉状提交时间", case.get("filing_date", "—")),
        ("结案时间", case.get("closing_date", "—")),
    ]
    facts = "".join(f"<div><dt>{esc(label)}</dt><dd>{esc(value) or '—'}</dd></div>" for label, value in meta)
    sections = []
    for field, label in [("plaintiff", "原告"), ("defendant", "被告"), ("summary", "案情介绍"),
                         ("judgment", "判决结果"), ("initiation_path", "发起路径"),
                         ("response_path", "回应路径"), ("implication", "因果启示")]:
        value = case.get(field)
        if value and str(value).strip() not in {"—", "-"}:
            sections.append(f'<section class="case-section" id="{field}"><h2>{label}</h2>{paragraph(value)}</section>')
    resources = "".join(f'<li><a href="{esc(resource_url(r))}" target="_blank" rel="noopener noreferrer">{esc(r.get("label", "相关文献"))}<span aria-hidden="true"> ↗</span></a>{f"<p>{esc(r['source_title'])}</p>" if r.get("source_title") else ""}</li>'
                        for r in case.get("resources", []) if resource_url(r))
    if resources:
        sections.append(f'<section class="case-section" id="resources"><h2>相关文献与原始法律文书</h2><ul class="resources">{resources}</ul></section>')
    if case.get("notice"):
        sections.append(f'<section class="case-section"><p>{esc(case["notice"])}</p></section>')
    filters = f'<a class="button" href="{BASE}/database/?field={quote(case.get("domain6", ""))}">查看同领域案件</a>'
    countries = case.get("countries", [])
    if countries:
        filters += f'<a class="button secondary" href="{BASE}/database/?region={quote(countries[0])}">查看{esc(countries[0])}案件</a>'
    previous = f'<a href="{case_url(CASES[index-1])}">← {esc(CASES[index-1]["name_cn"])}</a>' if index else '<span></span>'
    following = f'<a href="{case_url(CASES[index+1])}">{esc(CASES[index+1]["name_cn"])} →</a>' if index + 1 < len(CASES) else ""
    return f'''{header()}<main class="case-main"><nav class="breadcrumb" aria-label="面包屑"><a href="{BASE}/">首页</a><span>/</span><a href="{BASE}/database/">案例数据库</a></nav>
    <article><header class="case-heading"><div class="badges"><span>{esc(case.get('domain6', ''))}</span><span class="status">{esc(case.get('status', ''))}</span></div><h1>{esc(cn)}</h1><p class="english-title">{esc(en)}</p></header>
    <section class="case-section"><h2>基本信息</h2><dl class="case-facts">{facts}</dl></section>{''.join(sections)}<div class="case-actions">{filters}</div></article>
    <nav class="case-pagination" aria-label="案例翻页">{previous}{following}</nav></main>{footer()}'''


def case_index():
    rows = "".join(f'<tr><td><a href="{case_url(c)}">{esc(c["name_cn"])}</a><small>{esc(c.get("name_en", ""))}</small></td><td>{esc(c.get("domain6", ""))}</td><td>{esc(c.get("region", ""))}</td><td>{esc(c.get("year", ""))}</td></tr>' for c in CASES)
    return f'<div class="table-scroll"><table class="case-index"><thead><tr><th>案名</th><th>领域</th><th>国家/地区</th><th>年份</th></tr></thead><tbody>{rows}</tbody></table></div>'


def write(path, content):
    target = OUT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def build_app():
    global APP_VERSION
    source = ROOT / "source"
    for file in source.iterdir():
        if file.suffix in {".js", ".css"}:
            shutil.copy2(file, OUT / "assets" / file.name)
    bundle = (source / APP).read_text()
    start = bundle.index("ad=[{id:`c-0001`") + 3
    end = bundle.index("],Jre=306", start) + 1
    bundle = bundle[:start] + json.dumps(CASES, ensure_ascii=False, separators=(",", ":")) + bundle[end:]
    patches = {
        "if(n)try{r=JSON.parse(n)}catch{}let i=t.get(`q`),a=t.get(`region`),o=t.get(`field`);": "if(n)try{r=JSON.parse(n)}catch{}if(t.has(`q`)||t.has(`region`)||t.has(`field`))r=JSON.parse(JSON.stringify(d9));let i=t.get(`q`),a=t.get(`region`),o=t.get(`field`);",
        "window.__BASENAME__||`/app/app_17b6n690wyg`": "window.__BASENAME__||`/cquisl`",
        "p=(0,P.useCallback)(e=>{let t=ad.indexOf(e);u(e),f(t>=0?t:-1)},[])": "p=(0,P.useCallback)(e=>{window.location.assign(`/cquisl/cases/${encodeURIComponent(e.id)}.html`)},[])",
        "(0,F.jsx)(`div`,{className:`font-medium text-foreground line-clamp-1`,children:e.name_cn})": "(0,F.jsx)(`a`,{href:`/cquisl/cases/${encodeURIComponent(e.id)}.html`,onClick:e=>e.stopPropagation(),className:`font-medium text-foreground line-clamp-1`,children:e.name_cn})",
        "(0,F.jsx)(`h3`,{className:`font-semibold text-foreground text-sm leading-snug line-clamp-2 mb-1`,children:e.name_cn})": "(0,F.jsx)(`h3`,{className:`font-semibold text-foreground text-sm leading-snug line-clamp-2 mb-1`,children:(0,F.jsx)(`a`,{href:`/cquisl/cases/${encodeURIComponent(e.id)}.html`,onClick:e=>e.stopPropagation(),children:e.name_cn})})",
    }
    for old, new in patches.items():
        if bundle.count(old) != 1:
            raise ValueError(f"Expected one migration patch match, found {bundle.count(old)}: {old[:100]}")
        bundle = bundle.replace(old, new)
    APP_VERSION = hashlib.sha256(bundle.encode()).hexdigest()[:12]
    (OUT / "assets" / APP).write_text(bundle)
    shutil.copy2(ROOT / "source/cquisl.css", OUT / "assets/cquisl.css")
    write("assets/favicon.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0a3d6c"/><path d="M32 13v36m-15 0h30M15 23h34M20 23l-9 16h18zm24 0-9 16h18z" fill="none" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg>')


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "assets").mkdir(exist_ok=True)
    build_app()
    intro = f'<section class="fallback-hero"><h1>国际战略性诉讼数据库与研究平台</h1><p>International Strategic Litigation Database &amp; Research Platform</p><p>{esc(DESCRIPTION)}</p><a class="button" href="{BASE}/database/">探索数据库</a></section>'
    home = header() + '<main class="fallback-main">' + intro + f'<section class="case-section"><h2>研究成果</h2><p>以“制度—主体—动机—话语”四维分析框架，研究国际战略性诉讼的扩散理据与中国因应策略。</p><a href="{BASE}/research/">查看研究成果</a></section></main>' + footer()
    write("index.html", document(TITLE, DESCRIPTION, "", home, app=True, structured={"@context": "https://schema.org", "@type": "WebSite", "name": "CQUISL 国际战略性诉讼数据库", "alternateName": "CQUISL", "url": page_url(""), "inLanguage": "zh-CN", "description": DESCRIPTION}))
    database = header() + f'<main class="fallback-main"><h1>全球案例数据库</h1><p>共{len(CASES)}件国际战略性诉讼案例</p>' + case_index() + "</main>" + footer()
    write("database/index.html", document("案例数据库 | " + TITLE, DESCRIPTION, "database/", database, app=True))
    research = header() + f'<main class="fallback-main"><h1>国际战略性诉讼的扩散理据与中国因应研究</h1><p>围绕国际战略性诉讼的制度、主体、动机、话语四个维度，研究全球扩散机制、典型案例及中国因应策略。</p><a href="{BASE}/database/">浏览全部案例</a></main>' + footer()
    write("research/index.html", document("研究成果 | " + TITLE, "国际战略性诉讼的扩散理据与中国因应研究：核心概念、四大扩散理据、典型案例和中国因应策略。", "research/", research, app=True))
    about = header() + '<main class="fallback-main"><h1>关于项目</h1><p>《国际战略性诉讼的扩散理据与中国因应研究》——重庆大学法学院大学生创新创业训练计划项目。</p><p>项目负责人：王韵霁。团队成员：龚羽佳、王琼、卢依泉。</p><a href="mailto:cquisl@163.com">cquisl@163.com</a></main>' + footer()
    write("about/index.html", document("关于项目 | " + TITLE, "重庆大学法学院国际战略性诉讼研究团队及项目介绍。", "about/", about, app=True))
    urls = [page_url(p) for p in ["", "database/", "research/", "about/"]]
    for i, case in enumerate(CASES):
        path = f"cases/{case['id']}.html"
        summary = " ".join(str(case.get("summary", "")).split())[:155] or f"{case['name_cn']}（{case.get('name_en', '')}）的案件信息、诉讼进展和研究分析。"
        write(path, document(case["name_cn"] + " | " + TITLE, summary, path, case_content(case, i)))
        urls.append(page_url(path))
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f'<url><loc>{esc(url)}</loc><lastmod>{TODAY.isoformat()}</lastmod></url>\n' for url in urls) + '</urlset>\n'
    write("sitemap.xml", sitemap)
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {page_url('sitemap.xml')}\n")
    write("404.html", document("页面不存在 | " + TITLE, "返回 CQUISL 国际战略性诉讼数据库。", "404.html", header() + f'<main class="fallback-main"><h1>页面不存在</h1><a href="{BASE}/">返回首页</a></main>' + footer(), noindex=True))
    write(".nojekyll", "")
    print(json.dumps({"case_pages": len(CASES), "sitemap_urls": len(urls), "output": str(OUT), "base_url": page_url("")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
