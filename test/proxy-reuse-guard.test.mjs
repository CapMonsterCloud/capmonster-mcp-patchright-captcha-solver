// Regression test for QA finding B-3: browser_start silently reused the
// previous session's proxy (and other launch-only options) when called
// again on an already-running session, because Playwright bakes --proxy-server
// into the OS process command line at launch — a second start() call cannot
// retroactively change it. This confirms the fix: start() now throws a clear
// error instead of silently keeping the old value.
import { BrowserManager } from "../dist/browser/manager.js";
import { handleTool } from "../dist/tools/handlers.js";

const results = [];
const check = (name, cond) => {
  results.push([name, cond]);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
};

function readText(res) {
  return res?.content?.[0]?.text;
}

const mgr = new BrowserManager();
try {
  await handleTool(mgr, "browser_start", { headless: true });

  // Calling start() again with no options at all must remain a safe no-op —
  // this is the common "browser_navigate auto-starts" path and must not
  // regress into throwing on every second call.
  let noOptionsOk = true;
  try {
    await mgr.start({});
  } catch {
    noOptionsOk = false;
  }
  check("start() with no options on a running session stays a no-op", noOptionsOk);

  // Calling start() again with a genuinely new proxy must now throw instead
  // of silently keeping the old (or absent) proxy.
  let threw = false;
  let message = "";
  try {
    await mgr.start({ proxy: { server: "http://127.0.0.1:9" } });
  } catch (e) {
    threw = true;
    message = e.message;
  }
  check("start() with a new proxy on a running session throws", threw);
  check("error message names the conflicting option and the fix", /proxy/.test(message) && /browser_close/.test(message));

  // Same for userAgent — another launch-only option from the same class of bug.
  let uaThrew = false;
  try {
    await mgr.start({ userAgent: "some-different-ua" });
  } catch {
    uaThrew = true;
  }
  check("start() with a new userAgent on a running session throws", uaThrew);

  // headless:true (the value already in effect) must NOT throw — only a
  // genuine change should be flagged.
  let sameValueOk = true;
  try {
    await mgr.start({ headless: true });
  } catch {
    sameValueOk = false;
  }
  check("start() repeating the current headless value stays a no-op", sameValueOk);
} finally {
  await handleTool(mgr, "browser_close", {}).catch(() => {});
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nproxy-reuse-guard test FAILED (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nAll proxy-reuse-guard checks passed (${results.length})`);
