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
