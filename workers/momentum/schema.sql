-- Database D1 "fischietto-momentum": campioni di pressione delle partite live, uno al minuto.
-- Applicare con: npx wrangler d1 execute fischietto-momentum --remote --file=schema.sql
-- (è idempotente: si può rieseguire senza perdere dati).

-- Un campione per partita e minuto: indice di pressione cumulato (attacchi pericolosi, tiri, angoli)
-- di casa (h) e trasferta (a), come lo calcola il Live Center del sito.
CREATE TABLE IF NOT EXISTS samples (
  slug TEXT NOT NULL,
  minute INTEGER NOT NULL,
  h REAL NOT NULL,
  a REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (slug, minute)
) WITHOUT ROWID;

-- Ultimo minuto registrato per partita: serve a unire il recupero del 1° tempo con il 46'.
CREATE TABLE IF NOT EXISTS matches (
  slug TEXT PRIMARY KEY,
  home TEXT,
  away TEXT,
  league TEXT,
  last_minute INTEGER,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Stato dell'ultima esecuzione del cron, letto da /health.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Riassunto di ogni partita dei nostri campionati (campi della lista SportScore, in JSON), letto dal
-- sito con /api/live: così il Live mostra le partite che la lista di SportScore non elenca.
CREATE TABLE IF NOT EXISTS live_rows (
  slug TEXT PRIMARY KEY,
  league TEXT,
  row TEXT NOT NULL,
  live INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Slug SportScore delle partite del nostro calendario (chiave "SA:558560"), trovati per nome.
CREATE TABLE IF NOT EXISTS match_slugs (
  match_key TEXT PRIMARY KEY,
  slug TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Slug SportScore candidati per i nomi delle squadre del nostro calendario (array JSON).
CREATE TABLE IF NOT EXISTS team_slugs (
  name TEXT PRIMARY KEY,
  slugs TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
