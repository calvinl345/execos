import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: "build-web" }),
    files: {
      assets: "src/web/static",
      hooks: {
        client: "src/web/hooks.client",
        server: "src/web/hooks.server",
      },
      lib: "src/web/lib",
      params: "src/web/params",
      routes: "src/web/routes",
      serviceWorker: "src/web/service-worker",
      appTemplate: "src/web/app.html",
    },
    outDir: ".svelte-kit",
    typescript: {
      config: (config) => {
        config.include = config.include ?? [];
        return config;
      },
    },
  },
  compilerOptions: {
    runes: true,
  },
};

export default config;
