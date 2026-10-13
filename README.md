<p align="center">
  <img src="assets/logo.png" alt="CapMonster Cloud" width="200">
</p>

# capmonster-mcp-patchright

**Stealth browser MCP server for AI agents** — 66 tools, Patchright-powered, reduced CDP automation signals.

[
[
[

Built for automation on sites protected by Cloudflare, Akamai, Kasada and DataDome.
When the page shows a CAPTCHA, pair it with the
[CapMonster Cloud MCP server](https://github.com/CapMonsterCloud/capmonster-mcp-captcha-solver):
this server drives the browser, CapMonster Cloud solves the CAPTCHA.
[Learn more](https://capmonster.cloud/en/mcp/?utm_source=github&utm_medium=referral&utm_campaign=mcp_patchright_readme&utm_content=intro)

**[👉 Get your CapMonster Cloud API Key](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_patchright_readme&utm_content=header_button)**

***

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
-
