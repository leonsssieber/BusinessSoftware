import { defineConfig } from "vite";
import { defineAppConfig } from "../../core/build/vite.ts";

export default defineConfig(defineAppConfig({ app: "quoterunner", devPort: 5101, apiPort: 8101 }));
