# 🦘 Switcheroo

A privacy-focused browser extension for Brave (and Chromium-based browsers) that automatically redirects privacy-invasive services to open-source, privacy-friendly frontends — with no tracking, no ads, and no data collection.

| Service | Redirects to |
|---------|-------------|
| YouTube + youtu.be | [Invidious](https://invidious.io) |
| Reddit + old.reddit.com | [Redlib](https://github.com/redlib-org/redlib) |
| Imgur | [Rimgo](https://codeberg.org/rimgo/rimgo) |
| TikTok | [ProxiTok](https://github.com/pablouser1/ProxiTok) |
| Medium | [Scribe](https://sr.ht/~edwardloveall/Scribe/) |
| Google Fonts | [Bunny Fonts](https://fonts.bunny.net) |

---

## What it does

When you open a link to one of the supported services — from a search result, another site, or your bookmarks — Switcheroo redirects you to an equivalent page on a privacy-respecting frontend.

**Navigation services** (YouTube, Reddit, Imgur, TikTok, Medium) are redirected by a content script that runs at `document_start`. It reads the selected instance from local storage and replaces the page location before the original page finishes loading (`window.stop()` + `location.replace()`, so no extra history entry is created).

> **Note on the privacy model:** because the redirect happens in a content script that runs *on the page*, the original service's server does receive the initial request for that URL before the redirect fires. The extension strips tracking parameters and forwards only the essential identifier to the privacy frontend, but it does not prevent that first contact. (Google Fonts is the exception — see below.)

**Google Fonts** is handled differently, using the browser-level [Declarative Net Request](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) (DNR) API. DNR rewrites `fonts.googleapis.com` requests to `fonts.bunny.net` *before* they leave the browser, so Google's servers are never contacted at all.

**YouTube redirects handle:** watch pages (`/watch?v=`), Shorts, search results, playlists, embeds, channels (by ID, `@handle`, and legacy `/user/`), and `youtu.be` short links.

**Reddit redirects handle:** subreddit pages, post pages, user profiles, search, the homepage (including `?sort=hot`), and `old.reddit.com`.

**Imgur redirects handle:** gallery/album/post paths and direct `i.imgur.com` image links (served at `/media/…` on Rimgo).

**TikTok redirects handle:** profile pages (`/@handle`), videos (`/@handle/video/ID`), and other paths, across `tiktok.com` subdomains.

**Medium redirects handle:** `medium.com` paths and `*.medium.com` publication subdomains.

**Google Fonts redirects handle:** the CSS API (`/css2`, `/css`, `/icon`) and any other `fonts.googleapis.com` path. The CSS returned by Bunny references Bunny's own CDN for font files, so `fonts.gstatic.com` is never contacted either.

---

## Privacy principles

- **Zero telemetry.** No analytics, no crash reporting, no usage data. Nothing is ever sent to a server controlled by this extension.
- **Tracking parameters stripped.** Navigation redirects reconstruct the destination from the path/identifier only, discarding UTM params, Reddit share/referral IDs, YouTube tracking params (`si`, `pp`, `feature`, `ab_channel`), and similar.
- **Local storage only.** Settings and the instance cache live in `chrome.storage.local` — never synced to Google's servers.
- **HTTPS only.** All redirect targets must use HTTPS; HTTP and source-domain URLs are rejected automatically.
- **Cloudflare / data-collecting instances excluded by default.** Instances behind Cloudflare, or whose operators declare they collect user data, are listed separately with a warning and require explicit opt-in.
- **No external resources in the UI.** The popup and settings pages load nothing from the internet — no CDN fonts, no remote scripts. The Nunito font is bundled locally.
- **Instance-list fetches are disclosed and optional.** To keep instance lists current, Switcheroo fetches from the sources below. These requests reveal that you have the extension installed (your IP and User-Agent are visible to the host) but contain no browsing history. They run at install time and on the auto-update interval (default hourly), and can be turned **off** entirely in settings — the extension then falls back to bundled instance lists. When auto-update is off, manual refreshes show a confirmation listing exactly which hosts will be contacted.
  - `api.invidious.io` (Invidious)
  - `raw.githubusercontent.com` (Redlib, ProxiTok)
  - `rimgo.codeberg.page` (Rimgo)
  - `git.sr.ht` (Scribe)

  Google Fonts → Bunny Fonts makes **no** extension-initiated fetch — it is a static redirect target, not a fetched list.

---

## Features

### Instance modes (navigation services)

**Random (default):** Switcheroo picks a random instance from your enabled list and rotates it on a configurable interval (per service: from approximately per-redirect up to daily, or on startup only).

**Fixed:** Always redirect to one specific instance — useful if you have preferences or an account on a particular instance.

### Instance management

- Enable or disable individual instances from an auto-updated list
- Cloudflare-backed and data-collecting instances are shown separately, require opt-in, and carry a warning badge
- Add a custom instance URL (must be HTTPS)
- Where the source exposes it (e.g. Invidious), instances are filtered to >80% uptime and annotated with country, uptime, version, and registration status

### Google Fonts → Bunny Fonts

Bunny Fonts (`fonts.bunny.net`) is a drop-in API replacement for Google Fonts: identical URL/query structure, no tracking, GDPR-compliant, operated by BunnyWay d.o.o. (Slovenia/EU). Toggle on or off — no instance management needed.

---

## Installation

Switcheroo is currently distributed as an unpacked extension for development and personal use.

1. Go to `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the folder containing `manifest.json`
5. The 🦘 icon appears in your toolbar

On first load, Switcheroo seeds settings, fetches the latest instance lists, and registers the Google Fonts redirect rule. Visit `youtube.com`, `reddit.com`, or a site using Google Fonts to confirm it's working.

> **Note:** Unpacked extensions show a "developer mode" banner on each browser start. That's a browser restriction, not something Switcheroo controls.

---

## Usage

### Popup

Click the 🦘 icon to toggle each service on/off, see the current mode and active-instance count, refresh instance lists, and open the full settings page. (Disabled services are hidden from the popup.)

### Settings page

Open via **Settings** in the popup (or right-click the icon → *Options*). The **Instance Lists** card at the top controls the global auto-update interval, dark mode, and a Refresh All button. Each navigation service then lets you: enable/disable it, switch Random/Fixed mode, choose a fixed instance (dropdown or custom HTTPS URL), set the rotation interval, and enable/disable individual instances. Google Fonts shows a single toggle.

---

## How redirects work

There are two redirect mechanisms:

**1. Content script (navigation services).** `content/redirect.js` is injected at `document_start` on the supported domains. It reads `settings` from `chrome.storage.local`, and for the matching service calls `transformUrl(href, currentInstance)`, which parses the URL with `new URL()` and reconstructs the destination on the chosen instance — forwarding only the essential identifier and dropping query/tracking params. If a destination is produced, it calls `window.stop()` then `location.replace()`.

```
Input:   https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&si=abcd
Output:  https://<chosen-invidious-instance>/watch?v=dQw4w9WgXcQ
```

The background service worker chooses and rotates `currentInstance` per service and persists it; the content script just reads the current value on each navigation.

**2. Declarative Net Request (Google Fonts only).** A single dynamic DNR rule rewrites `fonts.googleapis.com/*` → `fonts.bunny.net/*` at the network level, before the request leaves the browser. The rule includes `excludedInitiatorDomains` (all known instance hostnames) to avoid redirect loops.

### Rule ID ranges (DNR)

| Service | IDs | Mechanism |
|---------|-----|-----------|
| YouTube / Reddit / Imgur / TikTok / Medium | reserved 1000–2999, 4000–6999 | Content script (`transformUrl`) — ranges reserved, not active DNR |
| Google Fonts | 3000–3999 | DNR static redirect (always Bunny Fonts) |

---

## Adding a new service

The registry pattern keeps additions localized.

1. **Create `services/myservice.js`** implementing the `ServiceDefinition` shape. For a navigation service, implement `transformUrl(href, instance)` (and `instanceFetcher` for the live instance list). For a network-level redirect like Google Fonts, implement `buildRules()` instead and set `instanceFetcher.url: null`. See existing services for complete examples.

   ```js
   export const myService = {
     id: 'myservice',
     name: 'My Service',
     description: 'Redirect to a privacy frontend.',
     sourceHosts: ['myservice.com', 'www.myservice.com'],
     ruleIdStart: 7000,
     ruleIdEnd: 7999,
     instanceFetcher: {
       url: 'https://instances.example.com/list.json',
       cacheTTLMs: 3_600_000,
       parse(raw) { /* return Instance[] */ },
       fallbackFile: 'data/myservice-fallback.json',
     },
     transformUrl(href, instance) { /* return destination URL or null */ },
     defaultSettings() {
       return {
         enabled: true, mode: 'random', fixedInstance: null,
         currentInstance: null, enabledInstances: [], allowCloudflare: false,
         rotationIntervalMs: 3_600_000, lastRotatedAt: 0,
       };
     },
   };
   ```

2. **Create `data/myservice-fallback.json`** — a top-level array of `Instance` objects (`{ "url": "https://…", "country": "DE", "cloudflare": false }`).

3. **Register it** in `services/registry.js` (import + add to `SERVICES`).

4. **Add a `content_scripts` entry** in `manifest.json` for the source domain(s), and add the imported service file to `web_accessible_resources` (the content script is an ES module, so its imports must be web-accessible).

5. **Add UI labels** in `options.js` and `popup.js` (`SERVICE_META`).

---

## Permissions

| Permission | Why |
|-----------|-----|
| `declarativeNetRequest` | Register the Google Fonts → Bunny Fonts redirect rule |
| `storage` | Persist settings and the instance cache locally |
| `alarms` | Refresh instance lists and rotate instances on a schedule |
| Host: `api.invidious.io` | Fetch the Invidious instance list |
| Host: `raw.githubusercontent.com` | Fetch the Redlib and ProxiTok instance lists |
| Host: `rimgo.codeberg.page` | Fetch the Rimgo instance list |
| Host: `git.sr.ht` | Fetch the Scribe instance list |

No `tabs`, `history`, `cookies`, `webRequest`, or broad host permissions are requested. Content scripts are scoped to the specific source domains.

---

## Known limitations

- **The source server sees the first request.** For navigation services, the redirect runs in a content script on the page, so the original domain receives the initial request before redirection. Only Google Fonts is redirected pre-network (via DNR). If you need the request to never reach the source, a content-script approach cannot guarantee that.
- **Timestamps and playlist context are not forwarded** on YouTube watch pages — only the video ID is preserved.
- **Most query parameters are dropped** on navigation redirects (intentionally, to strip tracking). Reddit search (`?q=`) is the preserved exception.
- **Instance rotation is interval-based, not per-visit.** Within a rotation window you land on the same instance (better for consistency on instances where you have preferences).
- **Hardcoded `fonts.gstatic.com` font-file URLs are not intercepted** — only the `fonts.googleapis.com` CSS API is. Pages that hardcode direct gstatic font-file URLs (rare) would still contact Google.

---

## License

MIT
