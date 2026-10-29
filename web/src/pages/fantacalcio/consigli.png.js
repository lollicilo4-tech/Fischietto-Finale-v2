/* Immagine dei consigli fantacalcio da pubblicare sui social (1080×1350), rigenerata a ogni build. */
import { pngResponse } from "../../lib/fantacard.js";
import { leagueData } from "../../lib/data.js";
export const GET = () => pngResponse("social", leagueData("SA").turno, leagueData("SA").classifica);
