# Sito Astro di Fischietto finale

Nuova versione del sito, pensata per sostituire la pagina unica pubblicata oggi da `docs/` su GitHub Pages.
Il modello, i workflow e i JSON non cambiano: questo sito legge gli stessi file `docs/*.json` durante il build.

## Cosa cambia per chi visita il sito

- **Una pagina vera per ogni sezione**, invece di pannelli nascosti in un'unica pagina da 313 KB:
  `/`, `/serie-a/partite/`, `/premier-league/classifica/`, `/laliga/storico/`, `/live/`, `/come-funziona/`…
- **Una pagina per ogni partita e per ogni squadra** (`/serie-a/partita/558567-torino-monza/`,
  `/serie-a/squadra/torino/`): link da condividere e indicizzabili dai motori di ricerca, con titolo e descrizione propri.
- **Contenuti già nell'HTML**: le partite si leggono anche prima che parta JavaScript (o senza).
  JavaScript serve solo dove la pagina deve reagire: Live Center, Più probabili, Le scelte del modello, squadre seguite, Condividi.
- **Stessa grafica**: il CSS è quello del sito attuale (`npm run import:css`), e un test confronta l'HTML
  prodotto con quello del sito attuale campionato per campionato.
- **Sicurezza più stretta**: la Content Security Policy è un'intestazione HTTP vera (`public/_headers`) e non
  permette più script inline (`script-src 'self'`).
- **Niente linguaggio da scommesse** (serve anche per AdSense): "Più sicure" è diventata **Più probabili**
  (`/serie-a/piu-probabili/`), la "Schedina" **Le scelte del modello** (`/serie-a/scelte-del-modello/`) con i livelli
  Facile · Media · Difficile, e le "quote eque" non si mostrano più (restano solo le percentuali). I vecchi indirizzi
  portano ai nuovi con un redirect permanente (`public/_redirects`); un test controlla che queste parole non tornino.
- I vecchi link (`/?league=PL&tab=partite#m-123`, `/?tab=info`) portano alla pagina nuova; i JSON restano agli
  stessi indirizzi (`/turno.json`, `/league-PL-turno.json`…) per l'app già installata sui telefoni.

## Struttura

| Percorso | Contenuto |
| --- | --- |
| `src/lib/core.js` | campionati, indirizzi delle pagine, formattazione, date nel fuso italiano |
| `src/lib/model.js` | consiglio multi-mercato, Più probabili, Le scelte del modello (stessa logica del sito attuale) |
| `src/lib/render.js` | HTML di partite, classifica, storico, squadra… usato dal build e dal browser |
| `src/lib/livecharts.js`, `livefeed.js` | grafici e lettura del feed SportScore del Live Center |
| `src/lib/data.js` | lettura dei JSON di `docs/` durante il build |
| `src/pages/` | le pagine (Astro) |
| `src/scripts/` | le isole interattive: `app.js` (tutte le pagine), `live.js`, `sicure.js`, `schedina.js` |
| `src/styles/legacy.css` | CSS del sito attuale, **generato** da `scripts/import-legacy-css.mjs` |
| `src/styles/site.css` | le poche regole nuove |
| `public/` | `_headers` (CSP e cache), `_redirects` (vecchi indirizzi), service worker, manifest, icone |
| `functions/api/momentum.js` | unica funzione del sito: legge da D1 il momentum registrato dal Worker (`workers/momentum`) |
| `wrangler.jsonc` | configurazione del progetto Pages: cartella `dist` e binding D1 per `/api/momentum` |

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
   - *Build output directory*: `dist` (lo legge anche da `wrangler.jsonc`)
3. **Production branch**: per ora lascia `main` ma **disattiva le pubblicazioni automatiche di produzione**
   (Settings → Builds → Branch control) finché non si decide di spostare il dominio: così il sito su
   GitHub Pages resta l'unico pubblico.
4. **Preview branches**: *Custom branches*, includi solo `feat/astro-*` (Codex e Dependabot aprono molti
   branch e ogni build conta nelle 500 mensili del piano gratuito).
5. **Build watch paths**: includi `web/*` e `docs/*`. Il workflow "Aggiorna pronostici" aggiorna `docs/`
   ogni 4 ore (circa 180 build al mese), così il sito ha sempre i dati nuovi.

L'anteprima del branch arriva su `https://feat-astro-cloudflare-20261023.<progetto>.pages.dev`;
le anteprime hanno `X-Robots-Tag: noindex` e non finiscono su Google.

## Passaggio del dominio `fischiettofinale.com` da GitHub Pages a Cloudflare

Lo decide e lo fa il proprietario dalle dashboard, perché servono gli accessi al registrar e a Cloudflare.
L'ordine evita interruzioni: finché non si arriva al punto 5 il sito pubblico resta quello di GitHub Pages.
Il dominio principale (senza `www`) può puntare a Pages solo se i DNS sono su Cloudflare: per questo si
spostano i nameserver. Il piano Free di Cloudflare basta.

### Prima di iniziare
1. **Pages → fischietto-finale-v2 → Settings → Builds → Branch control**: branch di produzione `main` con le
   pubblicazioni automatiche **attive**; l'ultima pubblicazione di produzione deve essere verde.
2. **Al registrar** (dove è stato comprato il dominio): annota i record DNS attuali, compresi eventuali MX/TXT
   della posta, e **disattiva DNSSEC** se è attivo. Con DNSSEC attivo il cambio di nameserver mette il dominio
   offline; si può riattivare dopo, da Cloudflare.

### Fase 1 · DNS su Cloudflare (il sito resta su GitHub Pages)
3. **Cloudflare → Add a domain** → `fischiettofinale.com` → piano **Free**, con importazione automatica dei
   record. Controlla che ci siano tutti, e se mancano aggiungili:
   - i 4 record `A` di GitHub Pages per `fischiettofinale.com`: `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`;
   - `CNAME www → lollicilo4-tech.github.io`;
   - eventuali MX/TXT della posta, uguali a quelli annotati.

   Per ora metti questi record su **DNS only** (nuvola grigia): GitHub Pages continua a gestire il suo
   certificato.
4. Cloudflare mostra due nameserver (`nome.ns.cloudflare.com`): **al registrar sostituisci i nameserver** con
   quelli. Quando Cloudflare manda l'email "is now active" (di solito entro qualche ora, al massimo 24) si
   passa alla fase 2. Nel frattempo il sito funziona come prima.

### Fase 2 · Il dominio passa al sito Astro
5. **Workers & Pages → fischietto-finale-v2 → Custom domains → Set up a custom domain** →
   `fischiettofinale.com`. Accetta la proposta di Cloudflare di sostituire i record `A` con un `CNAME` verso
   `fischietto-finale-v2.pages.dev`. Ripeti con `www.fischiettofinale.com`.
6. Quando entrambi sono **Active** (certificato pronto, di solito pochi minuti), apri
   `https://fischiettofinale.com/serie-a/piu-probabili/`: se la pagina esiste, il dominio è sul sito nuovo.
7. **Rules → Redirect Rules → Create rule → modello "Redirect from WWW to root"** (301, conserva la query
   string). Così esiste un solo indirizzo, quello del link canonico.
8. **SSL/TLS → Edge Certificates**: attiva **Always Use HTTPS**.

### Fase 3 · Si spegne il sito vecchio
9. **GitHub → Settings → Pages**: togli il dominio personalizzato. GitHub può fare un commit che cancella
   `docs/CNAME`: è normale. Poi in *Build and deployment* scegli **None** come branch e salva. I JSON di `docs/`
   restano nel repository e continuano ad aggiornarsi ogni 4 ore: il sito Astro li legge durante il build.
10. Gli utenti con l'app installata non devono fare niente: stesso indirizzo, e il service worker nuovo (`/sw.js`)
    sostituisce quello vecchio e ne cancella le cache. I vecchi link (`/?league=PL&tab=partite`, `/turno.json`…)
    continuano a funzionare.

### Dopo il passaggio
- **Google Search Console**: aggiungi la proprietà di dominio (il record TXT si crea con un clic su Cloudflare)
  e invia `https://fischiettofinale.com/sitemap.xml`. Serve anche per AdSense.
- In `_headers` c'è già `Strict-Transport-Security` (un anno, senza sottodomini): da qui in poi il browser apre
  il sito solo in HTTPS.

### Se qualcosa va storto
In **Custom domains** del progetto Pages togli i due domini; nel DNS di Cloudflare rimetti i 4 record `A` e il
`CNAME www` di GitHub Pages; su **GitHub → Settings → Pages** riattiva il branch e il dominio. Il sito vecchio
torna online in pochi minuti.

## Limiti noti

- Le pagine delle singole partite esistono finché la partita è nel turno pubblicato; dopo, l'indirizzo dà la
  pagina 404 con i link allo Storico.
- Le squadre seguite sono salvate solo nel browser: le stelle compaiono un attimo dopo il caricamento.
- Il CSS è ancora quello stratificato del sito attuale (29 blocchi). Va semplificato in una PR separata,
  quando il sito vecchio non riceverà più modifiche.
