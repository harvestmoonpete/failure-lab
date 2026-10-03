import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5195/failure-lab/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build -- --base=/failure-lab/ && npx vite preview --host 127.0.0.1 --port 5195 --strictPort',
    url: 'http://127.0.0.1:5195/failure-lab/',
    reuseExistingServer: false,
  },
});
