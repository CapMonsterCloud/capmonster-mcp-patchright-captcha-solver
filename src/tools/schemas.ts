import { z } from "zod";

export const startSchema = z.object({
  browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
  headless: z.boolean().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  userAgent: z.string().optional(),
  userDataDir: z.string().optional(),
  channel: z.enum(["chrome", "chrome-beta", "chrome-dev", "chrome-canary", "msedge"]).optional(),
  locale: z.string().optional(),
  timezoneId: z.string().optional(),
  proxy: z.object({
    server: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    bypass: z.string().optional(),
  }).optional(),
  geolocation: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy: z.number().optional(),
  }).optional(),
  colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
  device: z.string().optional(),
  mobile: z.boolean().optional(),
  cdpEndpoint: z.string().url().optional(),
  recordVideo: z.union([
    z.boolean(),
    z.object({
      dir: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }),
  ]).optional(),
});

export const navigateSchema = z.object({
  url: z.string().url(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
  timeout: z.number().int().positive().optional(),
});

export const newPageSchema = z.object({
  url: z.string().url().optional(),
});

export const pageIdSchema = z.object({
  pageId: z.string().min(1),
});

export const closePageSchema = z.object({
  pageId: z.string().min(1).optional(),
});

export const screenshotSchema = z.object({
  path: z.string().optional(),
  fullPage: z.boolean().optional(),
  scale: z.enum(["css", "device"]).optional(),
});

export const snapshotSchema = z.object({
  maxLength: z.number().int().positive().optional(),
  includeUrls: z.boolean().optional(),
});

export const findSchema = z.object({
  query: z.string().min(1),
  regex: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  context: z.number().int().nonnegative().optional(),
  maxMatches: z.number().int().positive().optional(),
});

export const targetSchema = z
  .object({
    selector: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    frameSelector: z.string().min(1).optional(),
    timeout: z.number().int().positive().optional(),
  })
  .refine((value) => !!value.selector !== !!value.ref, {
    message: "Provide exactly one of selector or ref",
  });

export const fillSchema = targetSchema.extend({
  text: z.string(),
});

export const typeSchema = targetSchema.extend({
  text: z.string(),
  // Deprecated: per-key dwell and inter-key gaps are now randomized for
  // human-like timing. Kept for backward compatibility; ignored.
  delay: z.number().int().nonnegative().optional(),
  // When true (default), verify the typed value against the request for
  // input/textarea elements and throw on mismatch.
  verify: z.boolean().optional(),
});

export const pressSchema = z.object({
  key: z.string().min(1),
  selector: z.string().optional(),
  ref: z.string().optional(),
  frameSelector: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

export const waitForSchema = z.object({
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  frameSelector: z.string().min(1).optional(),
  state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
  timeout: z.number().int().positive().optional(),
}).refine((value) => !(value.selector && value.ref), {
  message: "Provide at most one of selector or ref",
});

export const evaluateSchema = z.object({
  function: z.string().min(1).optional(),
  expression: z.string().min(1).optional(),
  script: z.string().min(1).optional(),
  // "isolated" (default) runs in Patchright's stealth isolated world; "main"
  // runs in the page's real (main) world, where globals defined by the page's
  // own inline <script> are visible and callable. Use "main" when you need to
  // read or call a global the page defined (e.g. a page-registered callback).
  world: z.enum(["isolated", "main"]).optional(),
  // Runs the code inside this iframe (including cross-origin) instead of the
  // top-level page — same CSS selector this server's click/fill/type already
  // accept. Without this, evaluate always runs in the top frame even when a
  // frameSelector is passed to it, silently executing against the wrong
  // document (confirmed live: reading location.href with frameSelector set
  // returned the parent page's URL, not the iframe's).
  frameSelector: z.string().min(1).optional(),
}).refine(v => v.function || v.expression || v.script, {
  message: "Provide function, expression, or script",
});

export const saveBlobSchema = z.object({
  function: z.string().min(1).optional(),
  expression: z.string().min(1).optional(),
  world: z.enum(["isolated", "main"]).optional(),
  path: z.string().min(1),
  // "base64" decodes the evaluated string (stripping a data:...;base64, prefix
  // if present) into raw bytes before writing — for images/blobs/PDFs pulled
  // out of the page. "text" (default) writes the value as UTF-8 (JSON-stringifying
  // non-string results).
  encoding: z.enum(["base64", "text"]).optional(),
}).refine(v => v.function || v.expression, {
  message: "Provide function or expression",
});

export const selectOptionSchema = targetSchema.extend({
  values: z.array(z.string()).min(1),
});

export const dialogSchema = z.object({
  accept: z.boolean(),
  promptText: z.string().optional(),
  wait: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
});

export const fileUploadSchema = targetSchema.extend({
  paths: z.array(z.string()).min(1),
});

export const networkRequestsSchema = z.object({
  activeOnly: z.boolean().optional(),
});

export const networkRequestSchema = z.object({
  id: z.string().min(1).optional(),
  index: z.number().int().nonnegative().optional(),
  details: z.boolean().optional(),
}).refine((value) => !!value.id !== (value.index !== undefined), {
  message: "Provide exactly one of id or index",
});

export const networkStateSchema = z.object({
  offline: z.boolean(),
});

export const resizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const dragDropSchema = z.object({
  source: z.object({ selector: z.string().optional(), ref: z.string().optional(), frameSelector: z.string().optional() }).refine(v => !!v.selector !== !!v.ref, { message: "Provide exactly one of selector or ref" }),
  target: z.object({ selector: z.string().optional(), ref: z.string().optional(), frameSelector: z.string().optional() }).refine(v => !!v.selector !== !!v.ref, { message: "Provide exactly one of selector or ref" }),
  timeout: z.number().int().positive().optional(),
});

export const fillFormSchema = z.object({
  fields: z.array(z.object({
    selector: z.string().optional(),
    ref: z.string().optional(),
    frameSelector: z.string().optional(),
    name: z.string().optional(),
    value: z.string(),
  })).min(1),
  timeout: z.number().int().positive().optional(),
});

export const runCodeSchema = z.object({
  script: z.string().min(1),
  args: z.array(z.unknown()).optional(),
  // See evaluateSchema.world. "main" runs in the page's real world so
  // page-defined globals are reachable; default "isolated" keeps stealth.
  world: z.enum(["isolated", "main"]).optional(),
});

export const addInitScriptSchema = z.object({
  function: z.string().min(1).optional(),
  script: z.string().min(1).optional(),
}).refine(v => v.function || v.script, {
  message: "Provide function or script",
});

const resourceTypeEnum = z.enum([
  "document", "stylesheet", "image", "media", "font", "script",
  "texttrack", "xhr", "fetch", "eventsource", "websocket", "manifest", "other",
]);

export const routeBlockSchema = z.object({
  urlPattern: z.string().optional(),
  resourceTypes: z.array(resourceTypeEnum).optional(),
});

export const routeMockSchema = z.object({
  urlPattern: z.string().min(1),
  status: z.number().int().optional(),
  body: z.string().optional(),
  contentType: z.string().optional(),
});

export const storageSaveSchema = z.object({
  path: z.string().optional(),
});

export const storageLoadSchema = z.object({
  path: z.string().optional(),
  state: z.object({
    cookies: z.array(z.record(z.string(), z.unknown())).optional(),
    origins: z.array(z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    })).optional(),
  }).optional(),
}).refine((v) => !!v.path || !!v.state, {
  message: "Provide path or state",
});

export const apiRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  data: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  timeout: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
});

export const visibleTextSchema = z.object({
  maxLength: z.number().int().positive().optional(),
});

export const visibleHtmlSchema = z.object({
  selector: z.string().optional(),
  removeScripts: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
});

export const iframeClickSchema = z.object({
  frameSelector: z.string().min(1),
  selector: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

export const iframeFillSchema = iframeClickSchema.extend({
  value: z.string(),
});

export const savePdfSchema = z.object({
  path: z.string().optional(),
  landscape: z.boolean().optional(),
  printBackground: z.boolean().optional(),
  scale: z.number().positive().optional(),
  format: z.enum(["Letter", "Legal", "Tabloid", "A3", "A4", "A5"]).optional(),
});

// --- Storage: cookies ---
export const cookieListSchema = z.object({
  domain: z.string().optional(),
  path: z.string().optional(),
});

export const cookieGetSchema = z.object({
  name: z.string().min(1),
});

export const cookieSetSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  url: z.string().url().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

export const cookieDeleteSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  path: z.string().optional(),
});

// --- Storage: localStorage / sessionStorage ---
export const storageKeyGetSchema = z.object({
  key: z.string().min(1),
});

export const storageKeySetSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const storageKeyDeleteSchema = z.object({
  key: z.string().min(1),
});

// --- Passkeys / virtual WebAuthn authenticator ---
export const passkeyCreateSchema = z.object({
  rpId: z.string().min(1),
  id: z.string().min(1).optional(),
  userHandle: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  publicKey: z.string().min(1).optional(),
  includePrivateKey: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const supplied = [value.id, value.userHandle, value.privateKey, value.publicKey]
    .filter((item) => item !== undefined).length;
  if (supplied !== 0 && supplied !== 4) {
    ctx.addIssue({
      code: "custom",
      message: "Provide all of id, userHandle, privateKey, and publicKey when importing a passkey",
    });
  }
});

export const passkeyListSchema = z.object({
  rpId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  includePrivateKey: z.boolean().optional(),
});

export const passkeyDeleteSchema = z.object({
  id: z.string().min(1),
});

// --- Video recording ---
export const videoSaveSchema = z.object({
  path: z.string().optional(),
});

// --- Highlight overlay ---
export const highlightSchema = targetSchema.extend({
  label: z.string().optional(),
  style: z.string().optional(),
});

export const hideHighlightSchema = z.object({
  label: z.string().optional(),
  selector: z.string().optional(),
  ref: z.string().optional(),
});
