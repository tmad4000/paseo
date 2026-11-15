import { defineConfig, devices } from "playwright/test";

const websitePort = process.env.WEBSITE_TEST_PORT ?? "8187";
const registryPort = process.env.WEBSITE_REGISTRY_PORT ?? "8188";
const baseURL = process.env.WEBSITE_TEST_URL ?? `http://127.0.0.1:${websitePort}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL,
    launchOptions: { chromiumSandbox: true },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.WEBSITE_TEST_URL
    ? undefined
    : [
        {
          command: "node e2e/registry-server.mjs",
          url: `http://127.0.0.1:${registryPort}/index.json`,
          env: { WEBSITE_REGISTRY_PORT: registryPort },
        },
        {
          command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${websitePort} --strictPort`,
          url: baseURL,
          env: {
            CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
            PLUGINS_REGISTRY_URL: `http://127.0.0.1:${registryPort}`,
          },
        },
      ],
});
