// Regression test for QA finding B-6: browser_evaluate silently ignored
// frameSelector — it accepted the parameter without error but always ran
// against the top-level page, never the iframe (confirmed live on a real
// cross-origin TenDI/MidasRC captcha widget: reading location.href with
// frameSelector set returned the PARENT page's URL, not the iframe's).
//
// This uses two real HTTP origins (127.0.0.1 on two different ports counts
// as cross-origin to the browser) so the child iframe is genuinely blocked
// from plain JS access (element.contentDocument === null) — the same
// Same-Origin Policy barrier the real captcha widget hits.
import { createServer } from "node:http";
import { BrowserManager } from "../dist/browser/manager.js";
import { handleTool } from "../dist/tools/handlers.js";

function readText(res) {
  return res?.content?.[0]?.text;
}

const results = [];
const check = (name, cond) => {
  results.push([name, cond]);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
};

const CHILD_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="marker" data-secret="inside-the-iframe">child frame</div></body></html>`;

function serveHtml(html) {
  return createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
}

const childServer = serveHtml(CHILD_PAGE);
await new Promise((resolve) => childServer.listen(0, "127.0.0.1", resolve));
const childPort = childServer.address().port;
const childUrl = `http://127.0.0.1:${childPort}/`;

const parentServer = serveHtml(`<!doctype html><html><head><meta charset="utf-8"></head>
<body>
  <div id="marker" data-secret="in-the-parent">parent frame</div>
  <iframe id="child" src="${childUrl}"></iframe>
</body></html>`);
await new Promise((resolve) => parentServer.listen(0, "127.0.0.1", resolve));
const parentPort = parentServer.address().port;
const parentUrl = `http://127.0.0.1:${parentPort}/`;

const mgr = new BrowserManager();
try {
  await handleTool(mgr, "browser_start", { headless: true });
  await handleTool(mgr, "browser_navigate", { url: parentUrl });
  await handleTool(mgr, "browser_wait_for", { timeout: 500 });

  // Sanity check: the child iframe is genuinely cross-origin (different
  // port = different origin) and plain JS cannot reach into it.
  const crossOriginBlocked = readText(await handleTool(mgr, "browser_evaluate", {
    expression: "(() => { try { return document.querySelector('#child').contentDocument === null; } catch (e) { return true; } })()",
  }));
  check("child iframe is genuinely cross-origin (plain JS blocked)", crossOriginBlocked === "true");

  // Without frameSelector: evaluate must run in the top-level page.
  const topLevel = readText(await handleTool(mgr, "browser_evaluate", {
    expression: "document.querySelector('#marker').dataset.secret",
  }));
  check("without frameSelector, evaluate runs in the parent page", topLevel === "in-the-parent");

  // With frameSelector: evaluate must run INSIDE the cross-origin iframe,
  // not silently stay in the parent (the bug this test guards against).
  const insideFrame = readText(await handleTool(mgr, "browser_evaluate", {
    expression: "document.querySelector('#marker').dataset.secret",
    frameSelector: "#child",
  }));
  check("with frameSelector, evaluate runs inside the cross-origin iframe", insideFrame === "inside-the-iframe");

  // location.href inside the frame must be the CHILD origin, not the parent's
  // — this is the exact assertion that caught the bug live (location.href
  // returned the parent's URL despite frameSelector being set).
  const hrefInFrame = readText(await handleTool(mgr, "browser_evaluate", {
    expression: "location.href",
    frameSelector: "#child",
  }));
  check("location.href inside frameSelector is the iframe's own URL", hrefInFrame === childUrl);

  // An unresolvable frameSelector should fail clearly, not silently fall
  // back to the top-level page.
  let threw = false;
  try {
    await handleTool(mgr, "browser_evaluate", {
      expression: "1+1",
      frameSelector: "#does-not-exist",
    });
  } catch {
    threw = true;
  }
  check("an unresolvable frameSelector throws instead of silently using the top page", threw);
} finally {
  await handleTool(mgr, "browser_close", {}).catch(() => {});
  childServer.close();
  parentServer.close();
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nevaluate-frame-selector test FAILED (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nAll evaluate-frame-selector checks passed (${results.length})`);
