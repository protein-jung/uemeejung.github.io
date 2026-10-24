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
