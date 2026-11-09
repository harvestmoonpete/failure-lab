import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

test("real services support investigation, evidence export, replay, and PDF output", async ({
  page,
  request,
}) => {
  expect((await request.post("/api/reset")).ok()).toBe(true);
  await page.goto("./");
  await expect(
    page.getByText("Snapshot connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run recovery challenge" }).click();
  const challenge = page.getByRole("region", {
    name: "Recover an invoice without stopping the batch.",
  });
  await expect(challenge.getByRole("status")).toContainText(
    "Partial failure confirmed",
    { timeout: 30000 },
  );
  await expect(page.locator(".badge.delivered")).toHaveCount(3);
  const failedRow = page.getByRole("row").filter({ hasText: "Needs replay" });
  await failedRow.getByRole("button").press("Enter");
  const inspector = page.locator(".inspector");
  const invoiceId = await inspector
    .getByRole("heading", { level: 2 })
    .innerText();
  await expect(inspector.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(inspector.getByRole("list")).toContainText("attempt 3");
  const pendingDownload = page.waitForEvent("download");
  await inspector.getByRole("button", { name: /Export evidence/ }).click();
  const download = await pendingDownload;
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.mode).toBe("local-services");
  expect(report.invoice.id).toBe(invoiceId);
  expect(report.invoice.stage).toBe("dead");
  expect(
    report.events.every(
      (event: { job_id: string }) => event.job_id === invoiceId,
    ),
  ).toBe(true);
  await challenge
    .getByRole("button", { name: "Replay challenge invoice" })
    .click();
  await expect(challenge.getByRole("status")).toContainText(
    "Challenge complete",
    { timeout: 30000 },
  );
  await expect(page.locator(".badge.delivered")).toHaveCount(4);
  await expect(inspector.getByRole("list")).toContainText("Manual replay");
  const pdfUrl = await inspector
    .getByRole("link", { name: /Open generated PDF/ })
    .getAttribute("href");
  const pdf = await request.get(pdfUrl!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
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
  // A transient polling failure must keep evidence visible and recover automatically.
  await page.route("**/api/snapshot", (route) => route.abort());
  await expect(page.getByRole("alert")).toContainText("Unable to refresh", {
    timeout: 10000,
  });
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await page.unroute("**/api/snapshot");
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 10000 });
  await page.getByRole("button", { name: "Reset lab" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
