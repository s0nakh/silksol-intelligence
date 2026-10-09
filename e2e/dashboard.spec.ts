import { expect, test, type Page } from "@playwright/test";

// E2E coverage of the corridor intelligence dashboard. Runs on the simulated telemetry replay,
// so the scenario (Aktau storm, Baku roadstead queue) is the same on every run.

const shipmentsTable = (page: Page) => page.getByTestId("shipments-table").locator("tbody");
const cargoRow = (page: Page, id: string) =>
  shipmentsTable(page).locator("tr", { hasText: `#${id}` });
const slaPanel = (page: Page) => page.locator(".panel", { hasText: "SLA violation monitor" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Corridor intelligence" })).toBeVisible();
  // The page is server-rendered; wait until React has hydrated it so clicks reach handlers.
  await page.waitForFunction(
    () => {
      const el = document.querySelector("[data-testid=shipments-table] tbody tr");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
    },
    undefined,
    { timeout: 60_000 },
  );
});

test.describe("Dashboard & telemetry", () => {
  test("renders disclaimer, KPIs, corridor route and the top bottleneck", async ({ page }) => {
    await expect(
      page.getByText(/Demo environment — shipments, metrics and feeds are simulated/),
    ).toBeVisible();
    await expect(page.getByText("Corridor telemetry", { exact: true })).toBeVisible();

    for (const label of [
      "Monitored containers",
      "Predictive risk index",
      "SLA violations",
      "Avg ETA drift",
    ]) {
      await expect(page.locator("article.metric-card", { hasText: label })).toBeVisible();
    }
    await expect(
      page.locator("article.metric-card", { hasText: "Monitored containers" }),
    ).toContainText("10");
    await expect(page.locator("article.metric-card", { hasText: "SLA violations" })).toContainText(
      "shipments affected: 1",
    );

    for (const stop of ["Lianyungang", "Khorgos", "Aktau Port", "Baku (Alat)", "Istanbul"]) {
      await expect(page.locator(".route-rail").getByText(stop, { exact: true })).toBeVisible();
    }
    await expect(page.locator(".map-event")).toContainText("Bottleneck · Aktau Port");
    await expect(page.locator(".map-event")).toContainText(
      /Storm closure: wind \d+\.\d m\/s > 15 m\/s/,
    );
  });

  test("shows Caspian port weather and AIS roadstead telemetry", async ({ page }) => {
    const weather = page.locator(".panel", { hasText: "Caspian hydrometeorology" });
    await expect(weather).toContainText("Port weather · Aktau Port");
    await expect(weather).toContainText("Closed");
    await expect(weather).toContainText(/\d+\.\d m\/s/);

    const ais = page.locator(".panel", { hasText: "Live vessel telemetry" });
    await expect(ais).toContainText("7 vessels");
    await expect(ais).toContainText(/\+\d+\.\d h over plan/);

    await weather.getByRole("button", { name: "Bottlenecks" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("bottleneck-aktau")).toContainText("High");
    await expect(dialog.getByTestId("bottleneck-baku")).toContainText(/Storm front in ~\d+ h/);
  });
});

test.describe("Shipment filters", () => {
  const cases: [filter: string, visible: string[]][] = [
    ["In transit", ["MCC-2048", "TRK-7782"]],
    ["High delay risk", ["JOL-8921"]],
    ["SLA breach", ["KZL-4107"]],
    ["All shipments", ["JOL-8921", "MCC-2048", "KZL-4107", "TRK-7782"]],
  ];

  for (const [filter, visible] of cases) {
    test(`"${filter}" isolates the matching shipments`, async ({ page }) => {
      await page.getByRole("button", { name: filter, exact: true }).click();
      await expect(shipmentsTable(page).locator("tr")).toHaveCount(visible.length);
      for (const id of visible) await expect(cargoRow(page, id)).toBeVisible();
    });
  }
});

test.describe("ML risk engine & SLA monitor", () => {
  test("predicts an SLA breach for the storm-bound cargo and explains the drivers", async ({
    page,
  }) => {
    const panel = slaPanel(page);
    await expect(panel.getByRole("heading", { name: "Dwell SLA · #JOL-8921" })).toBeVisible();
    await expect(panel.getByTestId("sla-status")).toContainText("Within SLA at Aktau Port");
    await expect(panel.getByTestId("sla-status")).toContainText(
      /Predicted: ~\d+ h at Aktau Port vs 48 h SLA/,
    );
    const model = panel.getByTestId("model-card");
    await expect(model).toContainText("0.1.0-baseline");
    await expect(model).toContainText("Weather severity");
  });

  test("selecting a cargo rebinds the SLA monitor and risk chart", async ({ page }) => {
    await cargoRow(page, "KZL-4107").click();
    await expect(slaPanel(page).getByTestId("sla-status")).toContainText(
      "SLA breached at Baku (Alat)",
    );
    await expect(slaPanel(page)).toContainText("Earlier violations on this route: Khorgos");
    await expect(
      page.getByRole("heading", { name: "Delay risk · Baku (Alat) · #KZL-4107" }),
    ).toBeVisible();
    await expect(page.locator(".panel", { hasText: "Live vessel telemetry" })).toContainText(
      "Caspian Meridian",
    );
  });
});

test.describe("Proof of delay", () => {
  test("generates, verifies and anchors a verifiable delay report", async ({ page }) => {
    await cargoRow(page, "KZL-4107").getByRole("button", { name: "Generate report" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: /Passport of delay · #KZL-4107/ }),
    ).toBeVisible();
    await expect(dialog).toContainText("storm port closure");
    await expect(dialog).toContainText("port queue");
    await expect(dialog).toContainText("Caspian Meridian");
    await expect(dialog).toContainText(/Report SHA-256/);

    await dialog.getByRole("button", { name: "Verify integrity" }).click();
    await expect(dialog.getByTestId("report-verification")).toContainText("Integrity verified");

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download JSON" }).click();
    expect((await download).suggestedFilename()).toMatch(/^POD-KZL-4107-\d+\.json$/);

    await page.keyboard.press("Escape");
    await expect(cargoRow(page, "KZL-4107")).toContainText("Issued");
    await expect(page.locator(".settlement-panel")).toContainText("Report issued");
  });

  test("audit trail chains every event with SHA-256 and verifies", async ({ page }) => {
    await page.getByRole("button", { name: /Audit Trail/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Cryptographic audit trail")).toBeVisible();
    await expect(drawer.getByTestId("ledger-root")).toHaveText(/^[0-9a-f]{64}$/);
    await expect(drawer.getByText("Port closed (weather)").first()).toBeVisible();
    await expect(drawer.getByText("Vessel anchored on roadstead")).toBeVisible();
    await drawer.getByRole("button", { name: "Re-verify all chains" }).click();
    await expect(page.getByText("All 4 chains verified")).toBeVisible();
  });
});

test.describe("Internationalisation", () => {
  test("switches EN → RU → KK and remembers the choice", async ({ page }) => {
    const switcher = page.getByRole("group", { name: "Interface language" });
    await switcher.getByRole("button", { name: "RU" }).click();
    await expect(page.getByRole("heading", { name: "Аналитика коридора" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("button", { name: "Нарушение SLA", exact: true })).toBeVisible();

    await page
      .getByRole("group", { name: "Язык интерфейса" })
      .getByRole("button", { name: "KK" })
      .click();
    await expect(page.getByRole("heading", { name: "Дәліз аналитикасы" })).toBeVisible();
    await expect(page.locator(".route-rail")).toContainText("Ақтау порты");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Дәліз аналитикасы" })).toBeVisible();
  });
});
