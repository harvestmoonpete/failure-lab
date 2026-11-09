import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
test("recovery challenge waits for partial failure and verifies replay", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Run recovery challenge" }).click();
  const challenge = page.getByRole("region", {
    name: "Recover an invoice without stopping the batch.",
  });
  await expect(
    challenge.getByRole("button", { name: "Replay challenge invoice" }),
  ).toBeDisabled();
  await expect(challenge.getByRole("status")).toContainText(
    "Partial failure confirmed",
    { timeout: 20000 },
  );
  await expect(page.locator(".badge.dead")).toHaveCount(1);
  await expect(page.locator(".badge.delivered")).toHaveCount(3);
  await challenge
    .getByRole("button", { name: "Replay challenge invoice" })
    .click();
  await expect(challenge.getByRole("status")).toContainText(
    "Challenge complete",
    { timeout: 20000 },
  );
  await expect(page.locator(".badge.delivered")).toHaveCount(4);
  await expect(
    challenge.getByRole("link", { name: "Open the sample PDF" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Reset lab/ }).click();
  await expect(
    page.getByRole("button", { name: "Run recovery challenge" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
