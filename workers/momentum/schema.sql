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
