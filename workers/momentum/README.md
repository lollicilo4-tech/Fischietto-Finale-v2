# Worker del momentum

Registra ogni minuto il **momentum stimato** delle partite in corso degli 8 campionati del sito, così il
grafico del Live Center parte dal primo minuto e non da quando il visitatore apre la partita.

```
cron ogni minuto ──► SportScore (lista live + dettaglio di ogni nostra partita)
        │                 calcolo di minuto e pressione con web/src/lib/livecharts.js
        ▼
   D1 "fischietto-momentum" (tabella samples: un campione per partita e minuto)
        ▲
sito ── /api/momentum?slug=… (web/functions/api/momentum.js, stesso dominio, cache 30 s)
```

- **Stessa misura del sito**: pressione = attacchi pericolosi + 2 × tiri fuori + 4 × tiri in porta + 2 × angoli,
  cumulata; il grafico disegna di quanto cresce ogni minuto. Nessun minuto viene inventato: se il servizio
  non dà minuto o statistiche, quel minuto resta vuoto.
- **Solo i nostri campionati**: le altre partite del Live continuano a essere registrate dal browser.
- **Anche le partite che SportScore non elenca**: la lista `fixtures?status=live` spesso non contiene Serie A,
  LaLiga, Premier League… (il 24 ottobre 2026 mancava Cagliari–Bologna in corso). Il Worker legge allora il
  calendario del sito (`/live-calendar.json`), cerca su SportScore lo slug delle due squadre
  (`/api/v1/search/`, una volta sola) e chiede il dettaglio `squadra-a-vs-squadra-b`, accettandolo solo se
  campionato e orario coincidono. Slug di squadre e partite restano in D1 (`team_slugs`, `match_slugs`).
  Il riassunto di ogni partita (squadre, punteggio, minuto) va in `live_rows` e il sito lo aggiunge alla lista
  del Live con `/api/live`. Le partite non trovate compaiono in `unresolved` nel riepilogo di `/health`:
  se un nome breve di football-data.org non si trova, si aggiunge a `SEARCH_ALIASES` in `src/calendar.js`.
- **Piano gratuito**: al massimo 48 richieste esterne per minuto tra lista, calendario, ricerche (6) e dettagli
  (limite: 50 richieste esterne e 10 ms di CPU per esecuzione); in D1 circa 2 righe scritte per partita al minuto (limite: 100.000
  al giorno). I dati più vecchi di 12 ore vengono cancellati ogni ora.
- **Nessuna chiave**: SportScore non ne richiede. Le richieste si presentano con un `User-Agent` che
  indica il sito.

## File

| File | Contenuto |
| --- | --- |
| `src/collect.js` | raccolta e salvataggio dei campioni (testabile: fetch e database arrivano da fuori) |
| `src/calendar.js` | partite del calendario cercate per nome, con i tetti di richieste per esecuzione |
| `src/alerts.js` | avvisi via email al proprietario (vedi sotto) |
| `src/index.js` | gestore del cron e `GET /health` |
| `schema.sql` | tabelle D1 (già create nel database `fischietto-momentum`) |
| `wrangler.jsonc` | nome, cron, binding D1 |
| `test/` | test con SQLite vero (`node:sqlite`) al posto di D1 |

```bash
cd workers/momentum
npm ci
npm test          # test
npm run check     # impacchetta senza pubblicare
```

## Attivazione (una volta, dalla dashboard Cloudflare)

1. **Workers & Pages → Create application → Import a repository**, scegli `Fischietto-Finale-v2`.
2. Imposta:
   - Project name: **`fischietto-momentum`** (deve coincidere con `name` in `wrangler.jsonc`)
   - Build command: vuoto
   - Deploy command: `npx wrangler deploy`
   - **Advanced settings → Path (root directory): `workers/momentum`**
   - Preview builds: disattivati
3. Premi **Deploy**. Il cron parte da solo; dopo un paio di minuti
   `https://fischietto-momentum.<tuo-sottodominio>.workers.dev/health` deve rispondere `"ok": true`
   (durante le partite `saved` indica quante partite sono state registrate).
4. In **Settings → Build → Build watch paths** includi `workers/momentum/*` e `web/src/lib/*`
   (il Worker usa le funzioni del Live Center in `web/src/lib`: una modifica lì deve ripubblicarlo).
5. In **Settings → Build → Branch control**: branch di produzione `main` con le pubblicazioni automatiche
   **attive**; spente solo le build degli altri branch (falliscono perché `preview_urls` è disattivato).

### Controllo dopo ogni modifica

Dopo l'unione di una PR che tocca `workers/momentum/` o `web/src/lib/`, sul commit di `main` deve comparire
il controllo **Workers Builds: fischietto-momentum**. Se manca, il Worker gira ancora la versione precedente:
verificare le impostazioni dei punti 4 e 5. Il riepilogo dell'ultima esecuzione si legge da `/health` o in D1
(`SELECT value FROM meta WHERE key = 'last_run'`); i campi `leagues` e `ourLeagues` mostrano i campionati
visti nel feed e quelli riconosciuti come nostri.

Il sito legge i dati da `/api/momentum` grazie al binding D1 dichiarato in `web/wrangler.jsonc`: non serve
altro. Finché il Worker non gira, il Live usa la serie registrata dal browser come prima.

## Avvisi via email

`src/alerts.js` scrive al proprietario quando qualcosa non va:
- SportScore non risponde da 10 minuti, oppure la sua lista live è vuota da un'ora (una volta al giorno);
- una partita in corso dei nostri campionati non viene trovata da 20 minuti;
- il calendario del sito non si legge da 15 minuti;
- i pronostici sono fermi da più di 6 ore.

Si riceve al massimo un'email ogni 6 ore per lo stesso problema e 6 al giorno in tutto. Le email partono gratis
con il binding `EMAIL` verso un indirizzo **verificato** in Email Routing. L'indirizzo non è nel repository.
Per attivare gli avvisi:

1. **Workers & Pages → fischietto-momentum → Settings → Variables and Secrets → Add**.
2. Type **Secret**, nome `ALERT_TO`, valore: la tua email, la stessa verificata come destinazione di
   `info@fischiettofinale.com`. Salva con **Deploy**.
3. Entro un minuto arriva l'email di prova "Avvisi attivi". `/health` mostra `alerts.configured` e, se l'invio
   fallisce, `alerts.lastError`, senza mostrare l'indirizzo.

## Da verificare

SportScore non pubblica condizioni d'uso per l'API: il sito la usa già dal browser con l'attribuzione
"Powered by SportScore". Questo Worker la interroga anche dal server, una volta al minuto; se SportScore
chiedesse di non farlo, basta fermare il cron (Settings → Triggers) e il Live torna a funzionare come prima.
