"""Costruisce i dati del turno e dello storico.

Usato sia dal server locale (app/main.py) sia dal generatore del sito statico (generate.py).
"""
from datetime import datetime, timezone

from . import analyst, data, model, store

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



def _recommendations(s: dict, home: str, away: str) -> dict:
    """Seleziona un pronostico principale tra mercati semplici, gol, combo e score."""
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

    weighted = {"esito": 1.00, "doppia": 0.99, "gol": 1.015, "combo": 1.035, "score": 0.90}
    ranked = sorted(candidates, key=lambda x: x["p"] * weighted[x["kind"]], reverse=True)
    best = ranked[0]

    best_simple = max((x for x in candidates if x["kind"] in ("esito", "doppia")), key=lambda x: x["p"])
    if best["kind"] in ("combo", "gol") and best["p"] < 0.55:
        best = best_simple
    if best["kind"] == "score" or best["p"] < 0.50:
        best = best_simple

    top = sorted(candidates, key=lambda x: x["p"], reverse=True)
    best_by_kind = {}
    for x in top:
        best_by_kind.setdefault(x["kind"], x)

    return {"best": best, "alternatives": top[:6], "by_kind": best_by_kind}


async def build_turno() -> dict:
    ctx = await data.get_context()
    teams, avg_h, avg_a = ctx["teams"], ctx["avg_h"], ctx["avg_a"]

    bases = []
    for fx in ctx["fixtures"]:
        lh, la = model.expected_goals(teams, avg_h, avg_a, fx["home"], fx["away"])
        base = model.summarize(lh, la)
        base.update(lh=lh, la=la)
        old = None
        if ctx.get("teams_simple"):  # modello della prima versione, solo per il confronto
            ts, sh, sa = ctx["teams_simple"]
            old = model.summarize(*model.expected_goals_simple(ts, sh, sa, fx["home"], fx["away"]))
        bases.append({"fx": fx, "base": base, "old": old})

    analyses = await analyst.analyze_all(bases, teams, use_ai=not ctx["demo"])

    out = []
    for item, an in zip(bases, analyses):
        fx = item["fx"]
        # Il modello ricalcola le probabilità con i fattori proposti dall'AI (limitati a 0,85-1,15)
        lh, la = item["base"]["lh"] * an["factor_home"], item["base"]["la"] * an["factor_away"]
        s = model.summarize(lh, la)
        if not an["ai"]:  # il testo a regole deve citare le stesse cifre mostrate nella scheda
            an["text"] = analyst.fallback_analysis(fx, {**s, "lh": lh, "la": la}, teams)["text"]
        prob = {k: round(s[k], 4) for k in KEYS}
        recommendation = _recommendations(s, fx["home"], fx["away"])
        market_predictions = _market_predictions(s, recommendation)
        out.append({
            "id": fx["id"], "home": fx["home"], "away": fx["away"], "kickoff": fx["kickoff"], "label": fx["label"],
            "prob": prob, "fair_odds": {k: model.fair_odds(prob[k]) for k in KEYS},
            "xg": [round(lh, 2), round(la, 2)], "xg_base": [round(item["base"]["lh"], 2), round(item["base"]["la"], 2)],
            "top_scores": s["top_scores"], "markets": s.get("markets", {}), "recommendation": recommendation, "conf": s["conf"],
            "form": {"home": teams.get(fx["home"], {}).get("form", ""), "away": teams.get(fx["away"], {}).get("form", "")},
            "last": {"home": _last(ctx["finished"], fx["home"]), "away": _last(ctx["finished"], fx["away"])},
            "h2h": _h2h(ctx.get("previous", []) + ctx["finished"], fx["home"], fx["away"]),
            "analysis": {k: an[k] for k in ("ai", "text", "factor_home", "factor_away",
                                            "absences_home", "absences_away", "sources")},
        })
        if not ctx["demo"]:
            store.save(fx["id"], fx["home"], fx["away"], fx["kickoff"], prob["p1"], prob["px"], prob["p2"],
                       extra={"o25": prob["o25"], "gg": prob["gg"], "xg": [round(lh, 2), round(la, 2)],
                              "top": s["top_scores"][0][:2], "ai": bool(an["ai"]),
                              "market_predictions": market_predictions,
                              "recommendation": recommendation.get("best"),
                              "base": {k: round(item["base"][k], 4) for k in ("p1", "px", "p2")},
                              **({"old": {k: round(item["old"][k], 4) for k in ("p1", "px", "p2")}} if item["old"] else {})})

    ai_count = sum(1 for a in analyses if a["ai"])
    ai_error = next((a.get("reason") for a in analyses if a.get("reason")), None)
    if ai_count == len(analyses):
        ai_status = "attiva"
    elif ai_count > 0:
        ai_status = "parziale"
    elif ai_error:
        ai_status = "non_disponibile"
    else:
        ai_status = "solo_statistica"
    return {"demo": ctx["demo"], "ai": ai_count > 0,
            "ai_error": ai_error,
            "ai_status": ai_status,
            "matchday": ctx.get("matchday"),
            "played": [] if ctx["demo"] else store.recent(ctx["finished"]),
            "market_performance": {} if ctx["demo"] else store.history(ctx["finished"]).get("market_performance", {}),
            "recommendation_performance": {} if ctx["demo"] else store.history(ctx["finished"]).get("recommendation_performance", {}),
            "backtest": {} if ctx["demo"] else store.history(ctx["finished"]).get("backtest", {}),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            "matches": out}


async def build_storico() -> dict:
    if not data.has_key():
        return DEMO_HISTORY
    ctx = await data.get_context()
    return {"demo": False, **store.history(ctx["finished"])}


DEMO_CLASSIFICA = [
    {"pos": i + 1, "team": t, "pg": 6, "w": w, "d": d, "l": 6 - w - d, "gf": gf, "ga": ga, "pts": 3 * w + d}
    for i, (t, w, d, gf, ga) in enumerate([
        ("Inter", 5, 1, 14, 4), ("Napoli", 4, 1, 10, 5), ("Milan", 4, 0, 9, 6), ("Juventus", 3, 2, 9, 5),
        ("Atalanta", 3, 2, 11, 7), ("Roma", 3, 1, 8, 6), ("Lazio", 2, 3, 7, 6), ("Bologna", 2, 2, 7, 7),
    ])
]


async def build_classifica() -> dict:
    if not data.has_key():
        return {"demo": True, "table": DEMO_CLASSIFICA}
    ctx = await data.get_context()
    return {"demo": False, "table": ctx.get("standings", [])}
