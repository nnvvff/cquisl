"""Preserve the original frontend; change only hosting paths and case routing."""
import hashlib
import json
from pathlib import Path
import shutil
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
BASE = "/cquisl"
ORIGIN = "https://nnvvff.github.io"
APP = "index-B_9R2EZn.js"
ASSET_PREFIX = "https://lf-miaoda-static.feishucdn.com/app_17b6n690wyg/97/client/assets/"
CASES = json.loads((ROOT / "data/cases.json").read_text())
SNAPSHOTS = ROOT / "case-snapshots"

# Reuse the original detail component, including all of its rendering and styling.
CASE_ROUTE = '''function CquislCaseHtml(){let n=ve(),p=_e().pathname.split(`/`).pop(),c=ad.find(e=>e.id+`.html`===p);return c?(0,F.jsx)(Kxe,{open:!0,caseData:c,caseIndex:ad.indexOf(c),onClose:()=>n(`/database`),onViewSameField:e=>Ee.setItem(c9,JSON.stringify({...d9,fields:[e]})),onViewSameRegion:e=>Ee.setItem(c9,JSON.stringify({...d9,regions:[e]}))}):(0,F.jsx)(VSe,{})}'''

PATCHES = [
    ("window.__BASENAME__||`/app/app_17b6n690wyg`", "window.__BASENAME__||`/cquisl`", "hosting base path"),
    ("p=(0,P.useCallback)(e=>{let t=ad.indexOf(e);u(e),f(t>=0?t:-1)},[])",
     "p=(0,P.useCallback)(e=>{window.location.assign(`/cquisl/cases/${encodeURIComponent(e.id)}.html`)},[])", "case navigation"),
    ("(0,F.jsx)(`div`,{className:`font-medium text-foreground line-clamp-1`,children:e.name_cn})",
     "(0,F.jsx)(`a`,{href:`/cquisl/cases/${encodeURIComponent(e.id)}.html`,onClick:e=>e.stopPropagation(),className:`font-medium text-foreground line-clamp-1`,children:e.name_cn})", "list case link"),
    ("(0,F.jsx)(`h3`,{className:`font-semibold text-foreground text-sm leading-snug line-clamp-2 mb-1`,children:e.name_cn})",
     "(0,F.jsx)(`h3`,{className:`font-semibold text-foreground text-sm leading-snug line-clamp-2 mb-1`,children:(0,F.jsx)(`a`,{href:`/cquisl/cases/${encodeURIComponent(e.id)}.html`,onClick:e=>e.stopPropagation(),children:e.name_cn})})", "grid case link"),
    ("(0,F.jsx)(xe,{path:`database`,element:(0,F.jsx)(rSe,{})})",
     "(0,F.jsx)(xe,{path:`database`,element:(0,F.jsx)(rSe,{})}),(0,F.jsx)(xe,{path:`cases/:caseFile`,element:(0,F.jsx)(CquislCaseHtml,{})})", "case HTML route"),
    ("function HSe(){", CASE_ROUTE + "function HSe(){", "original detail component adapter"),
]


def main():
    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    for path in (ROOT / "source").iterdir():
        if path.suffix in {".js", ".css"} and path.name != "cquisl.css":
            shutil.copy2(path, OUT / "assets" / path.name)
    original = (ROOT / "source" / APP).read_text()
    bundle = original
    for old, new, reason in PATCHES:
        assert bundle.count(old) == 1, reason
        bundle = bundle.replace(old, new)
    restored = bundle
    for old, new, reason in reversed(PATCHES):
        assert restored.count(new) == 1, reason
        restored = restored.replace(new, old)
    assert restored == original
    (OUT / "assets" / APP).write_text(bundle)
    version = hashlib.sha256(bundle.encode()).hexdigest()[:12]
    template = (ROOT / "source/original.html").read_text()
    template = template.replace(ASSET_PREFIX, BASE + "/assets/")
    template = template.replace('window.__BASENAME__ = "/app/app_17b6n690wyg";', 'window.__BASENAME__ = "/cquisl";')
    template = template.replace(f'src="{BASE}/assets/{APP}"', f'src="{BASE}/assets/{APP}?v={version}"')
    for name in ["index.html", "database/index.html", "research/index.html", "about/index.html", "404.html"]:
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(template)
    for case in CASES:
        snapshot = SNAPSHOTS / f"{case['id']}.html"
        html = template
        if snapshot.exists():
            html = html.replace('<div id="root"></div>', '<div id="root">' + snapshot.read_text() + '</div>')
        path = OUT / "cases" / f"{case['id']}.html"
        path.parent.mkdir(exist_ok=True)
        path.write_text(html)
    urls = [ORIGIN + BASE + "/" + path for path in ["", "database/", "research/", "about/"]]
    urls += [f"{ORIGIN}{BASE}/cases/{case['id']}.html" for case in CASES]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += ''.join(f"<url><loc>{escape(url)}</loc></url>\n" for url in urls) + "</urlset>\n"
    (OUT / "sitemap.xml").write_text(sitemap)
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {ORIGIN}{BASE}/sitemap.xml\n")
    (OUT / ".nojekyll").write_text("")
    for path in [OUT / "assets/cquisl.css", OUT / "assets/favicon.svg", ROOT / "source/cquisl.css"]:
        path.unlink(missing_ok=True)
    print(json.dumps({"case_pages": len(CASES), "original_code_restored_by_reversing_patches": True,
                      "rendered_case_snapshots": sum((SNAPSHOTS / f"{c['id']}.html").exists() for c in CASES),
                      "routing_changes": len(PATCHES), "app_version": version}, ensure_ascii=False))


if __name__ == "__main__":
    main()
