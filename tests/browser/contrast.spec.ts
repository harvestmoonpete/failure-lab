import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkContrast(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(result.violations.map(v => ({ rule: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('contrast remains readable through failure and recovery', async ({ page }) => {
  await page.goto('./');
  await checkContrast(page);
  await page.getByRole('button', { name: /Renderer outage/ }).click();
  await page.getByRole('button', { name: /Process batch/ }).click();
  await expect(page.getByRole('button', { name: /Replay/ })).toBeVisible({ timeout: 20000 });
  await checkContrast(page);
  await page.getByRole('button', { name: /Replay/ }).click();
  await expect(page.locator('.badge.delivered')).toHaveCount(4, { timeout: 20000 });
  await checkContrast(page);
});
