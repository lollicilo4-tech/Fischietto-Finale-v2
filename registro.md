# Registro del monitoraggio orario

Registro condiviso tra **Claude** e **Codex**, che controllano il sito ogni ora
(regole complete in `AGENTS.md`, sezione "Monitoraggio orario"). Sta su questo branch,
non su `main`, così non disturba gli aggiornamenti automatici. Il branch contiene solo questo file.

Come si scrive: una riga per evento, **solo in fondo**, mai modificare o cancellare righe vecchie.

    - AAAA-MM-GG HH:MM UTC · agente · STATO · descrizione breve · link (facoltativo)

STATO:
- `OK` — controllo pulito (al massimo una riga al giorno per agente, per dire "sono attivo")
- `PROBLEMA` — problema nuovo trovato da `health_check.py` o da un controllo a mano
- `IN CARICO` — l'agente sta lavorando alla correzione (indicare il branch): l'altro non duplica
- `RISOLTO` — il problema non compare più (indicare PR o motivo)

Se il push di questo file fallisce perché l'altro agente ha appena scritto:
`git pull --rebase origin monitoraggio` e riprovare.

## Eventi

- 2026-10-23 06:08 UTC · Claude · OK · Primo controllo: 8 campionati validi e aggiornati, storico integro (247 pronostici), workflow senza errori
- 2026-10-23 08:28 UTC · Codex · PROBLEMA · Controllo orario bloccato: clone GitHub e `python3 .github/scripts/health_check.py` non eseguiti perché l'ambiente non risolve github.com (DNS); nessuna correzione avviata
- 2026-10-23 09:02 UTC · Codex · PROBLEMA · Blocco confermato al nuovo tentativo: `git clone https://github.com/lollicilo4-tech/Fischietto-Finale-v2.git` fallisce con `Could not resolve host: github.com`; impossibile eseguire il fetch richiesto e `health_check.py`. L'API GitHub è consultabile tramite connettore ma non sostituisce il controllo obbligatorio su clone locale; nessuna modifica applicativa avviata.

- 2026-10-23 09:02 UTC · Codex · PROBLEMA · Health check automatico ancora bloccato: clone/DNS github.com non disponibile, quindi script non eseguito. Verifica manuale via API: 24 JSON validi e aggiornati (turni 08:30–08:33 UTC), update/test/deploy/security recenti verdi; classifica CL mantiene posizioni duplicate 20 e 29, già trattata dalla PR #91 aperta con test verde: nessuna correzione parallela. Verifica HTTP del dominio non disponibile da questo ambiente.
- 2026-10-23 12:28 UTC · Codex · PROBLEMA · Controllo ufficiale ancora bloccato: clone e `git fetch --shallow-since="2 days ago" origin main` falliscono per DNS (`Could not resolve host: github.com`), quindi `python3 .github/scripts/health_check.py` non eseguito. Verifica manuale via API: tutti i 24 JSON parsabili, 8 leghe aggiornate 12:25–12:27 UTC, workflow genera/test e deploy riusciti; resta l'anomalia delle posizioni CL 20 e 29, già coperta dalla PR #91 aperta: nessuna correzione parallela.
- 2026-10-23 13:16 UTC · Codex · RISOLTO · Anomalia classifica Champions League chiusa dalla PR #91 (merge 12:45 UTC): JSON rigenerato alle 12:51 UTC, 36 squadre con posizioni 1–36 uniche e continue; punti e partite giocate coerenti. Workflow di generazione e deploy riusciti.
- 2026-10-23 13:16 UTC · Codex · PROBLEMA · Health check ufficiale ancora bloccato: clone HTTPS fallisce con `Could not resolve host: github.com`; impossibile eseguire `git fetch --shallow-since="2 days ago" origin main` e `python3 .github/scripts/health_check.py`. Verifica manuale API: 24 JSON parsabili, 8 turni aggiornati 12:49–12:51 UTC, probabilità 1X2 valide, storico e classifiche coerenti; 8 PR aperte senza controlli falliti. Nessuna correzione applicativa avviata.
- 2026-10-23 14:38 UTC · Codex · PROBLEMA · Nuovo controllo: aggiornamento dati non oltre soglia (turni generati 12:49–12:51 UTC, età 104–106 min); tutti gli 8 turni, 8 storici e 8 classifiche JSON parsabili, probabilità 1X2 valide, posizioni/classifiche e aritmetica punti coerenti; test, generazione e deploy recenti riusciti, controlli delle 8 PR aperte verdi. Controllo ufficiale ancora bloccato: `git clone` fallisce con `Could not resolve host: github.com`, quindi fetch richiesto e `health_check.py` non eseguiti; dominio pubblico non verificabile dall'ambiente. Nessuna modifica applicativa o a main.
- 2026-10-23 15:56 UTC · Codex · PROBLEMA · Health check ufficiale ancora bloccato: `git clone https://github.com/lollicilo4-tech/Fischietto-Finale-v2.git` fallisce con `Could not resolve host: github.com`, quindi non è stato possibile eseguire `git fetch --shallow-since="2 days ago" origin main` né `python3 .github/scripts/health_check.py`. Verifica manuale via GitHub API: 24 JSON parsabili, 8 turni aggiornati 15:51–15:53 UTC, probabilità 1X2 e ID partita validi, storico coerente con i conteggi, 8 classifiche con posizioni uniche e aritmetica punti corretta; generazione, test e deploy più recenti riusciti, 8 PR aperte senza check falliti. Dominio pubblico non raggiungibile dall'ambiente; nessuna correzione applicativa avviata.
