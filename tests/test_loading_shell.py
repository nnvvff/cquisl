"""Verify crawler/no-JS content and the build integration contract without a browser."""

import importlib.util
from html.parser import HTMLParser
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("loading_shell", ROOT / "scripts/loading_shell.py")
loading_shell = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(loading_shell)


class ShellParser(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def handle_data(self, text):
        self.text.append(text)


class LoadingShellTests(unittest.TestCase):
    def test_every_entry_has_static_content_and_native_navigation(self):
        for slug, heading in (
            ("", "数据库与研究平台"), ("database", "全球案例数据库"),
            ("research", "国际战略性诉讼的扩散理据与中国因应研究"), ("about", "关于项目"),
        ):
            with self.subTest(route=slug):
                route = f"{slug}/index.html" if slug else "index.html"
                html = loading_shell.render_loading_shell(route)
                page = ShellParser(html)
                self.assertIn(heading, "".join(page.text))
                self.assertIn(loading_shell.route_metadata(route)["intro"], "".join(page.text))
                links = [attrs for tag, attrs in page.tags if tag == "a"]
                expected = [f"/cquisl/{name}/" if name else "/cquisl/"
                            for name in ("", "database", "research", "about")]
                for href in expected:
                    self.assertIn(href, [attrs["href"] for attrs in links])
                active = [attrs["href"] for attrs in links if attrs.get("aria-current") == "page"]
                self.assertEqual(active, [f"/cquisl/{slug}/" if slug else "/cquisl/"])
                self.assertEqual(len([1 for tag, _ in page.tags if tag == "h1"]), 1)
                self.assertFalse(any(tag in {"script", "link", "iframe", "img"} for tag, _ in page.tags))
                self.assertNotIn('id="root"', html)

    def test_homepage_contains_confirmed_stats_in_static_prose(self):
        html = loading_shell.render_loading_shell("/cquisl/")
        for phrase in ("306件", "85个国家和地区", "6大法律领域"):
            self.assertIn(phrase, html)

    def test_route_aliases_share_metadata(self):
        for slug in ("", "database", "research", "about"):
            expected = loading_shell.route_metadata(slug)
            aliases = [f"/cquisl/{slug}/", f"/cquisl/{slug}/?q=海洋#cases",
                       f"{slug}/index.html" if slug else "index.html"]
            for alias in aliases:
                with self.subTest(alias=alias):
                    self.assertEqual(loading_shell.route_metadata(alias), expected)
        self.assertEqual(loading_shell.route_metadata("/cquisl"), loading_shell.route_metadata("/"))

    def test_root_hosted_mirror_and_custom_base(self):
        for base in ("", "/", "/preview/cquisl/"):
            html = loading_shell.render_loading_shell("database/index.html", base=base)
            prefix = base.rstrip("/")
            self.assertIn(f'href="{prefix}/database/" aria-current="page"', html)
            self.assertNotIn('href="//', html)
        for base in ("https://example.com", "//example.com", "relative", "/../x", "/cquisl?q=1"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                loading_shell.render_loading_shell(base=base)

    def test_unknown_routes_are_not_labeled_as_home_and_are_escaped(self):
        self.assertEqual(loading_shell.route_metadata("404.html")["heading"], "页面不存在")
        html = loading_shell.render_loading_shell('/bad"><script>alert(1)</script>')
        page = ShellParser(html)
        self.assertFalse(any(tag == "script" for tag, _ in page.tags))
        self.assertFalse(any(attrs.get("aria-current") == "page" for _, attrs in page.tags))

    def test_accessible_status_retry_and_noscript_fallback(self):
        page = ShellParser(loading_shell.render_loading_shell())
        by_id = {attrs["id"]: attrs for _, attrs in page.tags if "id" in attrs}
        self.assertEqual(by_id["cquisl-loading-status"]["role"], "status")
        self.assertEqual(by_id["cquisl-loading-status"]["aria-live"], "polite")
        self.assertIn("hidden", by_id["cquisl-loading-retry"])
        self.assertIn("noscript", [tag for tag, _ in page.tags])
        self.assertIn("启用 JavaScript 后可检索案例与查看图表。", "".join(page.text))


if __name__ == "__main__":
    unittest.main()
