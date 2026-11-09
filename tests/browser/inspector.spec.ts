import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

test("inspect, compare, and export invoice evidence with keyboard access", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Run recovery challenge" }).click();
  await expect(page.locator(".badge.dead")).toHaveCount(1, { timeout: 20000 });
  await page
    .getByRole("region", { name: "Invoices", exact: true })
    .getByRole("button", { name: "INV-0001" })
    .press("Enter");
  const inspector = page.getByRole("region", { name: "INV-0001" });
  await expect(
    inspector.getByRole("heading", { name: "INV-0001" }),
  ).toBeFocused();
  await expect(
    inspector.getByRole("list", { name: "Invoice event timeline" }),
  ).toContainText("Retries exhausted");
  await expect(
    inspector.getByText("Renderer unavailable", { exact: false }),
  ).toHaveCount(3);
  const downloadPending = page.waitForEvent("download");
  await inspector.getByRole("button", { name: /Export evidence/ }).click();
  const download = await downloadPending;
  expect(download.suggestedFilename()).toBe("failure-lab-INV-0001.json");
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.mode).toBe("browser-simulation");
  expect(report.invoice.stage).toBe("dead");
  expect(
    report.events.every(
      (event: { job_id: string }) => event.job_id === "INV-0001",
    ),
  ).toBe(true);
  expect(
    report.events.some((event: { message: string }) =>
      event.message.includes("Retries exhausted"),
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "Invoices", exact: true })
    .getByRole("button", { name: "INV-0002" })
    .press("Enter");
  const healthy = page.getByRole("region", { name: "INV-0002" });
  await expect(
    healthy.getByRole("heading", { name: "INV-0002" }),
  ).toBeFocused();
  await expect(healthy.getByRole("list")).not.toContainText(
    "Renderer unavailable",
  );
  await expect(healthy.getByRole("list")).toContainText("delivered");
  await expect(
    healthy.getByRole("link", { name: /Open sample PDF/ }),
  ).toHaveAttribute("href", "/failure-lab/sample.pdf");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Under the hood" }).click();
  await expect(
    page.getByRole("heading", { name: "Run the real pipeline" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "The lab", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
});
