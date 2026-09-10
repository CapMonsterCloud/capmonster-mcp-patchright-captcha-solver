// Regression test for browser_save_blob.
//
// The whole point of this tool is that a large value computed in the page
// never has to pass through the MCP response text and back into another
// tool call's arguments by hand — it goes straight from the page to a file.
// This test proves round-trip correctness: generate a large, verifiable
// base64 blob inside the page, save it via the tool, then read the file back
// from disk and confirm it decodes to exactly the expected bytes.
import { readFile, rm } from "node:fs/promises";
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

const OUT_PATH = "./test-save-blob-output.bin";
const OUT_PATH_TEXT = "./test-save-blob-output.txt";

const mgr = new BrowserManager();
try {
  await handleTool(mgr, "browser_start", { headless: true });
  await handleTool(mgr, "browser_navigate", { url: "about:blank" });

  // A ~40KB deterministic base64 blob — comparable in size to the 9-image
  // bls_3x3 payload that got silently corrupted when hand-typed into
  // create_task's arguments.
  const genExpr = `(() => {
    const raw = new Uint8Array(30000);
    for (let i = 0; i < raw.length; i++) raw[i] = i % 256;
    let binary = "";
    for (const b of raw) binary += String.fromCharCode(b);
    return "data:application/octet-stream;base64," + btoa(binary);
  })()`;

  const saveRes = readText(await handleTool(mgr, "browser_save_blob", {
    expression: genExpr,
    path: OUT_PATH,
    encoding: "base64",
  }));
  const saveParsed = JSON.parse(saveRes);
  check("save reports ok", saveParsed.ok === true);
  check("save reports expected byte count", saveParsed.bytes === 30000);

  const written = await readFile(OUT_PATH);
  check("file has expected length", written.length === 30000);
  let bytesMatch = true;
  for (let i = 0; i < written.length; i++) {
    if (written[i] !== i % 256) { bytesMatch = false; break; }
  }
  check("file bytes match exactly (no corruption)", bytesMatch);

  // Text encoding path: non-base64 value written as UTF-8.
  const textRes = readText(await handleTool(mgr, "browser_save_blob", {
    expression: `"hello from the page"`,
    path: OUT_PATH_TEXT,
  }));
  check("text save reports ok", JSON.parse(textRes).ok === true);
  const textWritten = await readFile(OUT_PATH_TEXT, "utf-8");
  check("text file has exact content", textWritten === "hello from the page");

  // undefined result is rejected, not silently written as an empty/garbled file.
  const undefRes = readText(await handleTool(mgr, "browser_save_blob", {
    expression: "undefined",
    path: OUT_PATH_TEXT,
  }));
  check("undefined result is rejected with ok:false", JSON.parse(undefRes).ok === false);
} finally {
  await handleTool(mgr, "browser_close", {}).catch(() => {});
  await rm(OUT_PATH, { force: true });
  await rm(OUT_PATH_TEXT, { force: true });
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nsave-blob test FAILED (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nAll save-blob checks passed (${results.length})`);
