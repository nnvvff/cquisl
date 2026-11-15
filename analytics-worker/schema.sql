-- Separate database: never import historical Cloudflare or other-origin records.
CREATE TABLE IF NOT EXISTS events (
  site TEXT NOT NULL CHECK (site = 'cquisl'),
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  event_id TEXT NOT NULL,
  visit_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pageview', 'visit', 'case_open', 'search', 'document_open')),
  path TEXT NOT NULL,
  case_id TEXT,
  received_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (site, is_test, event_id)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS one_visit
  ON events (site, is_test, visit_key) WHERE type = 'visit';
CREATE INDEX IF NOT EXISTS events_retention ON events (received_at);

-- Permanent daily aggregates. Event IDs and anonymous visit keys expire after 7 days.
CREATE TABLE IF NOT EXISTS daily (
  site TEXT NOT NULL,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (site, is_test, day, type)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_by_day ON daily (site, day);

CREATE TRIGGER IF NOT EXISTS aggregate_insert AFTER INSERT ON events
BEGIN
  INSERT INTO daily (site, is_test, day, type, count)
  VALUES (NEW.site, NEW.is_test, NEW.day, NEW.type, 1)
  ON CONFLICT (site, is_test, day, type) DO UPDATE SET count = count + 1;
END;
