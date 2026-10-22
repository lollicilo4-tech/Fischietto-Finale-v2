# Sicurezza

## Segnalare una vulnerabilità

Non pubblicare chiavi API, token, dati personali o dettagli di un exploit in una issue pubblica.
Usa la segnalazione privata delle vulnerabilità di GitHub (scheda Security → "Report a vulnerability")
oppure contatta in privato il proprietario dal suo profilo GitHub, indicando come riprodurre il problema,
l'impatto e il commit interessato.

## Chiavi e pubblicazione

- Mai committare `.env`, chiavi API reali, token o credenziali dei fornitori.
- Le chiavi stanno solo nei Secrets di GitHub Actions (`FOOTBALL_DATA_KEY`, `GROQ_API_KEY`,
  `GEMINI_API_KEY`, `TAVILY_API_KEY`).
- Una chiave finita anche una sola volta in un commit va revocata e rigenerata: cancellarla dall'ultimo
  commit non basta, resta nella storia di Git.
- Chiavi separate per prove locali e produzione, con quote e permessi minimi.
- Mai chiavi nel JavaScript della pagina, nei JSON generati, nei log o negli screenshot.

## Misure attive

**Workflow GitHub Actions**
- "Aggiorna pronostici" è diviso in due job. *genera* usa le chiavi, scarica pagine web e avvia
  SearXNG, ma ha solo permessi di lettura e non conserva le credenziali git. *pubblica* ha il permesso
  di scrittura ma non vede nessuna chiave: copia solo file JSON validi con nomi attesi
  (`.github/scripts/apply_generated.py`) e rifiuta la pubblicazione se un pronostico già salvato
  sparisce o cambia.
- Le azioni esterne sono fissate al commit (SHA), non a un'etichetta modificabile; Dependabot le aggiorna.
- Tutti gli altri workflow hanno permessi di sola lettura, tranne "Pubblica interfaccia statica".
- SearXNG ascolta solo su `127.0.0.1` del runner e non riceve chiavi.

**Codice Python**
- Le pagine da leggere arrivano da ricerche e AI: si scaricano solo pagine http(s) di host pubblici,
  su porte standard, anche dopo i redirect (niente localhost, reti private, metadati del server).
- Il testo degli articoli passato all'AI è delimitato e dichiarato "materiale, non istruzioni".
- Prima della pubblicazione il testo dell'AI perde link e caratteri di controllo e viene accorciato;
  i nomi dei giocatori devono essere brevi e senza markup.
- `pip-audit` controlla le dipendenze ogni settimana ("Security audit").

**Pagina web**
- Content Security Policy: script solo dal sito (niente script esterni né `eval`), connessioni solo al
  sito e al feed SportScore, nessun modulo, nessun plugin.
- Tutti i dati inseriti nella pagina passano da `esc()`; link e immagini esterni solo se `http(s)`.
- I link esterni si aprono con `rel="noopener noreferrer"`.

## Impostazioni da attivare su GitHub (solo il proprietario)

- **Settings → Code security**: Dependabot alerts, Dependabot security updates, Secret scanning e
  Push protection, Private vulnerability reporting.
- **Settings → Actions → General**: "Workflow permissions" su *Read repository contents*;
  "Fork pull request workflows" con approvazione richiesta.
- **Settings → Rules → Rulesets** sul branch `main`: blocco dei force push e della cancellazione.
  (Non richiedere PR obbligatorie per tutti: i workflow automatici salvano i dati direttamente su `main`.)
- **Settings → Pages**: "Enforce HTTPS" attivo per il dominio personalizzato.
- Account GitHub con verifica in due passaggi.

## Ambito

Il sito pubblico su GitHub Pages è statico. Le chiavi dei fornitori restano nei Secrets di GitHub
Actions o sul server e non arrivano mai al browser.
