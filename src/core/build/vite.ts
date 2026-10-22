import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin, UserConfig } from "vite";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Serves app.html for client-side routes in development (the landing page stays at /), and
 * folder pages such as /tools/rfq-builder from their own index.html.
 */
function spaFallback(webDir: string): Plugin {
  return {
    name: "studio-spa-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const path = url.split("?")[0];
        const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
        if (path !== "/" && !/\.[a-z0-9]+$/i.test(path) && existsSync(join(webDir, path, "index.html"))) {
          req.url = `${path.replace(/\/$/, "")}/index.html${query}`;
          return next();
        }
        const passthrough =
          path === "/" ||
          path.startsWith("/api") ||
          path.startsWith("/@") ||
          path.startsWith("/src") ||
          path.startsWith("/node_modules") ||
          /\.[a-z0-9]+$/i.test(path);
        if (!passthrough) req.url = `/app.html${query}`;
        next();
      });
    },
  };
}

/** Every index.html below `dir` (except src/ and public/), keyed by its folder path. */
function htmlPages(dir: string): Record<string, string> {
  const pages: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        if (name !== "src" && name !== "public" && name !== "node_modules") walk(full);
      } else if (name === "index.html" && d !== dir) {
        pages[relative(dir, d).replace(/[\\/]/g, "-")] = full;
      }
    }
  };
  walk(dir);
  return pages;
}

/** Shared Vite setup for a product: landing page (index.html), the React app (app.html) and folder pages. */
export function defineAppConfig(opts: { app: string; devPort: number; apiPort: number }): UserConfig {
  const webDir = resolve(root, "src/apps", opts.app, "web");
  return {
    root: webDir,
    appType: "mpa",
    publicDir: resolve(webDir, "public"),
    plugins: [react(), tailwindcss(), spaFallback(webDir)],
    resolve: {
      alias: {
        "@core": resolve(root, "src/core"),
        "@ui": resolve(root, "src/ui"),
      },
    },
    server: {
      port: opts.devPort,
      strictPort: true,
      proxy: { "/api": { target: `http://localhost:${opts.apiPort}`, changeOrigin: false } },
    },
    preview: { port: opts.devPort },
    build: {
      outDir: resolve(root, "dist", opts.app, "web"),
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          index: resolve(webDir, "index.html"),
          app: resolve(webDir, "app.html"),
          ...htmlPages(webDir),
        },
      },
    },
  };
}
