"""Server locale: serve la pagina e le due API. Per la pubblicazione online si usa generate.py."""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from . import pipeline  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
logger = logging.getLogger(__name__)
app = FastAPI(title="Fischietto finale")

_ERROR_RESPONSE = {"error": "Servizio temporaneamente non disponibile. Riprova più tardi."}


def _service_error(endpoint: str) -> JSONResponse:
    """Registra i dettagli solo nei log server; non esporli al client."""
    logger.exception("Errore durante la richiesta API %s", endpoint)
    return JSONResponse(_ERROR_RESPONSE, status_code=502)


@app.get("/api/turno")
async def turno():
    try:
        return await pipeline.build_turno()
    except Exception:
        return _service_error("/api/turno")


@app.get("/api/storico")
async def storico():
    try:
        return await pipeline.build_storico()
    except Exception:
        return _service_error("/api/storico")


@app.get("/api/classifica")
async def classifica():
    try:
        return await pipeline.build_classifica()
    except Exception:
        return _service_error("/api/classifica")


# Pagina, icone, manifest: tutto ciò che sta in static/ è servito dalla radice (dopo le API)
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
