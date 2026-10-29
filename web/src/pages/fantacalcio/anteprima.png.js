/* Anteprima del link /fantacalcio/ (og:image, 1200×630) per WhatsApp, Telegram e social. */
import { pngResponse } from "../../lib/fantacard.js";
import { leagueData } from "../../lib/data.js";
export const GET = () => pngResponse("preview", leagueData("SA").turno, leagueData("SA").classifica);
