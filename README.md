# capmonster-mcp-patchright

🛡️ Undetectable browser MCP server — 66 tools, Patchright-powered, zero CDP fingerprint.

[![npm]](https://npmjs.com/capmonster-mcp-patchright) [![MCP]](https://modelcontextprotocol.io)

Passes Cloudflare / Akamai / Kasada / Datadome.

Fork of [mcp-patchright](https://github.com/maestrojeong/mcp-patchright) that adds a per-call
`world: "main"` option to `browser_evaluate` / `browser_run_code_unsafe`, so page-defined window
globals are visible and callable. Defaults to Patchright's isolated stealth world (matching
upstream); opt into `main` only when a page's own script needs to see or be called by your
evaluated code. Everything else matches upstream mcp-patchright.

## Why Patchright, not Playwright?

| | Playwright | Patchright |
|---|---|---|
| `Runtime.enable` | ✅ sends (detectable) | ❌ removed |
| `Console.enable` | ✅ sends | ❌ removed |
| `--enable-automation` flag | ✅ present | ❌ removed |
| `navigator.webdriver` | `true` | `false` / `undefined` |
| Anti-bot evasion | ❌ | ✅ |

See the [full comparison](docs/tool-comparison.html) for details.

## Quick start

```bash
npm i -g capmonster-mcp-patchright
capmonster-mcp-patchright --port 9321 --host 127.0.0.1
```

### With Claude / GPT / agents

```json
{
  "mcpServers": {
    "patchright": {
      "command": "npx",
      "args": ["capmonster-mcp-patchright", "--port", "9321", "--host", "127.0.0.1"]
    }
  }
}
```

## Features

- **66 MCP tools** — full browser automation surface
- **`world: "main"` opt-in** — `browser_evaluate` / `browser_run_code_unsafe` can run in the page's real world to see/call page-defined globals (default stays isolated/stealth)
- **`browser_find`** — search the current aria snapshot for text/regex, cheaper than a full `browser_snapshot`
- **`browser_save_blob`** — save a Blob/data URL produced by page code to disk
- **3 transports** — stdio, SSE, Streamable HTTP (`/mcp`)
- **Persistent profiles** — real Chrome profile, reuse across sessions
- **Multi-page** — tab management (new, list, switch, close)
- **Owner-scoped HTTP sessions** — isolate tabs per caller with `owner` query/header
- **CDP attach** — control an already-running Chrome
- **Network tracking + interception** — request list/detail, offline toggle, block/mock routes
- **Session import/export** — `browser_storage_save` / `browser_storage_load` (cookies + localStorage)
- **Granular storage** — per-key cookie / localStorage / sessionStorage CRUD (`browser_cookie_*`, `browser_localstorage_*`, `browser_sessionstorage_*`)
- **Authenticated API requests** — `browser_api_request` reuses session cookies (hybrid scraping)
- **Text/HTML extraction** — `browser_get_visible_text` / `_html` (token-light)
- **Iframe-aware** — pass `frameSelector` to any element tool (click/fill/type/hover/press/wait_for/select/drag) to act inside an iframe
- **PDF export** — `browser_save_pdf` via CDP (works in headed/stealth mode)
- **Video recording** — `browser_start` with `recordVideo`, `browser_video_save`; .webm flushed on `browser_close`
- **Element highlight** — `browser_highlight` / `browser_hide_highlight` overlays for screenshots & recordings
- **Stealth profiles** — proxy / geolocation / locale / timezone / colorScheme
- **Console capture** — real-time console message stream
- **Fingerprint check** — `browser_fingerprint_check` diagnostics
- **Virtual passkeys** — create, import, list, and delete WebAuthn credentials with private keys redacted by default

## Tools

Full comparison HTML in [/docs/tool-comparison.html](docs/tool-comparison.html).

- `browser_start`
- `browser_status`
- `browser_navigate`
- `browser_new_page`
- `browser_pages`
- `browser_switch_page`
- `browser_close_page`
- `browser_snapshot`
- `browser_find`
- `browser_take_screenshot`
- `browser_click`
- `browser_fill`
- `browser_type`
- `browser_hover`
- `browser_press_key`
- `browser_wait_for`
- `browser_evaluate`
- `browser_fingerprint_check`
- `browser_navigate_back`
- `browser_select_option`
- `browser_handle_dialog`
- `browser_file_upload`
- `browser_network_requests`
- `browser_network_request`
- `browser_console_messages`
- `browser_resize`
- `browser_drag`
- `browser_fill_form`
- `browser_run_code_unsafe`
- `browser_add_init_script`
- `browser_network_state_set`
- `browser_api_request`
- `browser_get_visible_text`
- `browser_get_visible_html`
- `browser_iframe_click`
- `browser_iframe_fill`
- `browser_route_block`
- `browser_route_mock`
- `browser_route_clear`
- `browser_storage_save`
- `browser_storage_load`
- `browser_cookie_list`
- `browser_cookie_get`
- `browser_cookie_set`
- `browser_cookie_delete`
- `browser_cookie_clear`
- `browser_localstorage_list`
- `browser_localstorage_get`
- `browser_localstorage_set`
- `browser_localstorage_delete`
- `browser_localstorage_clear`
- `browser_sessionstorage_list`
- `browser_sessionstorage_get`
- `browser_sessionstorage_set`
- `browser_sessionstorage_delete`
- `browser_sessionstorage_clear`
- `browser_passkey_install`
- `browser_passkey_create`
- `browser_passkey_list`
- `browser_passkey_delete`
- `browser_video_save`
- `browser_highlight`
- `browser_hide_highlight`
- `browser_save_blob`
- `browser_save_pdf`
- `browser_close`

## Development

### Owner-scoped HTTP sessions

HTTP mode requires a stable owner on
the MCP URL (`?owner=<id>`) or with the `X-Browser-Owner` header. Page listing,
switching, navigation, and closing are restricted to that owner's tabs. Delete
`/owners?owner=<id>` to close all tabs owned by one caller without stopping the
browser or clearing the profile.

```bash
npm install
npm run build
node dist/index.js
```

### Release

Install the matching Chromium build once, then prepare a release from the exact
dependency versions in `package-lock.json`, run the full verification suite,
and inspect the package without publishing it:

```bash
npx patchright install chromium
npm run release:check
npm publish
```

By default, `browser_start` launches Chromium via patchright as headed real Chrome with a persistent profile at:

```text
~/.maestro/stealth-playwright-mcp/profiles/default
```

You can override it with the `userDataDir` tool argument or `STEALTH_PLAYWRIGHT_USER_DATA_DIR`.

To attach to an already-running Chrome instead of launching one, start Chrome with remote debugging and pass `cdpEndpoint` to `browser_start`:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.maestro/stealth-playwright-mcp/profiles/cdp
```

```json
{ "cdpEndpoint": "http://127.0.0.1:9222" }
```

`browser_snapshot` returns Playwright's AI aria snapshot. Use `[ref=eN]` values from that snapshot with `browser_click`, `browser_fill`, `browser_type`, `browser_hover`, `browser_press`, and `browser_wait_for` by passing `{ "ref": "eN" }`. CSS selectors remain supported via `{ "selector": "..." }`.

MCP config example:

```json
{
  "mcpServers": {
    "patchright": {
      "command": "node",
      "args": ["/path/to/capmonster-mcp-patchright/dist/index.js"]
    }
  }
}
```

## Direction

Shipped:

- ✅ persistent user data dirs
- ✅ CDP attach to real Chrome
- ✅ proxy / timezone / locale / geolocation profiles
- ✅ accessibility snapshots for LLM-friendly page control
- ✅ fingerprint diagnostics
- ✅ network interception (block / mock)
- ✅ session import/export (storageState)
- ✅ PDF export
- ✅ authenticated API requests (reuse browser cookies)
- ✅ lightweight text/HTML extraction
- ✅ iframe actions
- ✅ `world: "main"` opt-in for `browser_evaluate` / `browser_run_code_unsafe`
- ✅ aria-snapshot search (`browser_find`)
- ✅ save Blob/data URL output to disk (`browser_save_blob`)

Next:

- rebrowser-playwright backend
- codegen sessions
- coordinate-based (vision) clicks
- tracing / video recording
