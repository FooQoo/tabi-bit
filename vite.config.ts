import { sentryReactRouter } from "@sentry/react-router";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(config => ({
  plugins: [tailwindcss(), reactRouter(), sentryReactRouter({
    org: "fooqoo",
    project: "javascript-react-router",
    authToken: process.env.SENTRY_AUTH_TOKEN
  }, config)],

  resolve: {
    tsconfigPaths: true,
  },

  optimizeDeps: {
    exclude: ["@sentry/react-router"]
  }
}));
