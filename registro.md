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
