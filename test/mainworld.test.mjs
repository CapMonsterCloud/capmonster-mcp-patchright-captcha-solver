// Regression test for the world:"main" fix (and the -32602 undefined-result fix).
//
// Patchright runs page.evaluate in an isolated stealth world by default, so
// globals a page defines in its own inline <script> are NOT visible. This fork
// adds world:"main" to browser_evaluate / browser_run_code_unsafe to run in the
// page's real world, so code that needs the page's own window globals (e.g. a
// page-registered callback) can reach and call them.
//
// Self-contained: serves a tiny local page defining a main-world global + a
// callback, over an ephemeral localhost server. No network access needed.
import { createServer } from "node:http";
import { BrowserManager } from "../dist/browser/manager.js";
import { handleTool } from "../dist/tools/handlers.js";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>mw</title>
<script>
  // These live in the page's MAIN world only.
  var pageGlobalVar = "hello-main-world";
  window.pageCallback = function (payload) {
    window.__callbackResult = payload && payload.ok ? "called:" + payload.ok : "called";
    return "ok";
  };
</script></head><body>main-world test</body></html>`;

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

  const probe = "JSON.stringify({v: typeof pageGlobalVar, cb: typeof window.pageCallback})";

  const isolated = readText(await handleTool(mgr, "browser_evaluate", { expression: probe }));
  const main = readText(await handleTool(mgr, "browser_evaluate", { expression: probe, world: "main" }));

  // The page globals must be hidden in isolated (stealth default) ...
  check("isolated world hides page globals", /"v":"undefined"/.test(isolated) && /"cb":"undefined"/.test(isolated));
  // ... and visible in main.
  check("main world sees page var", /"v":"string"/.test(main));
  check("main world sees page callback", /"cb":"function"/.test(main));

  // Calling the page-registered callback must succeed in main world.
  const invoked = readText(await handleTool(mgr, "browser_evaluate", {
    expression: '(function(){ window.pageCallback({ok:"yes"}); return window.__callbackResult; })()',
    world: "main",
  }));
  check("main world can call page callback", invoked === "called:yes");

  // browser_run_code_unsafe honors world:"main" too.
  const rcu = readText(await handleTool(mgr, "browser_run_code_unsafe", {
    script: "return typeof window.pageCallback;",
    world: "main",
  }));
  check("run_code_unsafe main world sees callback", rcu === '"function"' || rcu === "function");

  // The -32602 fix: an evaluate returning undefined must serialize, not throw.
  const undef = readText(await handleTool(mgr, "browser_evaluate", { expression: "void 0", world: "main" }));
  check("undefined result serializes to a string", undef === "undefined");
} finally {
  await handleTool(mgr, "browser_close", {}).catch(() => {});
  server.close();
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nmain-world test FAILED (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nAll main-world checks passed (${results.length})`);
