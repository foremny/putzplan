// Renders the card in headless Chrome with a mock Home Assistant connection and
// writes PNGs to docs/screenshots/. The demo plan in tests/fixtures/demo_plan.md
// is parsed by the integration's own Python parser, so the card gets exactly
// what the server would send.
//
// Run: cd tests/frontend && npm install && npm run screenshots
// Chrome path: CHROME_PATH env var, default is the macOS Google Chrome app.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CARD = `${ROOT}custom_components/cleaning_plan/frontend/cleaning-plan-card.js`;
const PLAN = `${ROOT}tests/fixtures/demo_plan.md`;
const OUT = `${ROOT}docs/screenshots`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Parse the demo plan with the integration's parser
const parsed = JSON.parse(
  execFileSync(
    `${ROOT}.venv/bin/python`,
    [
      "-c",
      "import json, sys; sys.path.insert(0, sys.argv[1]);" +
        "from custom_components.cleaning_plan.plan import parse_plan;" +
        "p = parse_plan(open(sys.argv[2], encoding='utf-8').read());" +
        "assert not p.errors, p.errors; print(json.dumps({'plan': p.as_dict()}))",
      ROOT,
      PLAN,
    ],
    { encoding: "utf8" }
  )
);
const text = execFileSync("cat", [PLAN], { encoding: "utf8" });

// Visit 2 (20 Oct 2026) is today; some tasks are already done
const SNAPSHOT = {
  title: "Putzplan",
  text,
  plan: parsed.plan,
  today: "2026-10-20",
  current_visit: 2,
  missing: { Toilettenpapier: "2026-10-20T08:30:00+00:00" },
  problems: [
    {
      id: "demo1",
      date: "2026-10-20",
      floor: "Erdgeschoss",
      location: "Küche",
      task: "Mülleimer sauber machen",
      kind: "skipped",
      note: "Keine Müllbeutel mehr da",
      reported: "2026-10-20T09:10:00+00:00",
    },
  ],
  done: {
    "2026-10-06": [["Obergeschoss", "Schlafzimmer", "Unter der Matratze absaugen"]],
    "2026-10-20": [
      ["Erdgeschoss", "Küche", "Spüle und Ablage inkl. Armaturen"],
      ["Erdgeschoss", "Küche", "Herd inkl. Fliesenspiegel"],
      ["Erdgeschoss", "Küche", "Elektrogeräte abwischen"],
      ["Erdgeschoss", "Küche", "Kühlschrank innen"],
      ["Erdgeschoss", "Wohnzimmer", "Staub wischen: Fensterbänke, Tische, Schränke"],
      ["Erdgeschoss", "Wohnzimmer", "Saugen / wischen"],
      ["Erdgeschoss", "Wohnzimmer", "Lichtschalter abwischen"],
      ["Keller", "Wäschekeller", "Aufräumen"],
      ["Keller", "Wäschekeller", "Staub auf Trockner und Regalen"],
      ["Keller", "Wäschekeller", "Flusensieb reinigen"],
    ],
  },
};

// Home Assistant's default light theme, and a minimal <ha-card>
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root {
    --primary-color: #03a9f4; --rgb-primary-color: 3, 169, 244;
    --primary-text-color: #212121; --secondary-text-color: #727272; --text-primary-color: #fff;
    --divider-color: rgba(0, 0, 0, 0.12); --card-background-color: #fff;
    --secondary-background-color: #e5e5e5; --primary-background-color: #fafafa;
    --success-color: #43a047; --error-color: #db4437;
  }
  body { margin: 0; padding: 24px; background: var(--primary-background-color);
         font-family: Roboto, -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 14px;
         -webkit-font-smoothing: antialiased; }
</style><script>
  customElements.define("ha-card", class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML =
        "<style>:host{display:block;background:var(--card-background-color);border-radius:12px;" +
        "border:1px solid #e0e0e0;color:var(--primary-text-color)}</style><slot></slot>";
    }
  });
</script></head><body><div id="root"></div></body></html>`;

async function mount(page, config) {
  await page.evaluate(
    ({ config, snapshot }) => {
      const card = document.createElement("cleaning-plan-visit-card");
      card.setConfig({ entry_id: "demo", ...config });
      document.getElementById("root").replaceChildren(card);
      card.hass = {
        locale: { language: "de", date_format: "language" },
        callWS: async (msg) =>
          msg.type === "cleaning_plan/validate" ? { errors: [], plan: snapshot.plan } : { saved: true, errors: [] },
        connection: {
          subscribeMessage: async (cb) => {
            setTimeout(() => cb(snapshot), 0);
            return async () => {};
          },
        },
      };
    },
    { config, snapshot: SNAPSHOT }
  );
  await page.waitForFunction(() =>
    document.querySelector("cleaning-plan-visit-card")?.shadowRoot?.querySelector(".head")
  );
}

// Clicks elements inside the card's shadow root
const click = (page, selector, index = 0) =>
  page.evaluate(
    ({ selector, index }) => {
      const els = document.querySelector("cleaning-plan-visit-card").shadowRoot.querySelectorAll(selector);
      els[index].click();
    },
    { selector, index }
  );

// The list opens fully folded; open the ground and upper floor
const openFloors = async (page) => {
  await click(page, '[data-act="ffold"]', 0);
  await click(page, '[data-act="ffold"]', 1);
};

async function shot(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(400); // transitions and debounced validation
  await page.locator("cleaning-plan-visit-card").screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 2, locale: "de-DE" });
await page.setContent(PAGE);
await page.addScriptTag({ path: CARD });
console.log(`Writing to ${OUT}`);

// 1. Household view: floors, some rooms opened
await mount(page, {});
await page.setViewportSize({ width: 1200, height: 900 });
await openFloors(page);
await click(page, '[data-act="fold"]', 0); // Küche
await click(page, '[data-act="fold"]', 2); // Gästebad
await click(page, '[data-act="fold"]', 4); // OG Bad
await shot(page, "household", 1200);

// 2. Cleaner view on a tablet: no dates, no editing
await mount(page, { allow_edit: false });
await openFloors(page);
await click(page, '[data-act="fold"]', 2); // Gästebad
await click(page, '[data-act="fold"]', 4); // OG Bad
await shot(page, "cleaner", 820);

// 2b. Cleaner reports a problem on a task
await mount(page, { allow_edit: false });
await openFloors(page);
await click(page, '[data-act="fold"]', 2); // Gästebad
await click(page, '.flag[data-task="Toilettenpapier auffüllen"]');
await click(page, '[data-act="p-kind"][data-kind="issue"]');
await page.evaluate(() => {
  const input = document.querySelector("cleaning-plan-visit-card").shadowRoot.querySelector("[data-pnote]");
  input.value = "Halter ist abgebrochen";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await shot(page, "cleaner-report", 820);

// 3. Schedule overview
await mount(page, {});
await click(page, '[data-act="overview"]');
await shot(page, "overview", 1100);

// 4. Editor: form with an opened room
await mount(page, {});
await click(page, '[data-act="edit"]');
await click(page, '[data-act="f-floor-fold"]', 2); // fold Keller
await click(page, '[data-act="f-fold"]', 0); // open Küche
await shot(page, "editor-form", 960);

// 5. Editor: overview tab with tap-to-move
await click(page, '[data-act="mode"][data-mode="overview"]');
await shot(page, "editor-overview", 1100);

// 6. Editor: Markdown text
await click(page, '[data-act="mode"][data-mode="text"]');
await shot(page, "editor-text", 960);

await browser.close();
