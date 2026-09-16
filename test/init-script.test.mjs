// Regression test for browser_add_init_script.
//
// browser_evaluate/browser_run_code_unsafe are reactive: the MCP client must
// observe the page and decide to call them, which is always after the page's
// own inline <script> has already run. browser_add_init_script wraps
// Playwright's page.addInitScript, which the browser guarantees runs before
// any page script, on every navigation — so it can win a race an evaluate
// call never could.
//
// This test proves the ordering: the served page's inline <script> reads
// window.__trap synchronously at parse time and records what it saw. Without
// an init script, __trap is undefined when the page runs. With one installed
// first, the page observes the value the init script set.
import { createServer } from "node:http";
import { BrowserManager } from "../dist/browser/manager.js";
import { handleTool } from "../dist/tools/handlers.js";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>init</title>
<script>
  // Synchronous read at parse time — this is the race an init script must win.
  window.__observedAtParseTime = typeof window.__trap === "undefined" ? "missing" : window.__trap;
</script></head><body>init-script test</body></html>`;

function readText(res) {
  return res?.content?.[0]?.text;
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const results = [];
const check = (name, cond) => {
  results.push([name, cond]);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
};

const mgr = new BrowserManager();
try {
  await handleTool(mgr, "browser_start", { headless: true });
  await handleTool(mgr, "browser_navigate", { url });

  // window.__observedAtParseTime is set by the page's own inline <script>,
  // so it lives in the page's main world — read it with world:"main".
  const before = readText(await handleTool(mgr, "browser_evaluate", { expression: "window.__observedAtParseTime", world: "main" }));
  check("without init script, page sees no trap", before === "missing");

  const reg = readText(await handleTool(mgr, "browser_add_init_script", {
    function: "() => { window.__trap = 'set-by-init-script'; }",
  }));
  check("registering the init script succeeds", JSON.parse(reg).ok === true);

  // addInitScript only affects future navigations of this page — reload to trigger it.
  await handleTool(mgr, "browser_navigate", { url });
  const after = readText(await handleTool(mgr, "browser_evaluate", { expression: "window.__observedAtParseTime", world: "main" }));
  check("after init script, page observes it at parse time", after === "set-by-init-script");

  // Runs on every subsequent navigation too, not just the first.
  await handleTool(mgr, "browser_navigate", { url });
  const again = readText(await handleTool(mgr, "browser_evaluate", { expression: "window.__observedAtParseTime", world: "main" }));
  check("init script persists across repeated navigations", again === "set-by-init-script");
} finally {
  await handleTool(mgr, "browser_close", {}).catch(() => {});
  server.close();
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\ninit-script test FAILED (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nAll init-script checks passed (${results.length})`);
