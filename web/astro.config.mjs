// Configurazione del sito Astro di Fischietto finale.
// Sito completamente statico: Cloudflare Pages pubblica la cartella dist/ così com'è.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fischiettofinale.com",
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
    // Nessuno script inline: la Content Security Policy in public/_headers permette solo file del sito.
    inlineStylesheets: "never"
  },
  vite: {
    build: { assetsInlineLimit: 0 }
  },
  devToolbar: { enabled: false }
});
