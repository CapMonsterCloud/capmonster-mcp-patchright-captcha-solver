import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  devices,
  firefox,
  type Page,
  type Route,
  webkit,
} from "patchright";
import { redactDataUrl, redactSecrets } from "../util/redact.js";

export type BrowserName = "chromium" | "firefox" | "webkit";
export type BrowserEngine = "patchright" | "cdp";

export interface StartOptions {
  browser?: BrowserName;
  headless?: boolean;
  width?: number;
  height?: number;
  userAgent?: string;
  userDataDir?: string;
  channel?: "chrome" | "chrome-beta" | "chrome-dev" | "chrome-canary" | "msedge";
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; username?: string; password?: string; bypass?: string };
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  colorScheme?: "light" | "dark" | "no-preference";
  device?: string;
  mobile?: boolean;
  cdpEndpoint?: string;
  recordVideo?: { dir?: string; width?: number; height?: number };
}

export interface RouteRule {
  id: string;
  kind: "block" | "mock";
  urlPattern: string;
  resourceTypes?: string[];
  status?: number;
}

export interface PageInfo {
  id: string;
  active: boolean;
  closed: boolean;
  url: string;
  title?: string;
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  type: string;
  timestamp: number;
  duration?: number;
  fromCache: boolean;
  headers: Record<string, string>;
}

type OwnedNetworkRequest = NetworkRequest & { owner?: string };
type OwnedConsoleMessage = ConsoleMessage & { owner?: string };

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

export interface BrowserStatus {
  running: boolean;
  engine: BrowserEngine;
  browser?: BrowserName;
  headless?: boolean;
  userDataDir?: string;
  persistent?: boolean;
  activePageId?: string;
  url?: string;
  title?: string;
  pages: number;
  recording?: boolean;
  videoDir?: string;
}

const DEFAULT_PROFILE_DIR = join(homedir(), ".maestro", "stealth-playwright-mcp", "profiles", "default");
const DEFAULT_VIDEO_DIR = join(homedir(), ".maestro", "stealth-playwright-mcp", "videos");
const ownerStorage = new AsyncLocalStorage<string | undefined>();

export class BrowserManager {
  constructor(private readonly defaultOptions: StartOptions = {}) {}

  private browser?: Browser;
  private context?: BrowserContext;
  private activePage?: Page;
  private activePages = new Map<string, Page>();
  private pageOwners = new WeakMap<Page, string>();
  private pageIds = new WeakMap<Page, string>();
  private trackedPages = new WeakSet<Page>();
  private nextPageId = 1;
  private nextRouteId = 1;
  private nextNetworkRequestId = 1;
  private pageRegistrations = new Set<Promise<void>>();
  private engine: BrowserEngine = "patchright";
  private options?: Required<Pick<StartOptions, "browser" | "headless" | "userDataDir">> & StartOptions;
  private startPromise?: Promise<Page>;
  private videoDir?: string;
  private _networkRequests: OwnedNetworkRequest[] = [];
  private _consoleMessages: OwnedConsoleMessage[] = [];
  private _routeRules: (RouteRule & { owner?: string; handler: (route: Route) => unknown })[] = [];

  runAsOwner<T>(owner: string | undefined, fn: () => Promise<T>): Promise<T> {
    return ownerStorage.run(owner, fn);
  }

  private currentOwner(): string | undefined {
    return ownerStorage.getStore();
  }

  private pageForOwner(owner = this.currentOwner()): Page | undefined {
    if (!owner) return undefined;
    return this.context?.pages().find(
      (page) => !page.isClosed() && this.pageOwners.get(page) === owner,
    );
  }

  private claimPage(page: Page, owner = this.currentOwner()): Page {
    if (!owner) return page;
    const existing = this.pageForOwner(owner);
    if (existing) return existing;
    const currentOwner = this.pageOwners.get(page);
    if (currentOwner && currentOwner !== owner) return page;
    this.pageOwners.set(page, owner);
    this.activePages.set(owner, page);
    return page;
  }

  private availablePage(): Page | undefined {
    return this.context?.pages().find(
      (page) => !page.isClosed() && !this.pageOwners.has(page),
    );
  }

  private ownerForRoute(route: Route): string | undefined {
    try {
      return this.pageOwners.get(route.request().frame().page());
    } catch {
      return undefined;
    }
  }

  private async registerPage(page: Page): Promise<void> {
    this.idFor(page);
    const opener = await page.opener().catch(() => null);
    const owner = opener ? this.pageOwners.get(opener) : undefined;
    if (owner) {
      this.pageOwners.set(page, owner);
      this.activePages.set(owner, page);
    }
    this.trackPage(page);
    this.activePage = page;
  }

  private queuePageRegistration(page: Page): void {
    const registration = this.registerPage(page);
    this.pageRegistrations.add(registration);
    void registration.finally(() => this.pageRegistrations.delete(registration));
  }

  private async waitForPageRegistrations(): Promise<void> {
    if (this.pageRegistrations.size) {
      await Promise.allSettled([...this.pageRegistrations]);
    }
  }

  // Options that only take effect at browser-launch time — changing any of
  // these on an already-running context is a silent no-op in Playwright
  // (the OS process was already spawned with the old values baked into its
  // command line, e.g. --proxy-server). Confirmed live: calling start()
  // again with a new `proxy` kept the old exit IP unchanged. Rather than
  // repeat that silently, start() now throws when one of these differs from
  // what the running session was actually launched with.
  private static readonly LAUNCH_ONLY_KEYS = [
    "browser", "headless", "userDataDir", "channel", "userAgent", "locale",
    "timezoneId", "proxy", "geolocation", "colorScheme", "device", "mobile",
    "cdpEndpoint",
  ] as const;

  private conflictingLaunchOptions(options: StartOptions): string[] {
    if (!this.options) return [];
    const conflicts: string[] = [];
    for (const key of BrowserManager.LAUNCH_ONLY_KEYS) {
      if (!(key in options)) continue;
      const incoming = (options as unknown as Record<string, unknown>)[key];
      const current = (this.options as unknown as Record<string, unknown>)[key];
      if (incoming !== undefined && JSON.stringify(incoming) !== JSON.stringify(current)) {
        conflicts.push(key);
      }
    }
    return conflicts;
  }

  async start(options: StartOptions = {}): Promise<Page> {
    const owner = this.currentOwner();
    const owned = this.pageForOwner(owner);
    const sessionAlreadyRunning = owned || (!owner && this.context && this.activePage && !this.activePage.isClosed());
    if (sessionAlreadyRunning) {
      const conflicts = this.conflictingLaunchOptions(options);
      if (conflicts.length) {
        throw new Error(
          `browser_start: a session is already running and cannot change ${conflicts.join(", ")} on it — ` +
          `these only take effect at launch time. Call browser_close first, then browser_start with the new options.`,
        );
      }
    }
    if (owned) return owned;
    if (!owner && this.context && this.activePage && !this.activePage.isClosed()) return this.activePage;
    if (this.startPromise) {
      await this.startPromise;
      return this.getPage();
    }

    this.startPromise = this.startFresh(options);
    try {
      await this.startPromise;
      return this.getPage();
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startFresh(options: StartOptions = {}): Promise<Page> {
    const startOptions = { ...this.defaultOptions, ...options };

    const browserName = startOptions.browser ?? "chromium";
    const headless = startOptions.headless ?? false;
    const userDataDir = startOptions.userDataDir ?? process.env.STEALTH_PLAYWRIGHT_USER_DATA_DIR ?? DEFAULT_PROFILE_DIR;
    const width = startOptions.width ?? 1280;
    const height = startOptions.height ?? 720;

    if (startOptions.cdpEndpoint) {
      this.browser = await chromium.connectOverCDP(startOptions.cdpEndpoint);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext({
        viewport: headless ? { width, height } : null,
        ...(startOptions.userAgent ? { userAgent: startOptions.userAgent } : {}),
        ...(startOptions.locale ? { locale: startOptions.locale } : {}),
        ...(startOptions.timezoneId ? { timezoneId: startOptions.timezoneId } : {}),
        ...(startOptions.geolocation ? { geolocation: startOptions.geolocation, permissions: ["geolocation"] } : {}),
        ...(startOptions.colorScheme ? { colorScheme: startOptions.colorScheme } : {}),
      }));
      this.engine = "cdp";
      this.videoDir = undefined; // recordVideo is unavailable over a CDP attach
      this.options = { ...startOptions, browser: browserName, headless, userDataDir };
      this.registerExistingPages();
      this.context.on("page", (page) => this.queuePageRegistration(page));
    this.activePage = this.context.pages().find((page) => !page.isClosed()) ?? (await this.context.newPage());
    this.idFor(this.activePage);
    return this.activePage;
  }

    await mkdir(userDataDir, { recursive: true });
    await this.removeSingletonFiles(userDataDir);

    this.videoDir = startOptions.recordVideo ? (startOptions.recordVideo.dir ?? DEFAULT_VIDEO_DIR) : undefined;
    if (this.videoDir) await mkdir(this.videoDir, { recursive: true });

    const device = startOptions.device && Object.hasOwn(devices, startOptions.device)
      ? devices[startOptions.device]
      : undefined;
    if (startOptions.device && !device) {
      throw new Error(`Unknown device: ${startOptions.device}. See Playwright device registry for valid names.`);
    }
    const mobile = startOptions.mobile ?? device?.isMobile;

    const launcher = browserName === "firefox" ? firefox : browserName === "webkit" ? webkit : chromium;
    this.context = await launcher.launchPersistentContext(userDataDir, {
      ...(browserName === "chromium" ? { channel: startOptions.channel ?? "chrome" } : {}),
      headless,
      // Device / mobile emulation needs a fixed viewport; otherwise keep the
      // headed window's own viewport (null) or an explicit headless size.
      viewport: device?.viewport ?? (mobile ? { width, height } : headless ? { width, height } : null),
      ...(device?.deviceScaleFactor ? { deviceScaleFactor: device.deviceScaleFactor } : {}),
      ...(mobile !== undefined ? { isMobile: mobile, hasTouch: device?.hasTouch ?? mobile } : {}),
      // Explicit userAgent wins over the device default.
      ...(startOptions.userAgent ? { userAgent: startOptions.userAgent } : device?.userAgent ? { userAgent: device.userAgent } : {}),
      ...(startOptions.locale ? { locale: startOptions.locale } : {}),
      ...(startOptions.timezoneId ? { timezoneId: startOptions.timezoneId } : {}),
      ...(startOptions.proxy ? { proxy: startOptions.proxy } : {}),
      ...(startOptions.geolocation ? { geolocation: startOptions.geolocation, permissions: ["geolocation"] } : {}),
      ...(startOptions.colorScheme ? { colorScheme: startOptions.colorScheme } : {}),
      ...(this.videoDir ? { recordVideo: { dir: this.videoDir, size: { width: startOptions.recordVideo?.width ?? width, height: startOptions.recordVideo?.height ?? height } } } : {}),
    });
    this.engine = "patchright";
    this.options = { ...startOptions, browser: browserName, headless, userDataDir };
    this.registerExistingPages();
    this.context.on("page", (page) => this.queuePageRegistration(page));
    this.activePage = this.context.pages()[0] ?? (await this.context.newPage());
    this.idFor(this.activePage);
    return this.activePage;
  }

  async getPage(): Promise<Page> {
    await this.waitForPageRegistrations();
    const owner = this.currentOwner();
    const active = owner ? this.activePages.get(owner) : undefined;
    if (active && !active.isClosed()) return active;
    const owned = this.pageForOwner(owner);
    if (owned) {
      if (owner) this.activePages.set(owner, owned);
      return owned;
    }
    if (!this.context || !this.activePage || this.activePage.isClosed()) {
      await this.start(this.options);
    }
    if (owner) {
      const page = this.availablePage() ?? (await this.context!.newPage());
      this.idFor(page);
      this.trackPage(page);
      return this.claimPage(page, owner);
    }
    return this.activePage!;
  }

  async newPage(url?: string): Promise<PageInfo> {
    if (!this.context) await this.start(this.options);
    if (!this.context) throw new Error("Browser context not available");
    const page = await this.context.newPage();
    this.activePage = page;
    this.idFor(page);
    this.trackPage(page);
    const owner = this.currentOwner();
    if (owner) {
      this.pageOwners.set(page, owner);
      this.activePages.set(owner, page);
    }
    if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return this.pageInfo(page);
  }

  async listPages(): Promise<PageInfo[]> {
    await this.waitForPageRegistrations();
    if (!this.context) return [];
    this.registerExistingPages();
    const owner = this.currentOwner();
    return Promise.all(
      this.context
        .pages()
        .filter((page) => !page.isClosed() && (!owner || this.pageOwners.get(page) === owner))
        .map((page) => this.pageInfo(page)),
    );
  }

  async switchPage(pageId: string): Promise<PageInfo> {
    const page = this.findPage(pageId);
    if (!page) throw new Error(`Unknown page id: ${pageId}`);
    this.activePage = page;
    const owner = this.currentOwner();
    if (owner) this.activePages.set(owner, page);
    await page.bringToFront().catch(() => undefined);
    return this.pageInfo(page);
  }

  async closePage(pageId?: string): Promise<PageInfo | { ok: true; closed: string | undefined }> {
    const page = pageId ? this.findPage(pageId) : await this.getPage();
    if (!page) throw new Error(`Unknown page id: ${pageId}`);
    const closedId = this.idFor(page);
    await page.close().catch(() => undefined);
    const owner = this.currentOwner();
    if (owner) {
      if (this.activePages.get(owner) === page) {
        const next = this.pageForOwner(owner);
        if (next) this.activePages.set(owner, next);
        else this.activePages.delete(owner);
      }
      const active = this.activePages.get(owner);
      return active && !active.isClosed() ? this.pageInfo(active) : { ok: true, closed: closedId };
    }
    if (this.activePage === page) this.activePage = this.context?.pages().find((candidate) => !candidate.isClosed());
    return this.activePage && !this.activePage.isClosed() ? this.pageInfo(this.activePage) : { ok: true, closed: closedId };
  }

  async closeOwnerPages(owner: string): Promise<number> {
    const pages = this.context?.pages().filter(
      (page) => !page.isClosed() && this.pageOwners.get(page) === owner,
    ) ?? [];
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    const routes = this._routeRules.filter((rule) => rule.owner === owner);
    for (const rule of routes) {
      await this.context?.unroute(rule.urlPattern, rule.handler).catch(() => undefined);
    }
    this._routeRules = this._routeRules.filter((rule) => rule.owner !== owner);
    this._networkRequests = this._networkRequests.filter((entry) => entry.owner !== owner);
    this._consoleMessages = this._consoleMessages.filter((entry) => entry.owner !== owner);
    this.activePages.delete(owner);
    if (this.activePage && pages.includes(this.activePage)) {
      this.activePage = this.context?.pages().find((page) => !page.isClosed());
    }
    return pages.length;
  }

  async status(): Promise<BrowserStatus> {
    await this.waitForPageRegistrations();
    const owner = this.currentOwner();
    const active = owner ? this.activePages.get(owner) ?? this.pageForOwner(owner) : this.activePage;
    const running = !!this.context && !!active && !active.isClosed();
    let title: string | undefined;
    let url: string | undefined;
    let activePageId: string | undefined;
    if (running && active) {
      url = active.url();
      title = await active.title().catch(() => undefined);
      activePageId = this.idFor(active);
    }
    return {
      running,
      engine: this.engine,
      browser: this.options?.browser,
      headless: this.options?.headless,
      userDataDir: this.options?.userDataDir,
      persistent: !!this.context,
      activePageId,
      url,
      title,
      pages:
        this.context?.pages().filter(
          (page) => !page.isClosed() && (!owner || this.pageOwners.get(page) === owner),
        ).length ?? 0,
      recording: !!this.videoDir,
      videoDir: this.videoDir,
    };
  }

  /** Path of the in-progress video for the active page. File is finalized when the page/context closes. */
  async videoInfo(): Promise<{ recording: boolean; dir?: string; pendingFile?: string }> {
    if (!this.videoDir) return { recording: false };
    const owner = this.currentOwner();
    const page = (owner ? this.activePages.get(owner) : this.activePage) ?? undefined;
    const video = page?.video();
    const pendingFile = video ? await video.path().catch(() => undefined) : undefined;
    return { recording: true, dir: this.videoDir, pendingFile };
  }

  /** Request that the active page's video be written to a specific path (finalizes on page/context close). */
  async saveVideoAs(targetPath: string): Promise<{ ok: boolean; savedTo?: string; pendingFile?: string; error?: string }> {
    if (!this.videoDir) return { ok: false, error: "Recording is not enabled. Start the session with recordVideo." };
    const page = await this.getPage();
    const video = page.video();
    if (!video) return { ok: false, error: "No video for the active page." };
    const pendingFile = await video.path().catch(() => undefined);
    // saveAs resolves only after the page/context closes, so fire-and-forget.
    video.saveAs(targetPath).catch(() => undefined);
    return { ok: true, savedTo: targetPath, pendingFile };
  }

  trackPage(page: Page): void {
    if (this.trackedPages.has(page)) return;
    this.trackedPages.add(page);
    page.on("request", (req) => {
      this._networkRequests.push({
        owner: this.pageOwners.get(page),
        id: String(this.nextNetworkRequestId++),
        url: redactDataUrl(req.url()),
        method: req.method(),
        type: req.resourceType(),
        timestamp: Date.now(),
        fromCache: false,
        headers: req.headers(),
      });
    });
    page.on("response", (res) => {
      const req = res.request();
      const reqUrl = redactDataUrl(req.url());
      const owner = this.pageOwners.get(page);
      const existing = this._networkRequests.find(
        (entry) =>
          entry.owner === owner &&
          entry.url === reqUrl &&
          entry.method === req.method() &&
          !entry.status,
      );
      if (existing) {
        existing.status = res.status();
        existing.statusText = res.statusText();
        existing.duration = Date.now() - existing.timestamp;
      }
    });
    page.on("console", (msg) => {
      this._consoleMessages.push({
        owner: this.pageOwners.get(page),
        type: msg.type(),
        text: redactSecrets(msg.text()),
        timestamp: Date.now(),
        location: msg.location(),
      });
    });
  }

  async addBlockRoute(opts: { urlPattern?: string; resourceTypes?: string[] }): Promise<RouteRule[]> {
    await this.getPage();
    if (!this.context) throw new Error("Browser context not available");
    const urlPattern = opts.urlPattern ?? "**/*";
    const types = opts.resourceTypes?.length ? new Set(opts.resourceTypes) : null;
    const id = `route${this.nextRouteId++}`;
    const owner = this.currentOwner();
    const handler = (route: Route) => {
      if (owner && this.ownerForRoute(route) !== owner) return route.fallback();
      return !types || types.has(route.request().resourceType()) ? route.abort() : route.fallback();
    };
    await this.context.route(urlPattern, handler);
    this._routeRules.push({ id, kind: "block", urlPattern, resourceTypes: opts.resourceTypes, owner, handler });
    return this.listRoutes();
  }

  async addMockRoute(opts: { urlPattern: string; status?: number; body?: string; contentType?: string }): Promise<RouteRule[]> {
    await this.getPage();
    if (!this.context) throw new Error("Browser context not available");
    const id = `route${this.nextRouteId++}`;
    const owner = this.currentOwner();
    const handler = (route: Route) => {
      if (owner && this.ownerForRoute(route) !== owner) return route.fallback();
      return route.fulfill({
        status: opts.status ?? 200,
        body: opts.body ?? "",
        contentType: opts.contentType ?? "text/plain",
      });
    };
    await this.context.route(opts.urlPattern, handler);
    this._routeRules.push({ id, kind: "mock", urlPattern: opts.urlPattern, status: opts.status ?? 200, owner, handler });
    return this.listRoutes();
  }

  async clearRoutes(): Promise<number> {
    const owner = this.currentOwner();
    const rules = this._routeRules.filter((rule) => !owner || rule.owner === owner);
    const count = rules.length;
    if (this.context) {
      for (const rule of rules) {
        await this.context.unroute(rule.urlPattern, rule.handler).catch(() => undefined);
      }
    }
    this._routeRules = owner ? this._routeRules.filter((rule) => rule.owner !== owner) : [];
    return count;
  }

  listRoutes(): RouteRule[] {
    const owner = this.currentOwner();
    return this._routeRules
      .filter((rule) => !owner || rule.owner === owner)
      .map(({ handler, owner: _owner, ...rule }) => rule);
  }

  getNetworkRequests(activeOnly?: boolean): NetworkRequest[] {
    this._networkRequests = this._networkRequests.slice(-500);
    const owner = this.currentOwner();
    const requests = this._networkRequests.filter((entry) => !owner || entry.owner === owner);
    const filtered = activeOnly ? requests.filter((entry) => !entry.status) : requests;
    return filtered.map(({ owner: _owner, ...entry }) => entry);
  }

  getConsoleMessages(): ConsoleMessage[] {
    this._consoleMessages = this._consoleMessages.slice(-200);
    const owner = this.currentOwner();
    return this._consoleMessages
      .filter((entry) => !owner || entry.owner === owner)
      .map(({ owner: _owner, ...entry }) => entry);
  }

  getNetworkRequestByIndex(index: number): NetworkRequest | undefined {
    return this.getNetworkRequests()[index];
  }

  getNetworkRequestById(id: string): NetworkRequest | undefined {
    return this.getNetworkRequests().find((request) => request.id === id);
  }

  async close(): Promise<{ videos: string[] }> {
    // Capture pending video paths before tearing down — files are flushed on context close.
    const videos: string[] = [];
    if (this.videoDir && this.context) {
      for (const page of this.context.pages()) {
        const video = page.video();
        if (!video) continue;
        const path = await video.path().catch(() => undefined);
        if (path) videos.push(path);
      }
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.activePage = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.startPromise = undefined;
    this.engine = "patchright";
    this.videoDir = undefined;
    this.pageIds = new WeakMap<Page, string>();
    this.trackedPages = new WeakSet<Page>();
    this.activePages.clear();
    this.pageOwners = new WeakMap<Page, string>();
    this.nextPageId = 1;
    this.nextRouteId = 1;
    this.nextNetworkRequestId = 1;
    this.pageRegistrations.clear();
    this._routeRules = [];
    return { videos };
  }

  private async removeSingletonFiles(userDataDir: string): Promise<void> {
    await Promise.all([
      rm(join(userDataDir, "SingletonLock"), { force: true }),
      rm(join(userDataDir, "SingletonSocket"), { force: true }),
      rm(join(userDataDir, "SingletonCookie"), { force: true }),
    ]).catch(() => undefined);
  }

  private registerExistingPages(): void {
    for (const page of this.context?.pages() ?? []) { this.idFor(page); this.trackPage(page); }
  }

  private idFor(page: Page): string {
    const existing = this.pageIds.get(page);
    if (existing) return existing;
    const id = `p${this.nextPageId++}`;
    this.pageIds.set(page, id);
    return id;
  }

  private findPage(pageId: string): Page | undefined {
    const owner = this.currentOwner();
    return this.context?.pages().find(
      (page) =>
        !page.isClosed() &&
        this.idFor(page) === pageId &&
        (!owner || this.pageOwners.get(page) === owner),
    );
  }

  private async pageInfo(page: Page): Promise<PageInfo> {
    const owner = this.currentOwner();
    return {
      id: this.idFor(page),
      active: page === (owner ? this.activePages.get(owner) : this.activePage),
      closed: page.isClosed(),
      url: page.url(),
      title: await page.title().catch(() => undefined),
    };
  }
}
