"""Storico: ogni pronostico viene salvato prima della partita e mai riscritto,
poi confrontato con il risultato reale. È l'unico modo per sapere se il modello funziona.

Il file è un JSON semplice (data/predictions.json), così può essere salvato nel
repository e sopravvivere agli aggiornamenti automatici del sito.
"""
import json
import sqlite3
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
FILE = DATA / "predictions.json"
LEGACY_DB = DATA / "predictions.db"  # versione precedente, importata una sola volta


def _import_legacy() -> dict:
    out: dict = {}
    if not LEGACY_DB.exists():
        return out
    try:
        c = sqlite3.connect(LEGACY_DB)
        rows = c.execute("SELECT match_id, home, away, kickoff, p1, px, p2, pick, pick_p FROM predictions").fetchall()
        c.close()
    except sqlite3.Error:
        return out
    for mid, home, away, kickoff, p1, px, p2, pick, pick_p in rows:
        out[mid] = dict(home=home, away=away, kickoff=kickoff, p1=p1, px=px, p2=p2, pick=pick, pick_p=pick_p)
    return out


def _load() -> dict:
    if FILE.exists():
        return json.loads(FILE.read_text(encoding="utf-8"))  # se è corrotto meglio un errore che perdere lo storico
    legacy = _import_legacy()
    if legacy:
        _write(legacy)  # migrazione una tantum da predictions.db
    return legacy


def _write(d: dict) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(FILE)


def save(match_id: str, home: str, away: str, kickoff: str, p1: float, px: float, p2: float,
         extra: dict | None = None) -> None:
    d = _load()
    if match_id in d:  # il primo pronostico resta quello valido
        return
    pick, pick_p = max((("1", p1), ("X", px), ("2", p2)), key=lambda x: x[1])
    d[match_id] = dict(home=home, away=away, kickoff=kickoff, p1=p1, px=px, p2=p2, pick=pick, pick_p=pick_p)
    if extra:  # altri mercati e gol attesi, per la scheda e per le metriche (assenti nei pronostici più vecchi)
        d[match_id].update(extra)
    _write(d)


def _outcome(m: dict) -> str:
    return "1" if m["hg"] > m["ag"] else "X" if m["hg"] == m["ag"] else "2"


def _joined(finished: list[dict]) -> list[tuple[str, dict, dict]]:
    results = {m["id"]: m for m in finished}
    rows = [(mid, p, results[mid]) for mid, p in _load().items() if mid in results]
    rows.sort(key=lambda r: r[1].get("kickoff") or "", reverse=True)
    return rows


def recent(finished: list[dict], limit: int = 9) -> list[dict]:
    """Ultime partite giocate che avevano un pronostico salvato, con il risultato vero."""
    out = []
    for mid, p, m in _joined(finished)[:limit]:
        actual = _outcome(m)
        item = {"id": mid, "home": p["home"], "away": p["away"], "kickoff": p.get("kickoff"),
                "prob": {"p1": p["p1"], "px": p["px"], "p2": p["p2"]},
                "pick": p["pick"], "pick_p": p["pick_p"], "hg": m["hg"], "ag": m["ag"],
                "actual": actual, "ok": p["pick"] == actual}
        if p.get("o25") is not None:
            item["ou"] = {"p": p["o25"], "ok": (m["hg"] + m["ag"] >= 3) == (p["o25"] >= 0.5)}
        if p.get("gg") is not None:
            item["gg"] = {"p": p["gg"], "ok": (m["hg"] > 0 and m["ag"] > 0) == (p["gg"] >= 0.5)}
        if p.get("top"):
            item["top"] = p["top"]
        out.append(item)
    return out



def _market_type(code: str) -> str:
    if code in ("1", "X", "2", "1X", "X2"):
        return "1X2"
    if code in ("Gol", "No Gol"):
        return "Gol"
    if code.startswith("Over") or code.startswith("Under"):
        return "Over/Under"
    if code == "score":
        return "Risultato esatto"
    if code:
        return "Combo"
    return "Altro"


def _market_hit(code: str, m: dict, score_code: str | None = None) -> bool:
    total = m["hg"] + m["ag"]
    outcome = _outcome(m)
    if code in ("1", "X", "2", "1X", "X2"):
        return outcome == code if code in ("1", "X", "2") else (outcome in code)
    if code == "Over 1,5":
        return total >= 2
    if code == "Over 2,5":
        return total >= 3
    if code == "Under 2,5":
        return total <= 2
    if code == "Under 3,5":
        return total <= 3
    if code == "Gol":
        return m["hg"] > 0 and m["ag"] > 0
    if code == "No Gol":
        return m["hg"] == 0 or m["ag"] == 0
    if code == "1_o15":
        return outcome == "1" and total >= 2
    if code == "2_o15":
        return outcome == "2" and total >= 2
    if code == "1x_o15":
        return outcome in ("1", "X") and total >= 2
    if code == "x2_o15":
        return outcome in ("X", "2") and total >= 2
    if code == "1x_u35":
        return outcome in ("1", "X") and total <= 3
    if code == "x2_u35":
        return outcome in ("X", "2") and total <= 3
    if code == "gg_o25":
        return m["hg"] > 0 and m["ag"] > 0 and total >= 3
    if code == "ng_u35":
        return (m["hg"] == 0 or m["ag"] == 0) and total <= 3
    if code == "score":
        return score_code == f"{m['hg']}-{m['ag']}"
    return False


def _market_performance(rows: list[tuple[str, dict, dict]]) -> dict:
    groups: dict[str, list[tuple[float, bool]]] = {}
    for _, p, m in rows:
        for item in p.get("market_predictions", []):
            code = item.get("code")
            prob = item.get("p")
            if not code or prob is None:
                continue
            kind = _market_type(code)
            groups.setdefault(kind, []).append(
                (float(prob), _market_hit(code, m, item.get("score")))
            )
    out = {}
    for kind, vals in groups.items():
        n = len(vals)
        avg_p = sum(p for p, _ in vals) / n
        hit = sum(1 for _, ok in vals if ok)
        brier = sum((p - (1.0 if ok else 0.0)) ** 2 for p, ok in vals) / n
        out[kind] = {
            "n": n,
            "hit": hit,
            "rate": hit / n,
            "avg_p": avg_p,
            "calibration_gap": hit / n - avg_p,
            "brier": brier,
            "ready": n >= 10,
        }
    return out


def _recommendation_performance(rows: list[tuple[str, dict, dict]]) -> dict:
    vals = []
    for _, p, m in rows:
        r = p.get("recommendation")
        if not r:
            continue
        code = r.get("code")
        prob = r.get("p")
        if not code or prob is None:
            continue
        vals.append((float(prob), _market_hit(code, m, r.get("score"))))
    if not vals:
        return {}
    n = len(vals)
    hit = sum(1 for _, ok in vals if ok)
    avg_p = sum(p for p, _ in vals) / n
    return {"n": n, "hit": hit, "rate": hit / n, "avg_p": avg_p,
            "calibration_gap": hit / n - avg_p, "brier": sum((p - (1.0 if ok else 0.0)) ** 2 for p, ok in vals) / n,
            "ready": n >= 10}

def _backtest(rows: list[tuple[str, dict, dict]]) -> dict:
    """Retrospettiva sui pronostici realmente salvati prima delle partite."""
    def metrics(sub):
        n=len(sub)
        if not n:
            return {"n":0,"hit":0,"rate":None,"avg_p":None,"brier":None}
        hit=sum(1 for _,p,m in sub if p["pick"]==_outcome(m))
        avg=sum(p["pick_p"] for _,p,_ in sub)/n
        brier=sum(sum((q-(1.0 if k==_outcome(m) else 0.0))**2 for k,q in (("1",p["p1"]),("X",p["px"]),("2",p["p2"]))) for _,p,m in sub)/n
        return {"n":n,"hit":hit,"rate":hit/n,"avg_p":avg,"brier":brier}

    ordered=sorted(rows,key=lambda r:r[1].get("kickoff") or "")
    windows={}
    for label,size in (("10",10),("25",25),("50",50)):
        sub=ordered[-size:] if len(ordered)>=size else ordered
        m=metrics(sub)
        m["available"]=len(ordered)>=size
        windows[label]=m

    code_stats={}
    for _,p,m in rows:
        for item in p.get("market_predictions",[]):
            code=item.get("code")
            prob=item.get("p")
            if not code or prob is None:
                continue
            key=code
            g=code_stats.setdefault(key,{"n":0,"hit":0,"sum_p":0.0,"sum_brier":0.0})
            ok=_market_hit(code,m,item.get("score"))
            g["n"]+=1
            g["hit"]+=int(ok)
            g["sum_p"]+=float(prob)
            g["sum_brier"]+=(float(prob)-(1.0 if ok else 0.0))**2
    for v in code_stats.values():
        v["rate"]=v["hit"]/v["n"]
        v["avg_p"]=v["sum_p"]/v["n"]
        v["brier"]=v["sum_brier"]/v["n"]
        v["gap"]=v["rate"]-v["avg_p"]
        del v["sum_p"],v["sum_brier"]

    return {"n":len(ordered),"windows":windows,"markets":code_stats,
            "note":"Valuta solo pronostici già salvati prima dell'esito; non ricalcola retroattivamente le previsioni."}

def history(finished: list[dict]) -> dict:
    rows = _joined(finished)
    items, brier, outcomes = [], [], []
    for mid, p, m in rows:
        actual = _outcome(m)
        outcomes.append(actual)
        brier.append(sum((q - (1.0 if k == actual else 0.0)) ** 2
                         for k, q in (("1", p["p1"]), ("X", p["px"]), ("2", p["p2"]))))
        items.append({"match": f"{p['home']} – {p['away']}", "pick": p["pick"], "p": p["pick_p"],
                      "score": f"{m['hg']}-{m['ag']}", "ok": p["pick"] == actual})
    n = len(items)
    hit = sum(1 for i in items if i["ok"])
    out = {"n": n, "hit": hit,
           "avg_p": (sum(i["p"] for i in items) / n) if n else None, "items": items[:30]}
    if not n:
        return out

    # Stato sintetico della forma del modello: usa solo risultati già chiusi.
    # Evita di dare un giudizio forte con un campione troppo piccolo.
    recent_n = min(10, n)
    recent_items = items[:recent_n]
    recent_hit = sum(1 for i in recent_items if i["ok"])
    recent_rate = recent_hit / recent_n
    overall_rate = hit / n
    if n < 10:
        status, status_label = "in_attesa", "Campione in costruzione"
    elif recent_rate >= 0.55 and recent_rate >= overall_rate + 0.08:
        status, status_label = "in_forma", "Modello in forma"
    elif recent_rate <= overall_rate - 0.08:
        status, status_label = "da_monitorare", "Da monitorare"
    else:
        status, status_label = "stabile", "Modello stabile"
    out["performance"] = {
        "status": status, "label": status_label, "recent_n": recent_n,
        "recent_hit": recent_hit, "recent_rate": recent_rate,
        "overall_rate": overall_rate
    }

    # Metodo di riferimento: usare sempre le frequenze di 1, X, 2 dell'intero campionato
    tot = len(finished)
    base = {k: sum(1 for m in finished if _outcome(m) == k) / tot for k in ("1", "X", "2")}
    brier_base = sum(sum((base[k] - (1.0 if k == a else 0.0)) ** 2 for k in base) for a in outcomes) / n
    out["brier"] = sum(brier) / n
    out["brier_base"] = brier_base
    out["base_rates"] = {k: round(v, 3) for k, v in base.items()}

    # Calibrazione: quando dichiaro una certa probabilità, quanto spesso ci prendo davvero?
    buckets = []
    for lo, hi, label in ((0, 0.45, "sotto 45%"), (0.45, 0.55, "45-55%"), (0.55, 0.65, "55-65%"), (0.65, 1.01, "65% o più")):
        sel = [i for i in items if lo <= i["p"] < hi]
        if sel:
            buckets.append({"label": label, "n": len(sel), "avg_p": sum(i["p"] for i in sel) / len(sel),
                            "hit": sum(1 for i in sel if i["ok"]) / len(sel)})
    out["calibration"] = buckets

    # Altri mercati, solo per i pronostici che li avevano salvati
    ou = [(p["o25"] >= 0.5) == (m["hg"] + m["ag"] >= 3) for _, p, m in rows if p.get("o25") is not None]
    gg = [(p["gg"] >= 0.5) == (m["hg"] > 0 and m["ag"] > 0) for _, p, m in rows if p.get("gg") is not None]
    # L'AI aiuta? Stessa partita, stesse metriche: probabilità finali contro sola statistica
    both = [(p, _outcome(m)) for _, p, m in rows if p.get("ai") and p.get("base")]
    if both:
        def br(q, a):
            return sum((q[k] - (1.0 if k == a else 0.0)) ** 2 for k in ("p1", "px", "p2"))
        def top(q):
            return max((("1", q["p1"]), ("X", q["px"]), ("2", q["p2"])), key=lambda x: x[1])[0]
        out["claude"] = {"n": len(both),
                         "brier_final": sum(br(p, a) for p, a in both) / len(both),
                         "brier_stat": sum(br(p["base"], a) for p, a in both) / len(both),
                         "hit_final": sum(1 for p, a in both if top(p) == a),
                         "hit_stat": sum(1 for p, a in both if top(p["base"]) == a)}
    # Modello nuovo (sola statistica) contro il vecchio, stesse partite
    cmp = [(p, _outcome(m)) for _, p, m in rows if p.get("old") and p.get("base")]
    if cmp:
        def br2(q, a):
            return sum((q[k] - (1.0 if k == a else 0.0)) ** 2 for k in ("p1", "px", "p2"))
        out["versions"] = {"n": len(cmp),
                           "brier_new": sum(br2(p["base"], a) for p, a in cmp) / len(cmp),
                           "brier_old": sum(br2(p["old"], a) for p, a in cmp) / len(cmp)}
    out["markets"] = {"ou": {"n": len(ou), "hit": sum(ou)}, "gg": {"n": len(gg), "hit": sum(gg)}}
    out["market_performance"] = _market_performance(rows)
    out["recommendation_performance"] = _recommendation_performance(rows)
    out["backtest"] = _backtest(rows)
    return out
