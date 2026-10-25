-- 응답에는 이름·연락처가 없고, 연락처는 별도 테이블로만 보관한다 (지시서 7장).
CREATE TABLE IF NOT EXISTS responses (
  rid        TEXT PRIMARY KEY,
  test       TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  rid        TEXT PRIMARY KEY,
  test       TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dropoff (
  rid        TEXT PRIMARY KEY,
  test       TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL
);

-- uemeejung.com 방문 통계. 개인을 식별하는 값은 넣지 않는다 (IP·UA 원문 저장 안 함).
-- vid 는 브라우저가 만든 난수(localStorage), sid 는 탭 단위 난수(sessionStorage)다.
CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,   -- 서버 수신 시각 (ISO)
  vid    TEXT NOT NULL,
  sid    TEXT NOT NULL,
  type   TEXT NOT NULL,   -- pageview | click | section | exit
  path   TEXT,
  label  TEXT,            -- 클릭한 것의 이름 / 섹션 id / 이탈 시점 섹션
  href   TEXT,
  ref    TEXT,            -- 유입 출처 호스트만 (전체 URL 아님)
  device TEXT,            -- mobile | desktop
  dwell  INTEGER,         -- ms: exit=머문 시간, section=그 섹션을 본 시간
  depth  INTEGER          -- 최대 스크롤 %
);
CREATE INDEX IF NOT EXISTS events_ts   ON events (ts);
CREATE INDEX IF NOT EXISTS events_type ON events (type, ts);
CREATE INDEX IF NOT EXISTS events_sid  ON events (sid);
