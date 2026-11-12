"""Preserve the original frontend and case dialogs; adapt hosting and analytics."""
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
PATCHES = [
    ("window.__BASENAME__||`/app/app_17b6n690wyg`", "window.__BASENAME__||`/cquisl`", "hosting base path"),
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
    assert template.count('</body>') == 1
    template = template.replace('</body>', '<script defer src="/analytics.js"></script></body>')
    for name in ["index.html", "database/index.html", "research/index.html", "about/index.html", "404.html"]:
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(template)
    # Retire previously generated case pages when rebuilding an existing checkout.
    case_dir = OUT / "cases"
    if case_dir.exists():
        for path in case_dir.glob("c-[0-9][0-9][0-9][0-9].html"):
            path.unlink()
        if not any(case_dir.iterdir()):
            case_dir.rmdir()
    urls = [ORIGIN + BASE + "/" + path for path in ["", "database/", "research/", "about/"]]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += ''.join(f"<url><loc>{escape(url)}</loc></url>\n" for url in urls) + "</urlset>\n"
    (OUT / "sitemap.xml").write_text(sitemap)
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {ORIGIN}{BASE}/sitemap.xml\n")
    (OUT / ".nojekyll").write_text("")
    for path in [OUT / "assets/cquisl.css", OUT / "assets/favicon.svg", ROOT / "source/cquisl.css"]:
        path.unlink(missing_ok=True)
    print(json.dumps({"cases": len(CASES), "case_opening": "original_modal", "standalone_case_pages": 0,
                      "original_code_restored_by_reversing_patches": True,
                      "hosting_changes": len(PATCHES), "app_version": version}, ensure_ascii=False))


if __name__ == "__main__":
    main()
