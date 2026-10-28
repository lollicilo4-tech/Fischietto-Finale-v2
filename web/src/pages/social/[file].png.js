/* Immagini verticali per storie, Reels e TikTok (/social/<nome>.png, 1080×1920): src/lib/socialcard.js. */
import { buildSets, storyResponse } from "../../lib/socialcard.js";
export function getStaticPaths() {
  const { day, sets } = buildSets();
  return sets.map((set) => ({ params: { file: set.slug }, props: { set, day } }));
}
export const GET = ({ props }) => storyResponse(props.set, props.day);
