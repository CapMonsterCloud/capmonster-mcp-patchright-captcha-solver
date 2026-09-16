import assert from "node:assert/strict";
import { BrowserManager } from "../dist/browser/manager.js";

function fakePage(name, opener = null) {
  const listeners = new Map();
  return {
    name,
    isClosed: () => false,
    opener: async () => opener,
    on: (event, handler) => listeners.set(event, handler),
    url: () => `https://${name}.test/`,
    title: async () => name,
    listeners,
  };
}

const manager = new BrowserManager();
const first = fakePage("first");
const second = fakePage("second");
manager.context = { pages: () => [first, second] };
manager.activePage = first;
manager.pageOwners.set(first, "owner-a");
manager.pageOwners.set(second, "owner-a");
manager.activePages.set("owner-a", second);

await manager.runAsOwner("owner-a", async () => {
  assert.equal(await manager.getPage(), second, "getPage should return the owner's active page");
});

const popup = fakePage("popup", first);
await manager.registerPage(popup);
assert.equal(manager.pageOwners.get(popup), "owner-a", "popup should inherit its opener's owner");
assert.equal(manager.activePages.get("owner-a"), popup, "popup should become active for its owner");

let releaseOpener;
const delayedPopup = fakePage("delayed", first);
delayedPopup.opener = () => new Promise((resolve) => { releaseOpener = () => resolve(first); });
manager.context.pages = () => [first, second, popup, delayedPopup];
manager.queuePageRegistration(delayedPopup);
const pendingList = manager.runAsOwner("owner-a", () => manager.listPages());
releaseOpener();
assert.equal((await pendingList).some((page) => page.url.includes("delayed")), true);

manager._networkRequests = [
  { owner: "owner-a", id: "1", url: "https://a.test", method: "GET", type: "document", timestamp: 1, fromCache: false, headers: {} },
  { owner: "owner-b", id: "2", url: "https://b.test", method: "GET", type: "document", timestamp: 2, fromCache: false, headers: {} },
];
manager.nextNetworkRequestId = 10;
first.listeners.get("request")({
  url: () => "https://new.test",
  method: () => "GET",
  resourceType: () => "fetch",
  headers: () => ({}),
});
assert.equal(manager._networkRequests.at(-1).id, "10", "request IDs must not depend on array length");
manager._consoleMessages = [
  { owner: "owner-a", type: "log", text: "a", timestamp: 1 },
  { owner: "owner-b", type: "log", text: "b", timestamp: 2 },
];

await manager.runAsOwner("owner-a", async () => {
  assert.deepEqual(manager.getNetworkRequests().map((request) => request.id), ["1", "10"]);
  assert.deepEqual(manager.getConsoleMessages().map((message) => message.text), ["a"]);
  assert.equal("owner" in manager.getNetworkRequests()[0], false, "internal owner must not leak");
});

let routeHandler;
manager.context.route = async (_pattern, handler) => { routeHandler = handler; };
manager.context.unroute = async () => {};
await manager.runAsOwner("owner-a", async () => {
  await manager.addBlockRoute({ urlPattern: "**/*" });
  assert.equal(manager.listRoutes().length, 1);
});

let action;
const routeFor = (page) => ({
  request: () => ({ resourceType: () => "document", frame: () => ({ page: () => page }) }),
  abort: () => { action = "abort"; },
  fallback: () => { action = "fallback"; },
});
await routeHandler(routeFor(first));
assert.equal(action, "abort", "owner route should affect its own page");
await routeHandler(routeFor(fakePage("other")));
assert.equal(action, "fallback", "owner route should not affect another owner's page");

console.log("PASS owner page, popup, network, and console isolation");
