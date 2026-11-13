import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = "/trivia-party/";

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png"],
      manifest: {
        name: "מסיבת טריוויה",
        short_name: "טריוויה",
        description: "משחק טריוויה מרובה משתתפים חי לחדר מלא בחברים",
        lang: "he",
        dir: "rtl",
        theme_color: "#16181d",
        background_color: "#16181d",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
      },
    }),
  ],
});
