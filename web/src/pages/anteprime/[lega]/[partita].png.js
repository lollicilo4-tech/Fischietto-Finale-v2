/* Anteprima del link di ogni partita (/anteprime/<campionato>/<partita>.png, 1200×630): src/lib/matchcard.js. */
import { matchPaths } from "../../../lib/paths.js";
import { matchPngResponse } from "../../../lib/matchcard.js";
export const getStaticPaths = matchPaths;
export const GET = ({ props }) => matchPngResponse(props.league, props.match);
