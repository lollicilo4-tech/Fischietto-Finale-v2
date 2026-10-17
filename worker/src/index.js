const API_BASE = "https://v3.football.api-sports.io";
export const LEAGUE_IDS = Object.freeze({ SA: 135, PL: 39, CL: 2, BL1: 78, PD: 140, FL1: 61 });
const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const FIXTURE_CACHE_SECONDS = 30;
const EVENT_CACHE_SECONDS = 90;
const ALLOWED_ORIGINS = new Set([
  "https://lollicilo4-tech.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

export function leagueIdFor(code) {
  return Object.prototype.hasOwnProperty.call(LEAGUE_IDS, code) ? LEAGUE_IDS[code] : null;
}

export function isLiveStatus(status) {
  return LIVE_STATUSES.has(String(status || "").toUpperCase());
}

export function normalizeFixture(raw) {
  const fixture = raw?.fixture || {};
  const status = fixture.status || {};
  const home = raw?.teams?.home || {};
  const away = raw?.teams?.away || {};
  const league = raw?.league || {};
  return {
    id: String(fixture.id ?? ""),
    league: {
      id: Number(league.id) || null,
      name: league.name || "Campionato",
      country: league.country || ""
    },
    home: { id: home.id ?? null, name: home.name || "Casa", logo: home.logo || null },
    away: { id: away.id ?? null, name: away.name || "Trasferta", logo: away.logo || null },
    goals: {
      home: raw?.goals?.home ?? null,
      away: raw?.goals?.away ?? null
    },
    status: {
      short: status.short || "LIVE",
      long: status.long || "",
      elapsed: status.elapsed ?? null,
      extra: status.extra ?? null
    },
    kickoff: fixture.date || null,
    venue: fixture.venue?.name || null,
    events: []
  };
}

export function normalizeEvent(raw, fixtureId) {
  const time = raw?.time || {};
  const team = raw?.team || {};
  const player = raw?.player || {};
  const assist = raw?.assist || {};
  const detail = raw?.detail || "";
  return {
    id: [fixtureId, time.elapsed, time.extra, team.id, player.id, raw?.type, detail].join("-"),
    minute: time.elapsed ?? null,
    extra: time.extra ?? null,
    team: team.name || "",
    player: player.name || "",
    assist: assist.name || "",
    type: raw?.type || "Event",
    detail,
    comments: raw?.comments || ""
  };
}

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function cachedProviderJson(url, cacheKey, ttlSeconds, env) {
  const cache = caches.default;
  const key = new Request("https://fischietto-cache.invalid/" + encodeURIComponent(cacheKey));
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const response = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
  });
  const data = await response.json().catch(() => null);
  const hasProviderErrors = data?.errors && Object.keys(data.errors).length > 0;
  if (!response.ok || !data || hasProviderErrors) {
    const status = response.status === 429 ? 429 : 502;
    throw Object.assign(
      new Error(response.status === 429 ? "Limite richieste API raggiunto." : "Provider Live non disponibile."),
      { status }
    );
  }

  const cachedResponse = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=" + ttlSeconds
    }
  });
  await cache.put(key, cachedResponse);
  return data;
}

async function livePayload(code, env) {
  const liveIds = Object.values(LEAGUE_IDS).join("-");
  const fixturesUrl = API_BASE + "/fixtures?live=" + liveIds;
  const fixtureData = await cachedProviderJson(fixturesUrl, "live-fixtures-six-leagues", FIXTURE_CACHE_SECONDS, env);
  const selectedId = LEAGUE_IDS[code];
  const fixtures = (Array.isArray(fixtureData.response) ? fixtureData.response : [])
    .filter((item) => Number(item?.league?.id) === selectedId && isLiveStatus(item?.fixture?.status?.short))
    .map(normalizeFixture);

  for (const match of fixtures) {
    try {
      const eventUrl = API_BASE + "/fixtures/events?fixture=" + encodeURIComponent(match.id);
      const eventData = await cachedProviderJson(eventUrl, "events-" + match.id, EVENT_CACHE_SECONDS, env);
      match.events = (Array.isArray(eventData.response) ? eventData.response : [])
        .map((event) => normalizeEvent(event, match.id));
    } catch (_) {
      // Un problema sull'endpoint eventi non deve nascondere il punteggio live.
      match.events = [];
      match.eventsUnavailable = true;
    }
  }

  fixtures.sort((a, b) => new Date(a.kickoff || 0).getTime() - new Date(b.kickoff || 0).getTime());
  return {
    provider: "API-Football",
    league: code,
    updatedAt: new Date().toISOString(),
    matches: fixtures
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") return jsonResponse({ error: "Metodo non supportato." }, 405, origin);
    if (!ALLOWED_ORIGINS.has(origin) && origin) return jsonResponse({ error: "Origine non autorizzata." }, 403, origin);

    if (url.pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        provider: "API-Football",
        configured: Boolean(env?.API_FOOTBALL_KEY),
        leagues: Object.keys(LEAGUE_IDS)
      }, 200, origin);
    }
    if (url.pathname !== "/api/live") return jsonResponse({ error: "Endpoint non trovato." }, 404, origin);

    const code = String(url.searchParams.get("league") || "").toUpperCase();
    if (!leagueIdFor(code)) return jsonResponse({ error: "Campionato non valido." }, 400, origin);
    if (!env?.API_FOOTBALL_KEY) {
      return jsonResponse({ error: "Proxy non configurato: manca il secret API_FOOTBALL_KEY nel Worker." }, 503, origin);
    }

    try {
      return jsonResponse(await livePayload(code, env), 200, origin);
    } catch (error) {
      const status = error?.status === 429 ? 429 : 502;
      return jsonResponse({
        error: status === 429
          ? "Limite richieste API raggiunto. Attendi prima di riprovare."
          : "Non riesco a leggere i dati Live dal provider. Riprova tra poco."
      }, status, origin);
    }
  }
};
