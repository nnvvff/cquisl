"""Publish master 102 with documented, reversible hosting and usability fixes."""
import hashlib
import json
from pathlib import Path
import re
import shutil
from html import escape
from loading_shell import render_loading_shell, route_metadata

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
BASE = "/cquisl"
ORIGIN = "https://nnvvff.github.io"
SITE_NAME = "国际战略性诉讼数据库International Strategic Litigation Database"
MASTER = json.loads((ROOT / "data/master-version.json").read_text())
CASES = json.loads((ROOT / "data/cases.json").read_text())
APP = MASTER["app"]
ASSET_PREFIX = MASTER["asset_prefix"]
PAGES = ["index.html", "database/index.html", "research/index.html", "about/index.html"]
PATCHES = [
    ("window.__BASENAME__||`/app/app_17b6n690wyg`", "window.__BASENAME__||`/cquisl`", "hosting base path"),
    ("e||n(t.default)", "e||n(()=>t.default)", "store chart component without invoking its class"),
    ("t.countries.forEach(t=>{e[t]=(e[t]||0)+1})", "t.countries.filter(t=>t&&t!==`/`).forEach(t=>{e[t]=(e[t]||0)+1})", "exclude unknown country from map"),
    ("数据版本：v1.0 | 更新日期：2026年12月", "数据版本：v102 | 更新日期：2026年11月15日", "actual master publication date"),
]


def asset_urls(text):
    return sorted(set(re.findall(re.escape(ASSET_PREFIX) + r"[^`\"'<>\\ ]+", text)))


def patch_bundle(original):
    patches = PATCHES[:]
    for url in asset_urls(original):
        patches.append((url, BASE + "/assets/" + url.rsplit("/", 1)[-1], "serve team image locally"))
    bundle = original
    for old, new, reason in patches:
        assert bundle.count(old) == 1, reason
        bundle = bundle.replace(old, new)
    restored = bundle
    for old, new, reason in reversed(patches):
        assert restored.count(new) == 1, reason
        restored = restored.replace(new, old)
    assert restored == original, "Undocumented runtime change"
    return bundle, patches


def url_for(page):
    return ORIGIN + BASE + "/" + page.removesuffix("index.html")


def page_head(page, css):
    metadata = route_metadata(page)
    title = SITE_NAME if page == "index.html" else metadata["heading"] + " | " + SITE_NAME
    description = metadata["intro"]
    if "306" not in description:
        description += "收录306件案件，覆盖85个国家和地区、6大法律领域。"
    canonical = url_for(page)
    structured = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebSite", "@id": ORIGIN + BASE + "/#website", "name": SITE_NAME,
         "alternateName": "CQUISL", "url": ORIGIN + BASE + "/", "inLanguage": ["zh-CN", "en"]},
        {"@type": "WebPage", "name": title, "url": canonical,
         "isPartOf": {"@id": ORIGIN + BASE + "/#website"}, "description": description}]}
    preload = ''.join(f'<link rel="modulepreload" href="{BASE}/assets/{name}">'
                      for name in ["rolldown-runtime-CNC7AqOf.js", "radix-D56X_1SX.js", "toolkit-CIfASfd3.js"])
    return f'''<!doctype html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}</title><meta name="description" content="{escape(description, quote=True)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{canonical}"><link rel="icon" href="{BASE}/assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:title" content="{escape(title, quote=True)}"><meta property="og:url" content="{canonical}">
<meta property="og:description" content="{escape(description, quote=True)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="{escape(title, quote=True)}">
<script type="application/ld+json">{json.dumps(structured, ensure_ascii=False).replace('<', '&lt;')}</script>
<style>{css}</style>{preload}
<script>window.__BASENAME__="{BASE}";window.appId="app_17b6n690wyg";window.userId="";window.tenantId="3858452290";window.userName="";window.csrfToken="";window.ENVIRONMENT="online";</script>
<script>if(typeof crypto==="undefined"||typeof crypto.randomUUID!=="function"||typeof Object.hasOwn!=="function"||typeof[].at!=="function"||typeof[].findLast!=="function")document.write('<script src="{BASE}/assets/polyfills.js"><\\/script>');</script>
</head><body>'''


def main():
    country_values = {c for row in CASES for c in row.get("countries", []) if c and c != "/"}
    assert len(CASES) == len({row["id"] for row in CASES}) == 306
    assert len(country_values) == 85
    assert sum("南非" in row["countries"] for row in CASES) == 9
    case_hash = hashlib.sha256(json.dumps(CASES, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert case_hash == MASTER["cases_sha256"], "Case snapshot differs from reviewed master"
    assets = OUT / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    source = ROOT / "source"
    original = (source / APP).read_text()
    assert hashlib.md5(original.encode()).hexdigest() == MASTER["original_md5"]
    bundle, patches = patch_bundle(original)
    version = hashlib.sha256(bundle.encode()).hexdigest()[:12]
    referenced = {APP, "polyfills.js", "radix-D56X_1SX.js", "rolldown-runtime-CNC7AqOf.js", "toolkit-CIfASfd3.js"}
    referenced.update(url.rsplit("/", 1)[-1] for url in asset_urls(original))
    for name in referenced:
        assert (source / name).is_file(), "Missing master asset: " + name
        shutil.copy2(source / name, assets / name)
    toolkit_path = assets / "toolkit-CIfASfd3.js"
    toolkit = toolkit_path.read_text()
    telemetry = "window.__FULLSTACK_RUNTIME_INITIALIZED__||(window.__FULLSTACK_RUNTIME_INITIALIZED__=!0,ap(),sp());"
    static_runtime = "window.__FULLSTACK_RUNTIME_INITIALIZED__||(window.__FULLSTACK_RUNTIME_INITIALIZED__=!0,ap());"
    assert toolkit.count(telemetry) == 1
    toolkit = toolkit.replace(telemetry, static_runtime)
    assert toolkit.count(static_runtime) == 1
    assert toolkit.replace(static_runtime, telemetry) == (source / toolkit_path.name).read_text()
    toolkit_path.write_text(toolkit)
    (assets / APP).write_text(bundle)
    (assets / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0e3f62"/><path d="M24 8v29M12 37h24M9 17l15-7 15 7M9 17L3 29h12L9 17zm30 0-6 12h12l-6-12z" fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>')
    css = (source / "index-BiMmBCnl.css").read_text()
    # A remote @import blocks first paint even when the rest of the CSS is inline.
    # Retain the existing font stacks, which already include local system fallbacks.
    css = re.sub(r'@import\s+"https:[^"]+";', '', css)
    boot = (ROOT / "enhancements/site-boot.js").read_text()
    config = ROOT / "data/analytics-config.json"
    endpoint = json.loads(config.read_text()).get("endpoint", "") if config.exists() else ""
    custom = ROOT / "enhancements/analytics.js"
    if custom.exists():
        shutil.copy2(custom, assets / "analytics-events.js")
    for page in PAGES + ["404.html"]:
        head = page_head(page, css)
        if page == "404.html":
            head = head.replace('content="index,follow,max-image-preview:large"', 'content="noindex,follow"')
        html = head + render_loading_shell(page) + '<div id="root"></div>'
        html += '<script>' + boot + '</script>'
        html += f'<script type="module" data-cquisl-app src="{BASE}/assets/{APP}?v={version}"></script>'
        html += '<script defer src="/analytics.js"></script>'
        if custom.exists() and endpoint:
            html += f'<script defer src="{BASE}/assets/analytics-events.js" data-endpoint="{escape(endpoint, quote=True)}"></script>'
        html += '</body></html>'
        path = OUT / page
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html)
    report = ROOT / "enhancements/analytics-report.html"
    if report.exists():
        target = OUT / "analytics/index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(report.read_text().replace("__ANALYTICS_ENDPOINT__", endpoint))
    urls = [url_for(page) for page in PAGES]
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'<url><loc>{url}</loc><lastmod>{MASTER["published_at"]}</lastmod></url>\n' for url in urls) + '</urlset>\n')
    (OUT / "robots.txt").write_text(f'User-agent: *\nAllow: /\nDisallow: {BASE}/analytics/\nSitemap: {ORIGIN}{BASE}/sitemap.xml\n')
    (OUT / ".nojekyll").write_text("")
    (OUT / "build-info.json").write_text(json.dumps({"master_version": 102, "cases": 306, "countries": 85,
        "fields": 6, "app_version": version, "patches": [p[2] for p in patches] + ["disable original platform telemetry initialization"],
        "original_code_restored_by_reversing_patches": True}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({"master_version": 102, "cases": 306, "countries": 85,
                      "app_version": version, "runtime_patches": len(patches) + 1, "analytics_configured": bool(endpoint)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
