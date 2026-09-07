import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the operator purge dashboard (#401, #404).
 *
 * The supertest in artifacts/api-server only proves the HTML/JS is served
 * with the right shape. This spec drives the page in a real browser:
 *  - authenticates against the operator-key Basic gate,
 *  - stubs the JSON endpoint the script fetches,
 *  - asserts rows render with the expected columns,
 *  - asserts a 0 `runsTrimmed` collapses to the em-dash placeholder while
 *    a non-zero value renders as a plain integer.
 *
 * Skipped automatically if OPERATOR_API_KEY is not set on the running
 * api-server (the dashboard returns 503 in that case).
 */

const OPERATOR_KEY = process.env.OPERATOR_API_KEY;

test.describe("Operator purge-runs dashboard", () => {
  test.skip(
    !OPERATOR_KEY,
    "Requires OPERATOR_API_KEY to be set on the running api-server",
  );

  // The dashboard route ignores the username and only checks the password
  // half of the Basic credentials. Any username is fine.
  test.use({
    httpCredentials: { username: "operator", password: OPERATOR_KEY ?? "" },
  });

  test("renders rows with zero `runsTrimmed` as a dash and non-zero as an integer", async ({
    page,
    baseURL,
  }) => {
    const dashboardUrl = new URL("/api/admin/dashboard", baseURL!).toString();

    // Intercept the JSON the page fetches after load so the rendered table
    // is deterministic regardless of dev-DB state. The stub mixes a
    // non-zero `runsTrimmed` (should render as "7") with a zero one
    // (should render as the em-dash placeholder).
    await page.route(
      "**/api/admin/outward-account-purge-runs**",
      async (route) => {
        const req = route.request();
        // Only stub the GET; let any POST (Run now) fall through.
        if (req.method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            runs: [
              {
                id: 101,
                ranAt: "2026-04-22T10:00:00.000Z",
                source: "scheduled",
                accountsRemoved: 3,
                connectionsRemoved: 2,
                runsTrimmed: 0,
                durationMs: 412,
                accountIds: [],
                connectionIds: [],
              },
              {
                id: 102,
                ranAt: "2026-04-22T11:30:00.000Z",
                source: "api",
                accountsRemoved: 1,
                connectionsRemoved: 0,
                runsTrimmed: 7,
                durationMs: 88,
                accountIds: [],
                connectionIds: [],
              },
            ],
          }),
        });
      },
    );

    await page.goto(dashboardUrl);

    // Confirm the page is the dashboard, not a 401/503 fallback.
    await expect(page).toHaveTitle(/Purge runs/);
    await expect(
      page.getByRole("heading", { name: /Outward-account purge runs/i }),
    ).toBeVisible();

    // The script flips the status line to "Loaded 2 runs." once the fetch
    // resolves and the table re-renders.
    await expect(page.locator("#status")).toHaveText(/Loaded 2 runs\./);

    // All seven column headers from #401 are present and labelled as the
    // script's data-key map expects.
    for (const header of [
      "Ran at",
      "Source",
      "Accounts",
      "Connections",
      "Trimmed",
      "Duration",
      "Run id",
    ]) {
      await expect(
        page.locator("thead th", { hasText: new RegExp(`^${header}$`) }),
      ).toBeVisible();
    }
    await expect(page.locator('thead th[data-key="runsTrimmed"]')).toHaveText(
      /Trimmed/,
    );

    const rows = page.locator("#rows tr.expandable");
    await expect(rows).toHaveCount(2);

    // Default sort is `ranAt desc`, so the 11:30 run (#102, runsTrimmed=7)
    // comes first and the 10:00 run (#101, runsTrimmed=0) comes second.
    const firstCells = rows.nth(0).locator("td");
    await expect(firstCells.nth(6)).toHaveText("#102");
    await expect(firstCells.nth(4)).toHaveText("7");

    const secondCells = rows.nth(1).locator("td");
    await expect(secondCells.nth(6)).toHaveText("#101");
    // The zero-trim row renders the em-dash placeholder via fmtTrimmed,
    // not a literal "0".
    await expect(secondCells.nth(4)).toHaveText("\u2014");
    await expect(secondCells.nth(4).locator("span")).toHaveCount(1);
    await expect(secondCells.nth(4)).not.toHaveText(/^0$/);

    // Source badges round-trip from the JSON `source` field.
    await expect(firstCells.nth(1)).toHaveText("api");
    await expect(secondCells.nth(1)).toHaveText("scheduled");
  });
});
