# CQUISL aggregate analytics

Independent, first-party event collector for `https://nnvvff.github.io/cquisl/`.
It does not load, replace or send custom events to the existing Cloudflare Web
Analytics beacon at `https://nnvvff.github.io/analytics.js`.

Deployed Worker base URL: `https://cquisl-analytics.baohaomineee.workers.dev`.
Collection: `POST https://cquisl-analytics.baohaomineee.workers.dev/collect`.
Report: `GET https://cquisl-analytics.baohaomineee.workers.dev/stats?site=cquisl&days=30&is_test=0`.
Use this base URL as `data/analytics-config.json`'s `endpoint` in the parent build.

Parent-confirmed deployment snapshot (2026-11-15): Worker version `b7bb9866`,
D1 binding `DB`, native binding `CLIENT_RATE`, no `GLOBAL_RATE`, Cron
`17 * * * *`, and default Cloudflare Logs enabled. The real-data aggregate API
returned zero counts at that verification. With this binding combination,
both request-rate checks use the in-memory fallback described below.

## Parent integration

The parent owns build/deployment. This directory does not change either site or
the Cloudflare account until deployed. Keep the GitHub Pages domain unchanged.

1. The parent build copies `enhancements/analytics.js` to
   `docs/assets/analytics-events.js`, served at `/cquisl/assets/analytics-events.js`,
   and includes it **once**, after the app, on the CQUISL app pages:

   ```html
   <script defer src="/cquisl/assets/analytics-events.js"
     data-endpoint="https://cquisl-analytics.baohaomineee.workers.dev"></script>
   ```

2. Copy `enhancements/analytics-report.html` to `/cquisl/analytics/index.html`.
   Replace its single `__ANALYTICS_ENDPOINT__` placeholder with the same Worker **base URL**.
   The source report also defaults to this real endpoint if the placeholder is
   unexpanded. No trailing `/collect` or `/stats`. The report is standalone: do not inject
   `/analytics.js`, this event client, or any other tracker into it.
3. Keep the existing `/analytics.js` inclusion and beacon unchanged on the app.
   Its existing `haomin.analytics.exclude=1` applies to this client as well.
   The initial owner Chrome exclusion is the parent's responsibility; do not
   open a real unexcluded session to verify deployment.

Both scripts require an absolute HTTPS endpoint. Missing/invalid endpoint means
no collection; the report displays that the service has not been connected.
No credentials/tokens are embedded in the client or public report.
`data-endpoint` is the primary attribute; `data-analytics-endpoint` is an alias.

## Deploy with the already authenticated Cloudflare account

The existing authenticated account has already created database
`cquisl-analytics`, UUID `43275b23-2f95-4f0b-89f9-bb35799601a0`, account
`94cdc0a6ebad3efa22699cefe2d8dd34`. Both identifiers are in `wrangler.toml`.
Do not create another production database. For a fresh independent installation
only, using an existing Wrangler/authenticated session:

```sh
npx wrangler d1 create cquisl-analytics
```

Insert the returned database UUID into `wrangler.toml`'s `database_id`. It is a
public binding identifier, not a secret. Keep this a **new, separate database**:
do not import old Cloudflare events, cross-origin records, or legacy raw traffic.
For a fresh installation, check that rate-limit namespace IDs `715201` and
`715202` are unused; select unused positive integers if necessary. They need no
credential. The current UI deployment already has `CLIENT_RATE` and does not
have `GLOBAL_RATE`.

```sh
npx wrangler d1 execute cquisl-analytics --remote --file=schema.sql
npx wrangler deploy
```

Deployment requires the D1 binding `DB`. `wrangler.toml` declares both native
rate-limiter bindings for a full Wrangler deployment; applying that binding
configuration would add `GLOBAL_RATE` and activate the native limiter pair.
The live UI deployment currently has only `CLIENT_RATE`, so it uses bounded
in-memory counters for **both** client and aggregate rate checks. It does not
call the native `CLIENT_RATE.limit()` while `GLOBAL_RATE` is absent. If both
native bindings are present, their failures return 503; a missing/failing D1
binding also returns 503. The `ALLOWED_ORIGIN` must remain exactly
`https://nnvvff.github.io` in production, without a trailing slash. Do not allow
`*`, arbitrary mirrors, `null`, preview domains, or localhost in production.
The hourly cleanup Cron `17 * * * *` is saved in the live deployment and declared
in the config. Cloudflare Logs remain enabled; `observability.enabled = true`
matches that state. This repository update does not change any live UI or
security logging setting.

This implementation uses Workers/D1 Free-compatible APIs and no paid service.
Cloudflare's [D1 Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
currently include 5 million rows read/day, 100,000 rows written/day and 5 GB total
storage; the [per-database limit](https://developers.cloudflare.com/d1/platform/limits/)
is separate. Account-wide usage from other applications counts too. Free-plan
limits can stop collection/read requests; they do not promise unlimited analytics.
This collector caps accepted events at 5,000/day (including tests, visits and PV),
and uses small indexed aggregates for report reads. Keep the account on Free;
there is no instruction here to upgrade or enable paid usage.

## Event protocol

`POST /collect`, `Content-Type: application/json`, exact required `Origin` above:

```json
{
  "site": "cquisl",
  "is_test": true,
  "visit_id": "0ce30d01-d53a-4c5b-93fc-df66c2e00616",
  "events": [
    {"id":"836abb58-5772-4840-b90a-c76345ae6f06","type":"visit","path":"/cquisl/database"},
    {"id":"b9482ca5-ff5c-4d3b-a041-95ac2e160f27","type":"pageview","path":"/cquisl/database"},
    {"id":"4df79a8f-e246-4a88-b5e5-149e21620c30","type":"case_open","path":"/cquisl/database","case_id":"c-0001"},
    {"id":"cc4c5154-53d7-44f7-9899-b39326c76781","type":"search","path":"/cquisl/database"},
    {"id":"2c1f914d-a057-46bc-aeec-5fe27bb006bc","type":"document_open","path":"/cquisl/database","case_id":"c-0001"}
  ]
}
```

Required batch fields: `site`, boolean `is_test`, random `visit_id`, 1–10 `events`.
IDs are 16–64 ASCII letters/digits/underscore/hyphen. Each event has `id`, `type`,
`path`, and optional `case_id`; unknown fields are rejected, including timestamps,
query text, document URL, session metadata, UA, or IP. `case_open` requires a
current public case ID (`c-0001`…`c-0306`); only case/document events allow it.
Paths are limited to `/cquisl/`, `/cquisl/database`, `/cquisl/research`,
`/cquisl/about`, and `/cquisl/cases/c-NNNN` for those case IDs. Search is only
valid on the homepage or database. No query strings, fragments, or report path.

202 returns `{ "received": 5, "inserted": 5 }`. `inserted` can be smaller because
of duplicates or the daily cap. A full cap drops additional events without
changing existing counts. Clients do not retry a successful 202. Other responses:
400 invalid event/JSON, 403 origin, 405 method, 413 size, 415 content type,
429 rate limit, 503 binding/database outage. No database or exception text leaks.
CORS preflight accepts only the configured origin, method and Content-Type.

## Counting and privacy

* `pageview`: initial eligible page load, restored page from browser back/forward
  cache, or SPA pathname change. Filter/query-string changes are not new PV.
* `visit`: random browser-local visit ID, shared across CQUISL tabs/reloads,
  renewed after 30 minutes without a recorded activity. This is **访问次数**, not
  unique people. Storage restrictions, independent browsers/devices and the
  narrow simultaneous-first-tab initialization race can create separate visits.
  D1 enforces one visit per `(site, is_test, visit_key)`; replay cannot add visits.
* `case_open`: a visible, connected dialog whose h2 matches a selected public
  v102 case title, or an explicit `data-case-id` on the dialog. The native
  `[data-slot="dialog-content"]` is supported even without a `role="dialog"`.
  Row clicks,
  recommendations and buttons that fail to open a dialog are not case opens.
  Closing/reopening counts again; unrelated DOM changes do not.
* `search`: nonempty database search input after 800 ms without input, or an
  explicit Enter/form submit. Enter + submit + debounce count once for the
  same input revision. Clearing, initial URL filters and filter/reset controls
  do not count. Search text stays in the input; it is never sent or persisted.
* `document_open`: primary/middle link click on a PDF/Word/ODT/RTF, or a document
  resource link in a recognized case dialog. It records **link clicks**, not
  successful downloads; URLs and document names are never sent.
* `custom_events`: sum of case opens, searches and document opens.

All dates and receipt timestamps are server-generated UTC. No client clock is
accepted. IDs deduplicate events within each real/test partition. The visit ID
is SHA-256 hashed before storage; raw visit IDs, queries, IP/UA, names, referrers
and document URLs are not stored in D1. IP contributes only to a transient hashed
rate-limit key. There is no raw-event/session API. The random client visit token
is not a person identifier and is stored only under `cquisl.analytics.visit.v1`
(or `.test`). The existing owner exclusion is read **before** creating any
session, installing trackers, queueing events or sending requests. If its storage
cannot be read, collection stays off. Setting it during use clears the queue,
cancels pending sends and disconnects observation at the next event/flush (the
cross-tab storage event applies immediately). Already transmitted data cannot
be retroactively unsent. Viewing the standalone report makes aggregate GETs only.

These collection/storage statements describe the application's event payloads,
D1 tables and public API. Cloudflare platform logs may contain infrastructure
or request metadata under the account's logging settings. The application does
not write event bodies, raw visit IDs, IP/UA, queries or document URLs to custom
logs, and does not call a console logger. Default Cloudflare Logs remain enabled;
existing security logging settings are unchanged.

The client keeps at most 40 events in memory, expires them after five minutes,
sends at most 9 activity events + 1 idempotent visit per batch, aborts requests
after five seconds, and drops queued data after three consecutive failures.
There is no background interval, offline persistent queue, dependency, or beacon.
It caps activity at 60/minute and 500/page instance. Collection is best effort:
browser closure, blocked requests, storage restrictions, limits and outages can
undercount. It never fabricates missing counts. Preserve the 306-title map when
using this client with the current bundle; update the map/ID limits when the
public dataset grows.

The Worker bounds bodies at 8 KiB even without Content-Length, batches at ten,
and D1 statements at ten per collection / two per stats query. All variable SQL
values are prepared parameters. When **both** native
[rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
are present, they allow 120 requests/minute per hashed IP + route category and
300/minute per category per Cloudflare location. If either binding is absent,
the function returns through its fallback before calling either native limiter.
That is the current live state: `CLIENT_RATE` is bound, `GLOBAL_RATE` is absent,
and the same thresholds use per-Worker-isolate in-memory minute counters, capped at
1,024 hashed client keys and reset each minute. That fallback is weaker than
native per-location counters: isolates/restarts have separate allowances. It
still bounds memory and throttles bursts handled by that isolate. These edge
limits are approximate, not global
authentication: public browser collection cannot distinguish a forged Origin
sent by a non-browser client. The database-side transactional 5,000-event daily
cap is strict across locations. A quota prevents unlimited accepted writes;
invalid/blocked traffic can still consume Worker requests. Shared network users
can hit the same IP limit. No claim of bot-proof traffic is made.

Raw deduplication rows expire after seven days, in indexed 1,000-row hourly
cleanup batches; daily aggregates remain for all-time totals. Thus the supported
retry horizon is five minutes, not indefinite historical replay. Daily aggregate
tables contain only date/type/count/site/test, with no visit identifiers.

## Aggregate API and report

`GET /stats?site=cquisl&days=30&is_test=0`

`days`: exactly 7, 30 (default), or 90. `is_test`: 0 (default) or 1.
Any supplied Origin must match production; direct requests without Origin are
allowed for this public aggregate API. No cookies/authentication are needed.
Unknown/duplicate query parameters are rejected. Successful results can be
cached at the edge for 60 seconds, with independent real/test/range cache keys.

```json
{
  "schema_version": 1,
  "source": "cquisl-first-party-v1",
  "site": "cquisl",
  "is_test": false,
  "timezone": "UTC",
  "days": 30,
  "start": "2026-10-17",
  "end": "2026-11-15",
  "generated_at": "2026-11-15T09:00:00.000Z",
  "first_day": null,
  "totals": {"pageview":0,"visit":0,"case_open":0,"search":0,"document_open":0,"custom_events":0},
  "all_time": {"pageview":0,"visit":0,"case_open":0,"search":0,"document_open":0,"custom_events":0},
  "trend": ["one numeric day/count object per day, including zero days"]
}
```

The example is a shape illustration, not production data. Real `trend` entries
are `{ "day": "YYYY-MM-DD", ...the six numeric counts above }`. `totals` is the
selected inclusive UTC date window (including today); `all_time` includes all
permanent daily rows in the selected real/test partition. `first_day` is the
first recorded day in that partition or null. The report always requests real
data, validates its source/schema/period/totals, and shows em dashes on read
failure. Only a successful valid response can produce zero counts.

Read only aggregate production values with the parent authenticated CLI:

```sh
npx wrangler d1 execute cquisl-analytics --remote --command "SELECT day, type, SUM(count) AS count FROM daily WHERE site='cquisl' AND is_test=0 GROUP BY day,type ORDER BY day DESC LIMIT 60"
npx wrangler d1 execute cquisl-analytics --remote --command "SELECT type, SUM(count) AS count FROM daily WHERE site='cquisl' AND is_test=0 GROUP BY type"
```

## Verification without inflating real traffic

Run local tests from the repository root:

```sh
node --test tests/test_analytics*.mjs
```

The tests use Node built-ins, a real SQLite database with the production schema,
and a simulated DOM/fetch/clock. They make no external requests. Node 22.13+ with
`node:sqlite` is required (Node 24 is used here). No root package changes needed.

For deployment verification, POST the exact example above with `is_test:true`
and explicit allowed Origin, then read `?days=7&is_test=1`. Repeat the same payload
and verify `inserted:0` and unchanged aggregate counts. Confirm the default real
stats totals are unchanged before/after; account for the 60-second cache window.
Never verify with `is_test:false`. Automated browser sessions are automatically
test-marked by `navigator.webdriver`; an explicit `data-analytics-test="1"`
also forces tests. An initial URL `?analytics_test=1` forces the same test mode
for that page instance, including subsequent SPA navigation. Test visit storage
is separate. None of these modes bypasses owner
exclusion: to test client collection use an isolated browser profile with the
test attribute, not the owner's excluded Chrome profile. Browser tests must also
block the separate CF beacon or use a local fixture without it, since this flag
does not change the existing CF tracker. No browser/account changes are part of
this implementation.
