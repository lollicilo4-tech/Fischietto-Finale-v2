/* Team calendar (.ics) in English (src/lib/ics.js): /en/calendar/premier-league/arsenal.ics. */
import { teamPaths } from "../../../../lib/paths.js";
import { leagueData } from "../../../../lib/data.js";
import { teamCalendar } from "../../../../lib/ics.js";
import { setLang } from "../../../../lib/i18n.js";

export const getStaticPaths = teamPaths;
export function GET({ props, site }) {
  setLang("en");
  const body = teamCalendar({ site: String(site).replace(/\/$/, ""), league: props.league, team: props.team, turno: leagueData(props.league).turno });
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}
