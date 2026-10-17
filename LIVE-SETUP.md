# Attivare la sezione LIVE

La nuova interfaccia è predisposta, ma non mostra punteggi inventati: resta in modalità non configurata finché non viene collegato il proxy sicuro.

## Requisiti

- Un account API-Football/API-Sports con accesso live sufficiente per le sei competizioni.
- Un account Cloudflare Workers per ospitare il proxy.
- Non inserire mai la chiave API in \`static/live-config.js\`, nel codice HTML o in un commit Git.

Il piano gratuito API-Football è limitato a 100 richieste al giorno secondo la documentazione del provider: il feed live e gli eventi per ogni partita possono superare rapidamente quel limite nelle giornate con molti incontri. Verifica quote, copertura delle competizioni e prezzo attuali prima di attivarlo.

## Pubblicare il proxy

1. Apri una shell nella cartella \`worker/\`.
2. Esegui \`npx wrangler login\` e completa l'autorizzazione Cloudflare.
3. Configura la chiave come secret, non come variabile pubblica:

   \`\`\`sh
   npx wrangler secret put API_FOOTBALL_KEY
   \`\`\`

4. Incolla la chiave quando Wrangler la richiede, poi distribuisci:

   \`\`\`sh
   npx wrangler deploy
   \`\`\`

5. Apri l'URL \`workers.dev\` mostrato da Wrangler e verifica \`/api/health\`: deve restituire \`"configured": true\`. Non pubblicare il valore della chiave.
6. Modifica \`static/live-config.js\` impostando la base URL del Worker, senza aggiungere \`/api/live\` e senza chiavi:

   \`\`\`js
   window.FF_LIVE_API_URL = "https://NOME-WORKER.NOME-ACCOUNT.workers.dev";
   \`\`\`

7. Committa la modifica a \`static/live-config.js\`. La GitHub Action “Pubblica interfaccia statica” la copierà in \`docs/\`; poi verifica il sito pubblicato e apri la sezione Live.

## Cosa fa

- Punteggi e stato/minuto per le partite in corso delle sei competizioni supportate.
- Timeline di gol, autogol, rigori, cartellini e sostituzioni quando forniti dall'API.
- Aggiornamento lato browser ogni 60 secondi; cache server-side per ridurre le richieste ripetute.
- Notifiche del browser solo dopo consenso esplicito.
- Nessuna chiamata ai provider AI e nessuna modifica al modello statistico o ai pronostici.

Se il provider restituisce un errore o viene raggiunto il limite richieste, la sezione lo segnala e non inventa punteggi. Le statistiche dettagliate, le formazioni e gli eventi possono variare in base alla copertura e al piano del provider.
