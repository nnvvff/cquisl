"""Static first paint for the published React app (no build side effects).

Build integration, owned by the caller::

    from loading_shell import render_loading_shell, route_metadata

    metadata = route_metadata("database/index.html")
    # Use metadata["title"] and metadata["intro"] for title/description tags.
    html = html.replace('<div id="root"></div>',
                        render_loading_shell("database/index.html")
                        + '<div id="root"></div>')

Keep the shell OUTSIDE #root. Insert a normal synchronous script containing
enhancements/site-boot.js immediately after #root in the body. It executes before
the deferred head module and does not wait for DOMContentLoaded. The caller may
inline the script or copy it to /cquisl/assets/site-boot.js and use a classic src
script; do not mark it async, defer, or type=module.
The boot script removes only this shell and its scoped style after React commits
content (including the app's own error boundary). No React changes are required.

Routes accept build output names, relative routes or full mounted paths. A base
of "" supports a root-hosted mirror; the default preserves /cquisl navigation.
"""

from html import escape
from urllib.parse import urlsplit


_SITE_NAME = "国际战略性诉讼数据库"
_PAGES = {
    "": (
        _SITE_NAME,
        "国际战略性诉讼数据库与研究平台",
        '收录全球306件国际战略性诉讼案件，覆盖85个国家和地区、6大法律领域。'
        '以“制度—主体—动机—话语”四维分析框架，'
        "系统揭示国际战略性诉讼的全球扩散机制与中国因应策略。",
    ),
    "database": (
        f"全球案例数据库 | {_SITE_NAME}",
        "全球案例数据库",
        "收录全球306件国际战略性诉讼案件，支持多维度检索与可视化分析。",
    ),
    "research": (
        f"研究成果 | {_SITE_NAME}",
        "国际战略性诉讼的扩散理据与中国因应研究",
        "以国际战略性诉讼案件为样本，构建“制度—主体—动机—话语”四维扩散理据分析框架，"
        "研究全球扩散机制与中国因应策略。",
    ),
    "about": (
        f"关于项目 | {_SITE_NAME}",
        "关于项目",
        "《国际战略性诉讼的扩散理据与中国因应研究》——重庆大学法学院大学生创新创业训练计划项目。",
    ),
}
_NAV = (("", "首页"), ("database", "案例数据库"), ("research", "研究成果"), ("about", "关于项目"))


def _base_path(base: str) -> str:
    if not base or base == "/":
        return ""
    parts = urlsplit(base)
    if (parts.scheme or parts.netloc or parts.query or parts.fragment
            or not base.startswith("/") or base.startswith("//")
            or any(part in {".", ".."} for part in base.split("/"))):
        raise ValueError("base must be an absolute local path, such as /cquisl")
    return base.rstrip("/")


def _route_key(route: str, base: str) -> str:
    path = urlsplit(route).path
    if base and (path == base or path.startswith(base + "/")):
        path = path[len(base):]
    path = path.strip("/")
    if path == "index.html":
        path = ""
    elif path.endswith("/index.html"):
        path = path[:-len("/index.html")]
    return path


def route_metadata(route: str = "/", *, base: str = "/cquisl") -> dict[str, str]:
    """Return plain-text title, heading and intro for one route.

    Values are plain text. The caller must HTML-escape them for head tags.
    Unknown routes get a neutral unavailable-page shell, not homepage metadata;
    this also permits the generated 404.html to use the same integration.
    """
    key = _route_key(route, _base_path(base))
    title, heading, intro = _PAGES.get(
        key, (f"页面不存在 | {_SITE_NAME}", "页面不存在", "请通过导航访问案例数据库、研究成果或项目信息。")
    )
    return {"title": title, "heading": heading, "intro": intro}


_STYLE = """<style id="cquisl-loading-style">
#cquisl-loading{box-sizing:border-box;min-height:100vh;background:#fbfaf9;color:#171f26;
 font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
#cquisl-loading *,#cquisl-loading *::before,#cquisl-loading *::after{box-sizing:border-box}
#cquisl-loading a{color:inherit;text-decoration:none}
#cquisl-loading .cql-wrap{max-width:1280px;margin:0 auto;padding:0 24px}
#cquisl-loading .cql-header{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px}
#cquisl-loading .cql-brand{display:flex;align-items:center;gap:8px;flex-shrink:0}
#cquisl-loading .cql-mark{width:36px;height:36px;border-radius:6px;background:#0e3f62;color:#fff;
 display:flex;align-items:center;justify-content:center}
#cquisl-loading .cql-brand-text{display:flex;flex-direction:column;line-height:1.25}
#cquisl-loading .cql-brand-text strong{font-size:16px;font-weight:700}
#cquisl-loading .cql-brand-text small{font-size:12px;color:#657381;letter-spacing:.025em}
#cquisl-loading nav{display:flex;gap:4px}
#cquisl-loading nav a{padding:8px 16px;font-size:14px;font-weight:500;color:#657381;border-radius:6px;white-space:nowrap}
#cquisl-loading nav a[aria-current="page"]{color:#0e3f62;background:#e3e8eb}
#cquisl-loading nav a:hover{color:#171f26;background:#f9f3e7}
#cquisl-loading .cql-main{padding-top:32px;padding-bottom:64px}
#cquisl-loading h1{margin:0 0 8px;font-size:30px;line-height:1.3;font-weight:700;letter-spacing:-.025em}
#cquisl-loading .cql-intro{max-width:768px;margin:0;color:#657381;line-height:1.75}
#cquisl-loading[data-route=""] .cql-main{padding-top:96px}
#cquisl-loading[data-route=""] h1{max-width:640px;font-size:48px}
#cquisl-loading h1 span{color:#0e3f62}
#cquisl-loading[data-route="research"] .cql-main,#cquisl-loading[data-route="about"] .cql-main{
 padding-top:64px;text-align:center}
#cquisl-loading[data-route="research"] .cql-intro,#cquisl-loading[data-route="about"] .cql-intro{margin:0 auto}
#cquisl-loading .cql-state{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:32px;color:#657381;font-size:14px}
#cquisl-loading[data-route="research"] .cql-state,#cquisl-loading[data-route="about"] .cql-state{justify-content:center}
#cquisl-loading .cql-state p{margin:0}
#cquisl-loading #cquisl-loading-retry{padding:8px 16px;border:1px solid #dce0e5;border-radius:6px;color:#0e3f62;background:#fff}
#cquisl-loading #cquisl-loading-retry[hidden]{display:none}
#cquisl-loading a:focus-visible{outline:2px solid #0e3f62;outline-offset:3px}
@media(max-width:767px){
 #cquisl-loading .cql-wrap{padding-right:16px;padding-left:16px}
 #cquisl-loading .cql-header{flex-wrap:wrap;gap:0;padding-top:14px;padding-bottom:8px}
 #cquisl-loading .cql-brand-text strong{font-size:14px}
 #cquisl-loading .cql-brand-text small{font-size:10px}
 #cquisl-loading nav{width:100%;margin-top:12px;overflow-x:auto}
 #cquisl-loading nav a{flex:1;text-align:center;padding:8px;font-size:13px}
 #cquisl-loading h1{font-size:24px}
 #cquisl-loading[data-route=""] .cql-main{padding-top:64px}
 #cquisl-loading[data-route=""] h1{font-size:30px}
}
</style>"""


def render_loading_shell(route: str = "/", *, base: str = "/cquisl") -> str:
    """Return self-contained inline CSS + visible HTML, as a sibling of #root.

    The shell needs no requests, fonts, JavaScript, app CSS or app data. Native
    navigation and a noscript message remain available with JavaScript disabled.
    All selectors are scoped; nothing hides #root or covers app/portal overlays.
    """
    base = _base_path(base)
    key = _route_key(route, base)
    metadata = route_metadata(route, base=base)
    heading = ("国际战略性诉讼<br><span>数据库与研究平台</span>"
               if key == "" else escape(metadata["heading"]))
    home = escape(base + "/", quote=True)
    retry = escape(base + "/" + (key + "/" if key else ""), quote=True)
    nav = "".join(
        f'<a href="{escape(base + "/" + (slug + "/" if slug else ""), quote=True)}"'
        + (' aria-current="page"' if slug == key else "")
        + f'>{label}</a>' for slug, label in _NAV
    )
    return _STYLE + f"""
<div id="cquisl-loading" data-route="{escape(key, quote=True)}" data-state="loading">
 <header class="cql-wrap cql-header">
  <a class="cql-brand" href="{home}">
   <span class="cql-mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v17M5 20h14M4 7l8-4 8 4M4 7l-3 7h6L4 7zm16 0-3 7h6l-3-7z"/></svg></span>
   <span class="cql-brand-text"><strong>{_SITE_NAME}</strong><small>International Strategic Litigation Database</small></span>
  </a>
  <nav aria-label="主导航">{nav}</nav>
 </header>
 <main class="cql-wrap cql-main">
  <h1>{heading}</h1>
  <p class="cql-intro">{escape(metadata['intro'])}</p>
  <div class="cql-state">
   <p id="cquisl-loading-status" role="status" aria-live="polite" aria-atomic="true">正在加载…</p>
   <a id="cquisl-loading-retry" href="{retry}" hidden>重新加载</a>
   <noscript><style>#cquisl-loading-status{{display:none}}#cquisl-loading #cquisl-loading-retry[hidden]{{display:inline-block}}</style><p>启用 JavaScript 后可检索案例与查看图表。</p></noscript>
  </div>
 </main>
</div>"""
