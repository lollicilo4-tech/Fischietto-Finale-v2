/* Convertitore degli stili del sito attuale: deve toccare solo i selettori e mantenere la specificità. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptSelector, adaptCss } from "../scripts/import-legacy-css.mjs";

test("i pulsanti diventano anche link-pulsante, con la stessa specificità", () => {
  assert.equal(adaptSelector(".nav button"), ".nav :is(button,a:where(.ff-btn))");
  assert.equal(adaptSelector("button.tile:hover"), ":is(button,a:where(.ff-btn)).tile:hover");
  assert.equal(adaptSelector(".srcs a"), ".srcs a:not(:where(.ff-btn))");
  assert.equal(adaptSelector(".nav button[aria-selected=\"true\"]"), ".nav :is(button,a:where(.ff-btn)):is([aria-selected=\"true\"],[aria-current=\"page\"])");
  assert.equal(adaptSelector(".share-btn,.live-detail-toggle,.a-b,abbr"), ".share-btn,.live-detail-toggle,.a-b,abbr", "classi e altri tag non cambiano");
});

test("dichiarazioni, commenti e @media restano intatti", () => {
  const css = '/* button */ button{content:"a button"} @media(max-width:600px){ .x button{color:red} a{color:#fff} } @keyframes k{from{opacity:0}to{opacity:1}}';
  const out = adaptCss(css);
  assert.ok(out.includes('/* button */'));
  assert.ok(out.includes(':is(button,a:where(.ff-btn)){content:"a button"}'));
  assert.ok(out.includes(".x :is(button,a:where(.ff-btn)){color:red}"));
  assert.ok(out.includes("a:not(:where(.ff-btn)){color:#fff}"));
  assert.ok(out.includes("@keyframes k{from{opacity:0}to{opacity:1}}"));
});
