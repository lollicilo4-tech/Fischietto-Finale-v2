# Sito Astro di Fischietto finale

Nuova versione del sito, pensata per sostituire la pagina unica pubblicata oggi da `docs/` su GitHub Pages.
Il modello, i workflow e i JSON non cambiano: questo sito legge gli stessi file `docs/*.json` durante il build.

## Cosa cambia per chi visita il sito

- **Una pagina vera per ogni sezione**, invece di pannelli nascosti in un'unica pagina da 313 KB:
  `/`, `/serie-a/partite/`, `/premier-league/classifica/`, `/laliga/storico/`, `/live/`, `/come-funziona/`…
- **Una pagina per ogni partita e per ogni squadra** (`/serie-a/partita/558567-torino-monza/`,
  `/serie-a/squadra/torino/`): link da condividere e indicizzabili dai motori di ricerca, con titolo e descrizione propri.
- **Contenuti già nell'HTML**: le partite si leggono anche prima che parta JavaScript (o senza).
  JavaScript serve solo dove la pagina deve reagire: Live Center, Più sicure, Schedina, squadre seguite, Condividi.
- **Stessa grafica**: il CSS è quello del sito attuale (`npm run import:css`), e un test confronta l'HTML
  prodotto con quello del sito attuale campionato per campionato.
- **Sicurezza più stretta**: la Content Security Policy è un'intestazione HTTP vera (`public/_headers`) e non
  permette più script inline (`script-src 'self'`).
- I vecchi link (`/?league=PL&tab=partite#m-123`, `/?tab=info`) portano alla pagina nuova; i JSON restano agli
  stessi indirizzi (`/turno.json`, `/league-PL-turno.json`…) per l'app già installata sui telefoni.

## Struttura

| Percorso | Contenuto |
| --- | --- |
| `src/lib/core.js` | campionati, indirizzi delle pagine, formattazione, date nel fuso italiano |
| `src/lib/model.js` | consiglio multi-mercato, Più sicure, Schedina (stessa logica del sito attuale) |
| `src/lib/render.js` | HTML di partite, classifica, storico, squadra… usato dal build e dal browser |
| `src/lib/livecharts.js`, `livefeed.js` | grafici e lettura del feed SportScore del Live Center |
| `src/lib/data.js` | lettura dei JSON di `docs/` durante il build |
| `src/pages/` | le pagine (Astro) |
| `src/scripts/` | le isole interattive: `app.js` (tutte le pagine), `live.js`, `sicure.js`, `schedina.js` |
| `src/styles/legacy.css` | CSS del sito attuale, **generato** da `scripts/import-legacy-css.mjs` |
| `src/styles/site.css` | le poche regole nuove |
| `public/` | `_headers` (CSP e cache), service worker, manifest, icone |

## Comandi

Serve Node.js 22.23.4 o più recente (Astro 7); la versione usata da Cloudflare è in `.node-version`.

```bash
cd web
npm ci            # dipendenze
npm run dev       # sito in locale su http://localhost:4321
npm test          # test (servono anche Node e i file di tests/ nella radice del repo)
npm run build     # sito statico in dist/
npm run check:dist  # controlli su dist/: link rotti, script inline, CSP, sitemap
npm run import:css  # ricopia il CSS da static/index.html dopo una modifica alla grafica del sito attuale
```

`FF_DATA_DIR=/altra/cartella npm run build` usa JSON diversi da `../docs` (utile per provare dati finti).

## Pubblicazione su Cloudflare Pages (gratuita, senza chiavi nel repository)

Il collegamento si fa una volta sola dalla dashboard Cloudflare, perché richiede l'autorizzazione GitHub:

1. **Workers & Pages → Create → Pages → Connect to Git**, scegli `lollicilo4-tech/Fischietto-Finale-v2`.
2. Impostazioni di build:
   - *Framework preset*: Astro
   - *Root directory*: `web`
   - *Build command*: `npm ci --ignore-scripts && npm run build && npm run check:dist`
   - *Build output directory*: `dist`
3. **Production branch**: per ora lascia `main` ma **disattiva le pubblicazioni automatiche di produzione**
   (Settings → Builds → Branch control) finché non si decide di spostare il dominio: così il sito su
   GitHub Pages resta l'unico pubblico.
4. **Preview branches**: *Custom branches*, includi solo `feat/astro-*` (Codex e Dependabot aprono molti
   branch e ogni build conta nelle 500 mensili del piano gratuito).
5. **Build watch paths**: includi `web/*` e `docs/*`. Il workflow "Aggiorna pronostici" aggiorna `docs/`
   ogni 4 ore (circa 180 build al mese), così il sito ha sempre i dati nuovi.

L'anteprima del branch arriva su `https://feat-astro-cloudflare-20261023.<progetto>.pages.dev`;
le anteprime hanno `X-Robots-Tag: noindex` e non finiscono su Google.

**Passaggio del dominio** (decisione del proprietario, non fatta in questa PR): quando l'anteprima va bene,
riattivare le pubblicazioni di produzione su `main`, aggiungere `fischiettofinale.com` in *Custom domains*
del progetto Pages e solo dopo togliere il dominio da GitHub Pages. Il service worker nuovo (`/sw.js`, stesso
indirizzo) sostituisce quello vecchio e ne cancella le cache.

## Limiti noti

- Le pagine delle singole partite esistono finché la partita è nel turno pubblicato; dopo, l'indirizzo dà la
  pagina 404 con i link allo Storico.
- Le squadre seguite sono salvate solo nel browser: le stelle compaiono un attimo dopo il caricamento.
- Il CSS è ancora quello stratificato del sito attuale (29 blocchi). Va semplificato in una PR separata,
  quando il sito vecchio non riceverà più modifiche.
