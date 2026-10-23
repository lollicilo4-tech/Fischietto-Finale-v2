"""Costruisce i dati del turno e dello storico.

Usato sia dal server locale (app/main.py) sia dal generatore del sito statico (generate.py).
"""
from datetime import datetime, timezone

from . import analyst, data, explain, model, season, store

KEYS = ["p1", "px", "p2", "o15", "o25", "u25", "u35", "gg", "ng"]

DEMO_HISTORY = {
    "demo": True, "n": 8, "hit": 6, "avg_p": 0.7075,
    "items": [
        {"match": m, "pick": k, "p": p, "score": s, "ok": ok} for m, k, p, s, ok in [
            ("Inter – Genoa", "1", 0.91, "3-0", True), ("Milan – Lazio", "1", 0.57, "1-1", False),
            ("Juventus – Como", "1", 0.62, "2-0", True), ("Atalanta – Roma", "1", 0.81, "2-1", True),
            ("Bologna – Udinese", "1", 0.78, "1-0", True), ("Fiorentina – Genoa", "1", 0.79, "2-0", True),
            ("Lecce – Cagliari", "2", 0.60, "1-1", False), ("Napoli – Torino", "1", 0.66, "2-0", True),
        ]
    ],
}


def _last(finished: list[dict], team: str, n: int = 5) -> list[dict]:
    """Ultime n partite di una squadra, dalla più recente."""
    out = []
    for m in sorted((m for m in finished if team in (m["home"], m["away"])), key=lambda m: m["date"], reverse=True)[:n]:
        home = m["home"] == team
        gf, ga = (m["hg"], m["ag"]) if home else (m["ag"], m["hg"])
        out.append({"date": m["date"][:10], "opp": m["away"] if home else m["home"], "home": home,
                    "score": f"{m['hg']}-{m['ag']}", "res": "V" if gf > ga else "N" if gf == ga else "P"})
    return out


def _h2h(pool: list[dict], home: str, away: str, n: int = 3) -> list[dict]:
    games = [m for m in pool if {m["home"], m["away"]} == {home, away}]
    return [{"date": m["date"][:10], "home": m["home"], "away": m["away"], "score": f"{m['hg']}-{m['ag']}"}
            for m in sorted(games, key=lambda m: m["date"], reverse=True)[:n]]


def _market_predictions(s: dict, recommendation: dict) -> list[dict]:
    p = s
    q = s.get("markets", {})
    items = [
        ("1", p["p1"], "esito"), ("X", p["px"], "esito"), ("2", p["p2"], "esito"),
        ("1X", p["p1"] + p["px"], "doppia"), ("X2", p["p2"] + p["px"], "doppia"),
        ("Over 1,5", p["o15"], "gol"), ("Over 2,5", p["o25"], "gol"),
        ("Under 2,5", p["u25"], "gol"), ("Under 3,5", p["u35"], "gol"),
        ("Gol", p["gg"], "gol"), ("No Gol", p["ng"], "gol"),
    ]
    for code in ("1_o15", "2_o15", "1x_o15", "x2_o15", "1x_u35", "x2_u35", "gg_o25", "ng_u35"):
        if q.get(code) is not None:
            items.append((code, q[code], "combo"))
    if s.get("top_scores"):
        score = s["top_scores"][0]
        items.append(("score", score[2], "score", f"{score[0]}-{score[1]}"))
    out = [{"code": code, "p": round(float(prob), 4), "kind": kind} for code, prob, kind, *rest in items]
    if s.get("top_scores"):
        out[-1]["score"] = f"{s['top_scores'][0][0]}-{s['top_scores'][0][1]}"
    return out



RECOMMENDED_MIN_P = 0.50   # il consiglio deve restare più probabile che no
MIN_EDGE = 0.03            # sotto i 3 punti sopra la media, il mercato non dice nulla di speciale
MIN_BASE_SAMPLE = 40       # partite minime per calcolare le frequenze del campionato
BASE_CODES = ("1", "X", "2", "1X", "X2", "Over 1,5", "Over 2,5", "Under 2,5", "Under 3,5",
              "Gol", "No Gol", "1_o15", "2_o15", "1x_o15", "x2_o15", "1x_u35", "x2_u35",
              "gg_o25", "ng_u35")


def market_base_rates(matches: list[dict]) -> dict:
    """Quanto spesso ogni mercato si è verificato nel campionato (stagione corrente e precedente).

    Serve a capire se una probabilità alta è davvero informativa: l'Over 1,5 al 85% non dice
    molto se nel campionato esce nel 78% delle partite.
    """
    games = [m for m in matches if m.get("hg") is not None and m.get("ag") is not None]
    if len(games) < MIN_BASE_SAMPLE:
        return {}
    return {code: sum(1 for m in games if store.market_hit(code, m)) / len(games) for code in BASE_CODES}


def _recommendations(s: dict, home: str, away: str, base_rates: dict | None = None) -> dict:
    """Sceglie il pronostico principale tra mercati semplici, gol e combo.

    Con le frequenze del campionato disponibili sceglie il mercato con il distacco maggiore
    dalla media (almeno il 50% di probabilità): così il consiglio dice qualcosa sulla partita,
    invece di ripetere quasi sempre "Over 1,5". Senza frequenze usa il criterio precedente.
    """
    p = s
    q = s.get("markets", {})
    z = s.get("top_scores", [])
    candidates = [
        {"code": "1", "label": f"1 · Vince {home}", "p": p["p1"], "kind": "esito"},
        {"code": "X", "label": "X · Pareggio", "p": p["px"], "kind": "esito"},
        {"code": "2", "label": f"2 · Vince {away}", "p": p["p2"], "kind": "esito"},
        {"code": "1X", "label": f"1X · {home} non perde", "p": p["p1"] + p["px"], "kind": "doppia"},
        {"code": "X2", "label": f"X2 · {away} non perde", "p": p["p2"] + p["px"], "kind": "doppia"},
        {"code": "Over 1,5", "label": "Over 1,5 · almeno 2 gol", "p": p["o15"], "kind": "gol"},
        {"code": "Over 2,5", "label": "Over 2,5 · almeno 3 gol", "p": p["o25"], "kind": "gol"},
        {"code": "Under 2,5", "label": "Under 2,5 · massimo 2 gol", "p": p["u25"], "kind": "gol"},
        {"code": "Under 3,5", "label": "Under 3,5 · massimo 3 gol", "p": p["u35"], "kind": "gol"},
        {"code": "Gol", "label": "Gol · entrambe segnano", "p": p["gg"], "kind": "gol"},
        {"code": "No Gol", "label": "No Gol · almeno una resta a 0", "p": p["ng"], "kind": "gol"},
    ]
    combo_labels = {
        "1_o15": "1 + Over 1,5",
        "2_o15": "2 + Over 1,5",
        "1x_o15": "1X + Over 1,5",
        "x2_o15": "X2 + Over 1,5",
        "1x_u35": "1X + Under 3,5",
        "x2_u35": "X2 + Under 3,5",
        "gg_o25": "Gol + Over 2,5",
        "ng_u35": "No Gol + Under 3,5",
    }
    for code, label in combo_labels.items():
        if q.get(code, 0) > 0:
            candidates.append({"code": code, "label": label, "p": q[code], "kind": "combo"})
    if z:
        candidates.append({"code": "score", "label": f"Risultato esatto · {z[0][0]}-{z[0][1]}", "p": z[0][2], "kind": "score"})

    for x in candidates:
        x["p"] = round(float(x["p"]), 4)
        if base_rates and x["code"] in base_rates:
            x["base"] = round(base_rates[x["code"]], 4)
            x["edge"] = round(x["p"] - base_rates[x["code"]], 4)

    best_simple = max((x for x in candidates if x["kind"] in ("esito", "doppia")), key=lambda x: x["p"])
    top = sorted(candidates, key=lambda x: x["p"], reverse=True)
    best_by_kind = {}
    for x in top:
        best_by_kind.setdefault(x["kind"], x)

    if base_rates:
        informative = [x for x in candidates
                       if x.get("edge") is not None and x["p"] >= RECOMMENDED_MIN_P and x["edge"] >= MIN_EDGE]
        best = max(informative, key=lambda x: (x["edge"], x["p"])) if informative else best_simple
        return {"best": best, "alternatives": top[:6], "by_kind": best_by_kind, "method": "scarto_media"}

    weighted = {"esito": 1.00, "doppia": 0.99, "gol": 1.015, "combo": 1.035, "score": 0.90}
    ranked = sorted(candidates, key=lambda x: x["p"] * weighted[x["kind"]], reverse=True)
    best = ranked[0]

    if best["kind"] in ("combo", "gol") and best["p"] < 0.55:
        best = best_simple
    if best["kind"] == "score" or best["p"] < 0.50:
        best = best_simple
    return {"best": best, "alternatives": top[:6], "by_kind": best_by_kind, "method": "probabilita"}


async def build_turno(competition: str | None = None, use_ai: bool | None = None,
                      persist: bool = True) -> dict:
    """Costruisce il turno. Con persist=False i pronostici non vengono salvati subito:
    restano in "_pending_saves" e si salvano con persist_predictions() dopo la validazione."""
    league = competition or data.COMPETITION
    ctx = await data.get_context(league)
    teams, avg_h, avg_a = ctx["teams"], ctx["avg_h"], ctx["avg_a"]
    base_rates = market_base_rates(ctx.get("previous", []) + ctx.get("finished", []))
    rho = ctx.get("rho", model.DEFAULT_RHO)

    bases = []
    for fx in ctx["fixtures"]:
        lh, la = model.expected_goals(teams, avg_h, avg_a, fx["home"], fx["away"])
        base = model.summarize(lh, la, rho)
        base.update(lh=lh, la=la)
        old = None
        if ctx.get("teams_simple"):  # modello della prima versione, solo per il confronto
            ts, sh, sa = ctx["teams_simple"]
            old = model.summarize(*model.expected_goals_simple(ts, sh, sa, fx["home"], fx["away"]))
        bases.append({"fx": fx, "base": base, "old": old})

    analyses = await analyst.analyze_all(bases, teams, use_ai=(not ctx["demo"] and use_ai is not False),
                                         league=league)

    out, pending = [], []
    for item, an in zip(bases, analyses):
        fx = item["fx"]
        # Il modello ricalcola le probabilità con i fattori proposti dall'AI (limitati a 0,85-1,15)
        lh, la = item["base"]["lh"] * an["factor_home"], item["base"]["la"] * an["factor_away"]
        s = model.summarize(lh, la, rho)
        if not an["ai"]:  # il testo a regole deve citare le stesse cifre mostrate nella scheda
            an["text"] = analyst.fallback_analysis(fx, {**s, "lh": lh, "la": la}, teams)["text"]
            if an.get("deferred"):
                an["text"] += (f" Le notizie su infortuni e squalifiche vengono cercate nelle "
                               f"{analyst.AI_WINDOW_HOURS} ore prima della partita.")
        prob = {k: round(s[k], 4) for k in KEYS}
        recommendation = _recommendations(s, fx["home"], fx["away"], base_rates)
        market_predictions = _market_predictions(s, recommendation)
        out.append({
            "id": fx["id"], "home": fx["home"], "away": fx["away"], "kickoff": fx["kickoff"], "label": fx["label"],
            "prob": prob, "fair_odds": {k: model.fair_odds(prob[k]) for k in KEYS},
            "xg": [round(lh, 2), round(la, 2)], "xg_base": [round(item["base"]["lh"], 2), round(item["base"]["la"], 2)],
            "top_scores": s["top_scores"], "markets": s.get("markets", {}), "recommendation": recommendation, "conf": s["conf"],
            "form": {"home": teams.get(fx["home"], {}).get("form", ""), "away": teams.get(fx["away"], {}).get("form", "")},
            "last": {"home": _last(ctx["finished"], fx["home"]), "away": _last(ctx["finished"], fx["away"])},
            "h2h": _h2h(ctx.get("previous", []) + ctx["finished"], fx["home"], fx["away"]),
            "explain": explain.explain_match(
                teams, avg_h, avg_a, fx["home"], fx["away"], lh, la, an["factor_home"], an["factor_away"],
                len(an.get("absences_home") or []) + len(an.get("absences_away") or [])),
            "analysis": {**{k: an.get(k) for k in ("ai", "text", "factor_home", "factor_away",
                                                    "absences_home", "absences_away", "sources")},
                         "provider": an.get("provider"),
                         "deferred": bool(an.get("deferred")),
                         "search_provider": an.get("search_provider"),
                         # True solo se l'AI ha davvero spostato i gol attesi (assenze confermate)
                         "adjusted": bool(an.get("ai")) and (abs(an["factor_home"] - 1) > 0.005
                                                             or abs(an["factor_away"] - 1) > 0.005),
                         "source_status": "fonti web disponibili; pertinenza non verificata automaticamente" if an.get("sources") else "nessuna fonte web utilizzabile",
                         "validation_warning": an.get("validation_warning"),
                         "verification": an.get("verification")},
        })
        if not ctx["demo"]:
            pending.append(dict(match_id=fx["id"], home=fx["home"], away=fx["away"], kickoff=fx["kickoff"],
                                p1=prob["p1"], px=prob["px"], p2=prob["p2"], league=league,
                                extra={"o25": prob["o25"], "gg": prob["gg"], "xg": [round(lh, 2), round(la, 2)],
                              "top": s["top_scores"][0][:2], "ai": bool(an["ai"]),
                              "market_predictions": market_predictions,
                              "recommendation": recommendation.get("best"),
                              "base": {k: round(item["base"][k], 4) for k in ("p1", "px", "p2")},
                              **({"old": {k: round(item["old"][k], 4) for k in ("p1", "px", "p2")}} if item["old"] else {})}))

    if persist:
        _save_all(pending)

    # Lo stato dell'AI conta solo le partite che rientrano nelle 48 ore: le altre aspettano.
    eligible = [a for a in analyses if not a.get("deferred")]
    ai_count = sum(1 for a in eligible if a["ai"])
    ai_error = next((a.get("reason") for a in eligible if a.get("reason")), None)
    if not eligible:
        ai_status = "solo_statistica"
    elif ai_count == len(eligible):
        ai_status = "attiva"
    elif ai_count > 0:
        ai_status = "parziale"
    elif ai_error:
        ai_status = "non_disponibile"
    else:
        ai_status = "solo_statistica"
    history_data = {} if ctx["demo"] else store.history(ctx["finished"], league=league)
    result = {"demo": ctx["demo"], "ai": ai_count > 0,
            "ai_error": ai_error,
            "ai_status": ai_status,
            "matchday": ctx.get("matchday"),
            # Giornate successive: solo modello statistico, niente AI (si aggiorna a ogni esecuzione)
            "next_rounds": [] if ctx["demo"] else explain.upcoming_rounds(
                ctx.get("remaining", []), {str(fx["id"]) for fx in ctx["fixtures"]}, teams, avg_h, avg_a, rho),
            "rho": round(rho, 3),
            # Coppe: quante squadre partono dalla forza nel proprio campionato (app/strength.py)
            "cup_prior": ctx.get("cup_prior"),
            "ai_adjusted": sum(1 for m in out if m["analysis"]["adjusted"]),
            "played": [] if ctx["demo"] else store.recent(ctx["finished"], league=league),
            "market_performance": history_data.get("market_performance", {}),
            "recommendation_performance": history_data.get("recommendation_performance", {}),
            "backtest": history_data.get("backtest", {}),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            "matches": out}
    if not persist:
        result["_pending_saves"] = pending
    return result


def _save_all(pending: list[dict]) -> None:
    for item in pending:
        store.save(**item)


def persist_predictions(turno: dict) -> int:
    """Salva i pronostici rimasti in sospeso (build_turno con persist=False) e li toglie dal payload."""
    pending = turno.pop("_pending_saves", [])
    _save_all(pending)
    return len(pending)


async def build_storico(competition: str | None = None) -> dict:
    if not data.has_key():
        return DEMO_HISTORY
    league = competition or data.COMPETITION
    ctx = await data.get_context(league)
    return {"demo": False, **store.history(ctx["finished"], league=league)}


DEMO_CLASSIFICA = [
    {"pos": i + 1, "team": t, "pg": 6, "w": w, "d": d, "l": 6 - w - d, "gf": gf, "ga": ga, "pts": 3 * w + d}
    for i, (t, w, d, gf, ga) in enumerate([
        ("Inter", 5, 1, 14, 4), ("Napoli", 4, 1, 10, 5), ("Milan", 4, 0, 9, 6), ("Juventus", 3, 2, 9, 5),
        ("Atalanta", 3, 2, 11, 7), ("Roma", 3, 1, 8, 6), ("Lazio", 2, 3, 7, 6), ("Bologna", 2, 2, 7, 7),
    ])
]


def team_ratings(ctx: dict) -> dict:
    """Forza di ogni squadra per la pagina squadra: attacco e difesa rispetto alla media (1 = media;
    per la difesa più basso è meglio) e forma recente."""
    out = {}
    for name, rating in (ctx.get("teams") or {}).items():
        if "att" in rating:
            out[name] = {"att": round(rating["att"], 3), "def": round(rating["def"], 3),
                         "form": rating.get("form", "")}
    return out


async def build_classifica(competition: str | None = None) -> dict:
    if not data.has_key():
        return {"demo": True, "table": DEMO_CLASSIFICA}
    league = competition or data.COMPETITION
    ctx = await data.get_context(league)
    table = ctx.get("standings", [])
    out = {"demo": False, "table": table, "ratings": team_ratings(ctx),
           "stats": explain.team_stats(ctx.get("finished", []))}
    try:
        out["season"] = season.simulate(table, ctx.get("remaining", []), ctx["teams"], ctx["avg_h"],
                                        ctx["avg_a"], ctx.get("rho", model.DEFAULT_RHO), league)
    except Exception as exc:  # la simulazione è un di più: non deve bloccare la classifica
        print(f"[season] {league}: simulazione non disponibile ({type(exc).__name__}: {exc})")
        out["season"] = None
    return out
