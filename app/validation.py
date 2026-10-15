"""Controlli strutturali sui dati prima della pubblicazione del sito statico."""
from datetime import datetime
from math import isfinite


def _number(value, label: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label}: valore numerico mancante o non valido") from None
    if not isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(f"{label}: valore fuori intervallo [{minimum}, {maximum}]")
    return number


def validate_turno_payload(payload: dict) -> None:
    """Blocca JSON incompleti o incoerenti prima che generate.py li pubblichi."""
    if not isinstance(payload, dict):
        raise ValueError("Il turno deve essere un oggetto JSON")
    matches = payload.get("matches")
    if not isinstance(matches, list) or not matches:
        raise ValueError("Il turno non contiene partite")

    ids = set()
    for index, match in enumerate(matches):
        prefix = f"matches[{index}]"
        if not isinstance(match, dict):
            raise ValueError(f"{prefix}: partita non valida")
        match_id = str(match.get("id", "")).strip()
        if not match_id:
            raise ValueError(f"{prefix}: ID mancante")
        if match_id in ids:
            raise ValueError(f"{prefix}: ID duplicato {match_id}")
        ids.add(match_id)

        for field in ("home", "away"):
            if not str(match.get(field, "")).strip():
                raise ValueError(f"{prefix}: squadra {field} mancante")
        if match["home"].strip().casefold() == match["away"].strip().casefold():
            raise ValueError(f"{prefix}: squadra casa e trasferta coincidono")

        kickoff = match.get("kickoff")
        if not isinstance(kickoff, str) or not kickoff.strip():
            raise ValueError(f"{prefix}: kickoff mancante")
        try:
            datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"{prefix}: kickoff ISO-8601 non valido") from None

        probs = match.get("prob")
        if not isinstance(probs, dict):
            raise ValueError(f"{prefix}: probabilità mancanti")
        required = ("p1", "px", "p2")
        values = {key: _number(probs.get(key), f"{prefix}.prob.{key}", 0.0, 1.0) for key in required}
        if abs(sum(values.values()) - 1.0) > 0.002:
            raise ValueError(f"{prefix}: le probabilità 1X2 non sommano a 1")
        for key, value in probs.items():
            _number(value, f"{prefix}.prob.{key}", 0.0, 1.0)

        xg = match.get("xg")
        if not isinstance(xg, list) or len(xg) != 2:
            raise ValueError(f"{prefix}: xG deve contenere due valori")
        for side, value in zip(("casa", "trasferta"), xg):
            _number(value, f"{prefix}.xg.{side}", 0.0, 10.0)

        scores = match.get("top_scores")
        if not isinstance(scores, list) or not scores:
            raise ValueError(f"{prefix}: risultati esatti probabili mancanti")
        for score in scores:
            if not isinstance(score, list) or len(score) < 3:
                raise ValueError(f"{prefix}: formato risultato esatto non valido")
            _number(score[0], f"{prefix}.top_scores.casa", 0, 20)
            _number(score[1], f"{prefix}.top_scores.trasferta", 0, 20)
            _number(score[2], f"{prefix}.top_scores.prob", 0, 1)

        markets = match.get("markets", {})
        if not isinstance(markets, dict):
            raise ValueError(f"{prefix}: mercati non validi")
        for key, value in markets.items():
            _number(value, f"{prefix}.markets.{key}", 0.0, 1.0)

        analysis = match.get("analysis")
        if not isinstance(analysis, dict):
            raise ValueError(f"{prefix}: analisi AI/statistica mancante")
        if analysis.get("ai"):
            for key in ("factor_home", "factor_away"):
                _number(analysis.get(key), f"{prefix}.analysis.{key}", 0.85, 1.15)
            for key in ("absences_home", "absences_away", "sources"):
                if not isinstance(analysis.get(key), list):
                    raise ValueError(f"{prefix}.analysis.{key}: deve essere una lista")
            for source in analysis["sources"]:
                if not isinstance(source, dict) or not str(source.get("url", "")).startswith(("https://", "http://")):
                    raise ValueError(f"{prefix}.analysis.sources: URL fonte non valido")


def summarize_source_coverage(payload: dict) -> dict:
    """Riepilogo della copertura delle fonti AI, senza chiamate esterne."""
    matches = payload.get("matches", []) if isinstance(payload, dict) else []
    if not isinstance(matches, list):
        matches = []
    ai_matches = []
    with_sources = 0
    source_count = 0
    for match in matches:
        if not isinstance(match, dict):
            continue
        analysis = match.get("analysis")
        if not isinstance(analysis, dict) or not analysis.get("ai"):
            continue
        ai_matches.append(match)
        sources = analysis.get("sources")
        if isinstance(sources, list):
            valid_sources = [
                source for source in sources
                if isinstance(source, dict)
                and str(source.get("url", "")).startswith(("https://", "http://"))
            ]
            source_count += len(valid_sources)
            if valid_sources:
                with_sources += 1
    total_ai = len(ai_matches)
    return {
        "matches": len(matches),
        "ai_matches": total_ai,
        "with_sources": with_sources,
        "without_sources": total_ai - with_sources,
        "source_count": source_count,
        "coverage": with_sources / total_ai if total_ai else 0.0,
    }
