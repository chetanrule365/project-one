import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    watch: {
      // Job/cache JSON rewrites must not remount the page or the live
      // progress banner resets to the stale loader snapshot.
      ignored: ["**/node_modules/**", "**/.git/**", "**/data/**"],
    },
  },
});
