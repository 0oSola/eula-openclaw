import { expect, test } from "@playwright/test";

test("core routes render without document 5xx, page errors, or console errors @critical", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const documentFailures: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") {
      return;
    }
    if (response.status() >= 500) {
      documentFailures.push(`${response.request().method()} ${response.url()} :: HTTP ${response.status()}`);
    }
  });

  await page.goto("/");
  await expect(page.locator("form")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(1);

  await page.goto("/traces");
  await expect(page.locator('a[href="/"]').first()).toBeVisible();

  await testInfo.attach("route-console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-page-errors", {
    body: pageErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-document-failures", {
    body: documentFailures.join("\n"),
    contentType: "text/plain",
  });

  expect(documentFailures, `Document failures:\n${documentFailures.join("\n")}`).toHaveLength(0);
  expect(pageErrors, `Page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});
