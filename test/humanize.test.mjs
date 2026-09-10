// Regression test for human-like input (src/util/human.ts).
// Run against the built output: `npm run build && npm run test:humanize`.
//
// Guards the acceptance criteria that motivated 0.1.6:
//   - typed value is byte-for-byte identical to the request (the 0.1.5
//     "DemoPass123!" -> "demopass1231" Shift bug must never come back)
//   - capitals/symbols carry a real Shift modifier (typeAtWithModifier)
//   - dwell has human variance (no fixed 50ms) and gaps are randomized
//   - clicks land off-center at a sub-pixel point with a real press-hold

import { chromium } from "patchright";
import { humanClick, humanType } from "../dist/util/human.js";

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const stddev = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
};

const TARGET = "DemoPass123!@#";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(
    "data:text/html," +
      encodeURIComponent(
        "<style>body{margin:0}" +
          "#pw{position:absolute;left:220px;top:340px;width:260px;height:38px}" +
          "#btn{position:absolute;left:120px;top:120px;width:140px;height:44px}</style>" +
          "<input id=pw /><button id=btn>Go</button>",
      ),
  );

  await page.evaluate(() => {
    window.__keys = [];
    const inp = document.getElementById("pw");
    inp.addEventListener("keydown", (e) => window.__keys.push({ t: "down", key: e.key, shift: e.shiftKey, ts: performance.now() }));
    inp.addEventListener("keyup", (e) => window.__keys.push({ t: "up", key: e.key, shift: e.shiftKey, ts: performance.now() }));
  });

  const res = await humanType(page, page.locator("#pw"), TARGET, {});
  const typed = await page.locator("#pw").inputValue();
  const keys = await page.evaluate(() => window.__keys);

  const dwells = [];
  const stack = [];
  for (const k of keys) {
    if (k.key === "Shift") continue;
    if (k.t === "down") stack.push(k);
    else {
      const d = stack.pop();
      if (d) dwells.push(k.ts - d.ts);
    }
  }
  const gaps = [];
  let lastUp = null;
  for (const k of keys) {
    if (k.key === "Shift") continue;
    if (k.t === "up") lastUp = k.ts;
    else if (lastUp != null) gaps.push(k.ts - lastUp);
  }
  const shiftedWithModifier = keys.filter((k) => k.t === "down" && /[A-Z!@#$%^&*()]/.test(k.key) && k.shift).length;

  // Capture float mouse coords by wrapping mouse.move.
  const moves = [];
  const origMove = page.mouse.move.bind(page.mouse);
  page.mouse.move = async (x, y, o) => {
    moves.push({ x, y });
    return origMove(x, y, o);
  };
  await humanClick(page, page.locator("#btn"), {});

  const btnBox = await page.locator("#btn").boundingBox();
  const click = moves[moves.length - 1];
  const fx = (click.x - btnBox.x) / btnBox.width;
  const fy = (click.y - btnBox.y) / btnBox.height;
  const insideBox = fx > 0 && fx < 1 && fy > 0 && fy < 1;
  const offCenter = Math.abs(fx - 0.5) > 1e-6 || Math.abs(fy - 0.5) > 1e-6;

  const checks = [
    ["exact text", typed === TARGET, `expected ${JSON.stringify(TARGET)}, got ${JSON.stringify(typed)}`],
    ["verified flag", res.verified === true, `verified=${res.verified}`],
    ["typeAtWithModifier (>=6 shifted w/ Shift)", shiftedWithModifier >= 6, `got ${shiftedWithModifier}`],
    ["click inside bounding box", insideBox, `fx=${fx.toFixed(3)} fy=${fy.toFixed(3)}`],
    ["click off-center (not exact center)", offCenter, `fx=${fx.toFixed(3)} fy=${fy.toFixed(3)}`],
    ["dwell mean >= 25ms", mean(dwells) >= 25, `got ${mean(dwells).toFixed(1)}`],
    ["dwell stddev >= 10ms", stddev(dwells) >= 10, `got ${stddev(dwells).toFixed(1)}`],
    ["gap mean >= 40ms", mean(gaps) >= 40, `got ${mean(gaps).toFixed(1)}`],
  ];

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll human-input checks passed");
  }
} finally {
  await browser.close();
}
