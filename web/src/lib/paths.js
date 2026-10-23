/* Percorsi statici delle pagine di ogni campionato (getStaticPaths di Astro). */
import { LEAGUES } from "./core.js";
export const leaguePaths = () => LEAGUES.map((l) => ({ params: { lega: l.slug }, props: { league: l.code } }));
