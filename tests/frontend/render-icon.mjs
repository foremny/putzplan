// Renders docs/brand/icon.svg into the integration's brand images.
// Home Assistant serves custom_components/cleaning_plan/brand/*.png in
// Settings > Devices & services; missing variants fall back to icon.png.
//
// Run: cd tests/frontend && npm run icon

import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SVG = readFileSync(`${ROOT}docs/brand/icon.svg`, "utf8");
const OUT = `${ROOT}custom_components/cleaning_plan/brand`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const [name, scale] of [
  ["icon.png", 1],
  ["icon@2x.png", 2],
]) {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:transparent">${SVG}</body></html>`);
  await page.locator("svg").screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  await page.close();
  console.log(`  ${name} (${256 * scale}x${256 * scale})`);
}
await browser.close();
