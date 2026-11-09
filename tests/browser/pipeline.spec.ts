import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("connected invoice lanes expose logs, animate pending work, and recover without redoing healthy lanes", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.goto("./");
  await page.getByRole("button", { name: "Run recovery challenge" }).click();
  const graph = page.getByRole("region", { name: "Execution pipeline" });
  const node = (invoice: string, stage: string) =>
    graph.getByRole("button", { name: new RegExp(`${invoice} · ${stage}:`) });
  await expect(node("INV-0001", "Validate invoice")).toContainText(
    "In progress",
  );
  await expect(graph.locator(".thinking-dots")).toHaveCount(4);
  await expect(graph.locator(".thinking-dots i").first()).toHaveCSS(
    "animation-name",
    "pipeline-thinking",
  );
  await graph.getByRole("button", { name: "Pause animation" }).click();
  await expect(graph.locator(".thinking-dots i").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.clock.runFor(2400);
  await expect(node("INV-0001", "Validate invoice")).toContainText("Passed");
  await expect(node("INV-0001", "Generate PDF")).toContainText("In progress");
  await page.clock.runFor(2400);
  await expect(node("INV-0001", "Generate PDF")).toContainText(
    "Retrying · 1/3",
  );
  await node("INV-0001", "Generate PDF").press("Enter");
  const log = graph.getByRole("region", { name: "Selected stage log" });
  await expect(log.getByRole("list")).toContainText("Renderer unavailable");
  await expect(log.getByRole("list")).not.toContainText("Accepted");
  await page.clock.runFor(4800);
  await expect(node("INV-0001", "Generate PDF")).toContainText("Failed · 3/3");
  await expect(node("INV-0001", "Record delivery")).toContainText("Blocked");
  await expect(node("INV-0002", "Record delivery")).toContainText("Passed");
  await expect(graph.locator(".thinking-dots")).toHaveCount(0);
  await expect(log.getByRole("list")).toContainText("Retries exhausted");
  await page.getByRole("button", { name: "Replay challenge invoice" }).click();
  await expect(node("INV-0001", "Generate PDF")).toContainText("In progress");
  await graph.getByRole("button", { name: "Resume animation" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(graph.locator(".thinking-dots i").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.clock.runFor(4800);
  await expect(node("INV-0001", "Record delivery")).toContainText("Passed");
  await expect(graph.locator(".thinking-dots")).toHaveCount(0);
  await expect(log.getByRole("list")).toContainText("Manual replay");
  await node("INV-0002", "Record delivery").press("Enter");
  await expect(log.getByRole("list")).toContainText("delivered");
  await expect(log.getByRole("list")).not.toContainText("Manual replay");
  await page.clock.resume();
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
  await page.getByRole("button", { name: "Reset lab" }).click();
  await expect(graph.getByText("No runs yet", { exact: true })).toBeVisible();
  await expect(
    graph.getByRole("region", { name: "Selected stage log" }),
  ).toHaveCount(0);
});
