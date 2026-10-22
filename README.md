# Fischietto finale

App che stima come potrebbe andare ogni partita di Serie A, Premier League, Bundesliga, LaLiga, Ligue 1, Champions League, Europa League e Conference League. Soluzione ibrida in tre livelli:

| Livello | Cosa fa | File |
|---|---|---|
| Dati | Risultati e calendario da football-data.org; Europa e Conference League da un CSV pubblico ([open-matchday](https://github.com/oladeeayo/open-matchday)) | `app/data.py` |
| Modello | Poisson con correzione di Dixon-Coles stimata dai risultati di ogni campionato, forma recente, quote eque (1 / probabilità) | `app/model.py` |
| Groq + GPT-OSS, con Gemini di riserva | Cerca notizie e indisponibilità; ogni assenza viene confermata leggendo il testo delle fonti prima di correggere i gol attesi | `app/analyst.py`, `app/evidence.py` |
| Ricerca gratuita | Quando Groq è fuori quota l'app cerca le notizie da sola (SearXNG, poi Tavily) e Gemini legge gli articoli trovati | `app/news.py` |

I numeri restano al modello, quindi sono stabili e verificabili. L'AI non inventa probabilità né quote:
può solo correggere i gol attesi (tra 0,85 e 1,15) per assenze confermate. Un'assenza conta solo se
un articolo trovato cita il giocatore e la squadra in una frase che ne conferma l'indisponibilità
("out per", "squalificato", "ruled out"...) senza parole di incertezza ("in dubbio", "recuperato"...).
Se solo alcune assenze sono confermate, la correzione si riduce in proporzione.
Ogni partita pubblica in `analysis.verification` quante assenze sono state segnalate e confermate,
il motivo delle mancate conferme e l'esito della lettura di ogni pagina (senza il testo); il
riepilogo per campionato compare anche nel log di "Aggiorna pronostici".

Il pronostico consigliato non è semplicemente il più probabile (sarebbe quasi sempre "Over 1,5"):
è il mercato con il distacco maggiore dalla media del campionato, con almeno il 50% di probabilità.
La scheda mostra la media accanto al consiglio.
Le quote eque non sono quote di bookmaker: quelle vere richiedono un'API dedicata.

Ogni pronostico viene salvato in `data/predictions.json` prima della partita e mai riscritto
(`app/store.py`), poi confrontato con il risultato nella scheda Storico.

## Prova in locale

```bash
py -m pip install -r requirements.txt
copy .env.example .env      # poi inserisci le chiavi in .env; senza chiavi parte in demo
py -m uvicorn app.main:app --reload
```

Apri http://localhost:8000.

- **Senza chiavi**: dati inventati e analisi a regole (etichetta "Dati di esempio").
- **Con `FOOTBALL_DATA_KEY`**: dati reali dei campionati supportati. I sei campionati di football-data.org usano l’analisi AI quando disponibile (Europa e Conference League solo statistica); Groq è il provider principale e Gemini quello di riserva. Se un provider non è disponibile, il modello statistico continua a produrre le probabilità e lo stato dell’analisi segnala il fallback.
- **Con `GROQ_API_KEY`**: Groq è il provider principale e usa `browser_search`.
- **Con anche `GEMINI_API_KEY`**: Gemini entra in funzione solo se Groq fallisce o raggiunge un limite. Nel piano gratuito Gemini **non può cercare sul web** (Google Search grounding è solo a pagamento): per questo l'app cerca le notizie da sola e Gemini legge gli articoli trovati. La cache di 72 ore evita chiamate ripetute.
- **Ricerca notizie gratuita**: `SEARXNG_URL` (SearXNG, gratuito e illimitato; nel workflow parte in automatico come container) e `TAVILY_API_KEY` (facoltativo: 1.000 ricerche gratis al mese, senza carta di credito, account su tavily.com). Si prova prima SearXNG, poi Tavily. Senza nessuno dei due si usa Gemini con Google Search, che nel piano gratuito di solito risponde senza fonti: in quel caso non si applicano correzioni e il testo lo dichiara.
- **Facoltativo**: `GEMINI_MODEL` permette di cambiare modello; il predefinito è `gemini-3.5-flash-lite`.

## Pubblicazione gratuita

Il sito online è statico: un'automazione di GitHub (`.github/workflows/update.yml`) esegue `generate.py`
ogni 4 ore, scrive i dati nella cartella `docs/` e la pubblica. Il selettore consente di passare tra gli otto campionati; dati e classifica sono separati per campionato.
Ogni campionato è indipendente: se uno non si aggiorna (API o CSV non raggiungibili), gli altri vengono
pubblicati lo stesso, il suo ultimo JSON resta online e l'esecuzione viene segnata come fallita su GitHub.
I pronostici (`data/predictions.json`) e la cache delle analisi AI (`data/ai_cache.json`) vengono salvati nel repository. I visitatori non fanno mai
partire chiamate a football-data.org o all'AI, quindi il costo dell'AI non dipende dal traffico. Il server può restare spento, il sito è sempre acceso e lo Storico non si perde.

1. **GitHub**: crea un account su github.com e un repository nuovo **pubblico**. GitHub Pages è gratuito solo
   per i repository pubblici; con uno privato serve un piano a pagamento, oppure Cloudflare Pages (punto 5).
   Le chiavi non finiscono nel repository, restano nei Secrets.
2. **Carica il progetto con GitHub Desktop**, non trascinando i file nel browser: GitHub Desktop rispetta
   `.gitignore` e non carica il file `.env` con le chiavi. Verifica comunque che `.env.example` abbia le righe
   delle chiavi vuote.
3. **Secrets**: nel repository apri Settings, Secrets and variables, Actions, e crea `FOOTBALL_DATA_KEY`, `GROQ_API_KEY` e `GEMINI_API_KEY` con le rispettive chiavi; facoltativo `TAVILY_API_KEY`.
4. **Prima generazione**: scheda Actions, "Aggiorna pronostici", Run workflow. In un paio di minuti compare
   la cartella `docs/` con il sito.
5. **Pubblica `docs/`** con uno di questi:
   - GitHub Pages: Settings, Pages, Source "Deploy from a branch", branch `main`, cartella `/docs`.
   - Cloudflare Pages: collega il repository, build command vuoto, output directory `docs`.
6. Per mantenere il progetto a costo zero, usa il piano gratuito Groq e non configurare un piano a consumo. Se in futuro abiliti un piano a pagamento, imposta un limite di spesa.

## App su iPhone

Il sito è una web app installabile (PWA), senza App Store e senza costi. Dopo la pubblicazione, su iPhone:
apri l'indirizzo del sito in **Safari**, tocca il pulsante Condividi, poi "Aggiungi alla schermata Home".
Compare l'icona del fischietto, si apre a schermo intero e, senza rete, mostra gli ultimi dati scaricati
con l'avviso "Offline · ultimi dati salvati".
Funziona solo con un indirizzo `https://`, come quello di GitHub Pages o Cloudflare Pages.

Un'app nativa per l'App Store richiede l'iscrizione al programma sviluppatori Apple (a pagamento) e un Mac,
e Apple tende a rifiutare le app che sono solo un sito impacchettato o che toccano il tema delle scommesse.

## Pubblicità

Parti senza. Google AdSense richiede approvazione, un'informativa privacy e, in Europa, il consenso ai cookie
tramite un sistema certificato; di solito conviene un dominio tuo. Prima di attivarla controlla i termini del
servizio che ospita il sito e le regole italiane sulla comunicazione legata al gioco. La licenza gratuita di
football-data.org richiede l'attribuzione, già presente nel piè di pagina.

## Limiti da conoscere

- A inizio stagione il modello ha pochi dati: le stime sono spostate verso la media del campionato.
- football-data.org non fornisce infortuni: li porta l'AI dalla ricerca web, con le fonti mostrate.
  La verifica sul testo non controlla la data dell'articolo: si affida alla ricerca delle ultime 72 ore.
- Nelle coppe europee ogni squadra parte dal livello del suo campionato (Premier, Liga, Serie A,
  Bundesliga, Ligue 1; le altre leghe con un livello unico più basso) e, in misura minore, dalla sua
  forza nel campionato; le partite europee poi correggono la stima (`app/strength.py`). Il peso della
  forza nazionale è tarato su poche partite: va ricontrollato quando lo storico delle coppe crescerà.
- Gli orari di Europa e Conference League arrivano dal CSV in ora CET fissa (UTC+1): con l'ora legale conviene verificarli.
- Le multiple mostrano la probabilità composta assumendo partite indipendenti.
- Durante le pause per le nazionali non ci sono partite in programma e il sito resta fermo all'ultimo turno.
