/* Calendario .ics di ogni squadra (src/lib/ics.js): /calendario/serie-a/inter.ics. */
import { teamPaths } from "../../../lib/paths.js";
import { leagueData } from "../../../lib/data.js";
import { teamCalendar } from "../../../lib/ics.js";
import { setLang } from "../../../lib/i18n.js";

export const getStaticPaths = teamPaths;
export function GET({ props, site }) {
  setLang("it");
  const body = teamCalendar({ site: String(site).replace(/\/$/, ""), league: props.league, team: props.team, turno: leagueData(props.league).turno });
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}
