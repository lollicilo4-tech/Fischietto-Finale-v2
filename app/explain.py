"""Spiegazioni e statistiche costruite solo dai numeri: nessuna AI, nessuna chiamata esterna.

- explain_match: "Perché il modello dice così" — i fattori che portano ai gol attesi.
- team_stats: statistiche di stagione per la pagina squadra (casa/fuori).
- upcoming_rounds: probabilità per le giornate dopo quella corrente (solo modello statistico).
"""
from . import model

FORM_MAX_EFFECT = 3  # form_factor va da 0,97 a 1,03: al massimo ±3%
FORM_EN = str.maketrans({"V": "W", "N": "D", "P": "L"})  # forma in inglese: vittoria, pareggio, sconfitta


def _pct(value: float) -> int:
    return round((value - 1) * 100)


def _art(n: int) -> str:
    """Articolo davanti a una percentuale: "l'8%", "l'11%", "il 26%"."""
    n = abs(n)
    return "l'" if n in (1, 11) or str(n).startswith("8") else "il "


def _sign(n: int) -> str:
    return f"+{n}%" if n > 0 else f"{n}%"


def explain_match(teams: dict, avg_h: float, avg_a: float, home: str, away: str,
                  lh: float, la: float, factor_home: float = 1.0, factor_away: float = 1.0,
                  absences: int = 0) -> dict | None:
    """Fattori del pronostico, dal più al meno importante.

    Ogni voce: {"side": "home"|"away"|"both", "effect": percentuale sui gol attesi di quella
    squadra, "text": frase, "text_en": la stessa frase in inglese (pagine /en/ del sito)}.
    None se il modello non ha le forze delle squadre (dati di esempio).
    """
    H, A = teams.get(home), teams.get(away)
    if not H or not A or "att" not in H or "att" not in A:
        return None
    items = []

    def add(side, effect, text, text_en):
        items.append({"side": side, "effect": effect, "text": text, "text_en": text_en})

    def attack(team, n):
        return f"Attacco {team}: nella media del campionato." if n == 0 else \
            f"Attacco {team}: segna {_art(n)}{abs(n)}% {'in più' if n > 0 else 'in meno'} della media del campionato."

    def attack_en(team, n):
        return f"{team} attack: in line with the league average." if n == 0 else \
            f"{team} attack: scores {abs(n)}% {'more' if n > 0 else 'less'} than the league average."

    def defence(team, n):
        return f"Difesa {team}: nella media del campionato." if n == 0 else \
            f"Difesa {team}: subisce {_art(n)}{abs(n)}% {'in più' if n > 0 else 'in meno'} della media."

    def defence_en(team, n):
        return f"{team} defence: in line with the league average." if n == 0 else \
            f"{team} defence: concedes {abs(n)}% {'more' if n > 0 else 'less'} than average."

    att_h, def_a = _pct(H["att"]), _pct(A["def"])
    att_a, def_h = _pct(A["att"]), _pct(H["def"])
    add("home", att_h, attack(home, att_h), attack_en(home, att_h))
    add("away", def_a, defence(away, def_a), defence_en(away, def_a))
    add("away", att_a, attack(away, att_a), attack_en(away, att_a))
    add("home", def_h, defence(home, def_h), defence_en(home, def_h))
    if avg_a > 0:
        edge = round((avg_h / avg_a - 1) * 100)
        if edge:
            add("both", edge, f"Fattore campo: in questo campionato chi gioca in casa segna in media "
                              f"{_art(edge)}{abs(edge)}% {'in più' if edge > 0 else 'in meno'} di chi è in trasferta.",
                f"Home advantage: in this league the home side scores on average {abs(edge)}% "
                f"{'more' if edge > 0 else 'less'} than the away side.")
    form_h, form_a = H.get("form", ""), A.get("form", "")
    if form_h or form_a:
        ff_h, ff_a = _pct(model.form_factor(form_h)), _pct(model.form_factor(form_a))
        add("both", max(abs(ff_h), abs(ff_a)),
            f"Forma recente: {home} {form_h or '–'}, {away} {form_a or '–'} "
            f"(peso piccolo: al massimo ±{FORM_MAX_EFFECT}% sui gol attesi).",
            f"Recent form: {home} {form_h.translate(FORM_EN) or '–'}, {away} {form_a.translate(FORM_EN) or '–'} "
            f"(small weight: at most ±{FORM_MAX_EFFECT}% on expected goals).")
    adj_h, adj_a = _pct(factor_home), _pct(factor_away)
    if adj_h or adj_a:
        parts = ([f"{home} {_sign(adj_h)}"] if adj_h else []) + ([f"{away} {_sign(adj_a)}"] if adj_a else [])
        add("both", max(abs(adj_h), abs(adj_a)),
            f"Assenze confermate dalle fonti ({absences}): gol attesi corretti di {', '.join(parts)}.",
            f"Absences confirmed by sources ({absences}): expected goals adjusted by {', '.join(parts)}.")

    ordered = sorted(items, key=lambda x: -abs(x["effect"]))
    summary = (f"Mettendo insieme questi fattori il modello stima {model_d1(lh)} gol per {home} "
               f"e {model_d1(la)} per {away}: da qui escono le probabilità di ogni risultato.")
    summary_en = (f"Putting these factors together, the model expects {lh:.1f} goals for {home} "
                  f"and {la:.1f} for {away}: the probability of every score comes from here.")
    return {"items": ordered, "summary": summary, "summary_en": summary_en}


def model_d1(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def _empty() -> dict:
    return {"pg": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "clean": 0, "blank": 0, "o25": 0, "btts": 0}


def team_stats(finished: list[dict]) -> dict:
    """{squadra: {"home": {...}, "away": {...}}} per la stagione in corso."""
    out: dict = {}
    for m in finished:
        try:
            hg, ag = int(m["hg"]), int(m["ag"])
        except (KeyError, TypeError, ValueError):
            continue
        for team, side, gf, ga in ((m["home"], "home", hg, ag), (m["away"], "away", ag, hg)):
            s = out.setdefault(team, {"home": _empty(), "away": _empty()})[side]
            s["pg"] += 1
            s["gf"] += gf
            s["ga"] += ga
            s["w" if gf > ga else "d" if gf == ga else "l"] += 1
            s["clean"] += ga == 0
            s["blank"] += gf == 0
            s["o25"] += hg + ag >= 3
            s["btts"] += hg > 0 and ag > 0
    return out


def upcoming_rounds(remaining: list[dict], current_ids: set, teams: dict, avg_h: float, avg_a: float,
                    rho: float, rounds: int = 2) -> list[dict]:
    """Le prossime `rounds` giornate dopo quella pubblicata, con le probabilità del solo modello.

    Le partite vengono raggruppate per giornata e ordinate per data; quelle già nel turno
    corrente sono escluse.
    """
    by_day: dict = {}
    for m in remaining:
        if str(m.get("id")) in current_ids or m.get("matchday") is None or not m.get("kickoff"):
            continue
        by_day.setdefault(m["matchday"], []).append(m)
    ordered = sorted(by_day.items(), key=lambda kv: min(x["kickoff"] for x in kv[1]))
    out = []
    for matchday, games in ordered:
        if len(games) < 2:  # recuperi isolati: non sono una giornata
            continue
        items = []
        for m in sorted(games, key=lambda x: x["kickoff"]):
            lh, la = model.expected_goals(teams, avg_h, avg_a, m["home"], m["away"])
            s = model.summarize(lh, la, rho)
            items.append({"id": str(m.get("id")), "home": m["home"], "away": m["away"], "kickoff": m["kickoff"],
                          "prob": {k: round(s[k], 4) for k in ("p1", "px", "p2")},
                          "xg": [round(lh, 2), round(la, 2)], "top": s["pick_score"][:2]})
        out.append({"matchday": matchday, "matches": items})
        if len(out) >= rounds:
            break
    return out
