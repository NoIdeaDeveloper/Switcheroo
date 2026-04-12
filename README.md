# 🦘 Switcheroo

A privacy-focused browser extension for Brave (and Chromium-based browsers) that automatically redirects YouTube and Reddit to open-source, privacy-friendly frontends — with no tracking, no ads, and no data collection.

| Service | Redirects to |
|---------|-------------|
| YouTube + youtu.be | [Invidious](https://invidious.io) |
| Reddit + old.reddit.com | [Redlib](https://github.com/redlib-org/redlib) |

---

## What it does

When you click a YouTube or Reddit link — from a search result, another site, or your bookmarks — Switcheroo silently redirects you to an equivalent page on a privacy-respecting frontend before the original site ever loads. The redirect is handled at the browser level using the [Declarative Net Request](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) API, so YouTube and Reddit never receive your request.

**YouTube redirects handle:**
- Watch pages (`/watch?v=`)
- Shorts (`/shorts/`)
- Search results
- Playlists
- Embeds (including in iframes on third-party sites)
- Channels (by ID, `@handle`, and legacy `/user/`)
- `youtu.be` short links

**Reddit redirects handle:**
- Subreddit pages
- Post pages
- User profiles
- Search
- Homepage
- `old.reddit.com`

---

## Privacy principles

Switcheroo is built with privacy as the primary design goal — not an afterthought.

- **Zero telemetry.** No analytics, no crash reporting, no usage data. Nothing is ever sent to any server controlled by this extension.
- **The extension never sees your URLs.** Redirects use the browser's Declarative Net Request API, which operates at the browser level. Extension JavaScript code never sees which videos you watch or which subreddits you visit.
- **Local storage only.** Settings are stored in `chrome.storage.local` — not synced to Google's servers.
- **HTTPS only.** All redirect targets must use HTTPS. HTTP instances are rejected automatically.
- **Cloudflare instances excluded by default.** Cloudflare acts as a middleman that can log traffic, defeating the purpose of a privacy frontend. Cloudflare-backed instances are shown separately in settings with a clear warning.
- **Tracking parameters stripped.** UTM params, Reddit share/referral IDs, and YouTube internal tracking parameters (`si`, `pp`, `feature`, `ab_channel`) are discarded during redirection.
- **No external resources.** The popup and settings pages load nothing from the internet — no CDN fonts, no remote scripts. The Nunito font is bundled locally.
- **Two outbound requests, fully disclosed.** To keep instance lists current, Switcheroo fetches from:
  - `https://api.invidious.io/instances.json` (Invidious)
  - `https://raw.githubusercontent.com/redlib-org/redlib-instances/refs/heads/main/instances.json` (Redlib)

  These requests are made at install time and once per hour. They contain no user data beyond a standard browser request. If you prefer not to make these requests, the extension falls back to a bundled list of curated instances.

---

## Features

### Instance modes

**Random (default):** Switcheroo picks a random instance from your enabled list. The instance rotates on every browser startup and every hour, so you're not always going to the same place.

**Fixed:** Always redirect to one specific instance of your choice. Useful if you have an account or preferences saved on a particular instance.

### Instance management

- Enable or disable individual instances from a list that is kept up to date automatically
- Cloudflare-backed instances are shown separately with a warning badge and are off by default
- Add a custom instance URL (must be HTTPS)
- Instances are filtered to only show those with >80% uptime (Invidious; Redlib does not expose uptime data)

---

## Installation

Switcheroo is currently available as an unpacked extension for development and personal use.

### Load in Brave (or any Chromium browser)

1. Go to `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the `Switcheroo` folder (the one containing `manifest.json`)
5. The extension icon will appear in your toolbar

On first load, Switcheroo fetches the latest instance lists and sets up redirect rules automatically. Visit `youtube.com` or `reddit.com` to confirm it's working.

> **Note:** Unpacked extensions show a "developer mode" banner in Brave on each startup. This is a browser restriction, not something Switcheroo can control.

---

## Usage

### Popup

Click the 🦘 kangaroo icon in your toolbar to open the popup. From here you can:

- Toggle YouTube and Reddit redirects on or off with a single click
- See your current redirect mode and active instance count
- Refresh the instance list
- Open the full settings page

### Settings page

Click **Settings** in the popup (or right-click the icon → *Options*) to open the full settings page. For each service you can:

- Enable or disable the redirect
- Switch between **Random** and **Fixed** mode
- In Fixed mode: choose from the dropdown or enter a custom HTTPS URL
- Enable or disable individual instances using checkboxes
- Refresh the instance list on demand
- View Cloudflare-backed instances (collapsed by default, with a warning)

---

## File structure

```
Switcheroo/
├── manifest.json           — Extension manifest (MV3)
├── background.js           — Service worker: manages DNR rules and instance rotation
│
├── services/
│   ├── registry.js         — Service registry (the only file to edit when adding a new service)
│   ├── youtube.js          — YouTube → Invidious: URL patterns and DNR rules
│   └── reddit.js           — Reddit → Redlib: URL patterns and DNR rules
│
├── utils/
│   ├── validate.js         — Instance URL validation (HTTPS-only, no source domains)
│   ├── storage.js          — chrome.storage.local wrapper
│   ├── instances.js        — Instance fetching, caching, and selection
│   └── dnr.js              — DNR rule management
│
├── data/
│   ├── youtube-fallback.json  — Bundled Invidious instances (used if network unavailable)
│   └── reddit-fallback.json   — Bundled Redlib instances
│
├── popup.html / popup.css / popup.js      — Toolbar popup UI
├── options.html / options.css / options.js — Full settings page
│
├── icons/
│   ├── kangaroo.svg        — Master SVG source
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── fonts/
    └── Nunito.woff2        — Self-hosted font (no Google Fonts request at runtime)
```

---

## How redirects work

Switcheroo uses Manifest V3's [Declarative Net Request](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) API. Rules are registered as **dynamic rules** (stored in the browser, rebuilt at runtime) because the redirect target URL — which includes the selected instance — is not known at build time.

Each rule uses a `regexFilter` to match a URL pattern and a `regexSubstitution` to transform it:

```
Input:   https://www.youtube.com/watch?v=dQw4w9WgXcQ
Rule:    ^https?://(www\.)?youtube\.com/watch\?(?:[^#]*&)?v=([a-zA-Z0-9_-]{11})
Output:  https://inv.nadeko.net/watch?v=dQw4w9WgXcQ
```

The `currentInstance` per service is chosen by the background service worker and embedded in the rule. Rules are rebuilt when:

- A service is toggled on or off
- The user switches mode or selects a different fixed instance
- Instances are refreshed and the selected instance changes (hourly alarm + browser startup)

DNR rules include `excludedInitiatorDomains` containing all known instance hostnames, which prevents redirect loops if (for example) an Invidious page embeds a YouTube player.

### Rule ID ranges

| Service | IDs |
|---------|-----|
| YouTube | 1000 – 1999 |
| Reddit  | 2000 – 2999 |
| Future  | 3000+… |

---

## Adding a new service

Switcheroo's registry pattern makes adding services straightforward. No existing files need to change except `services/registry.js`.

1. **Create `services/myservice.js`** implementing the `ServiceDefinition` interface:

   ```js
   export const myService = {
     id: 'myservice',
     name: 'My Service',
     description: 'Redirect to a privacy frontend.',
     sourceHosts: ['myservice.com', 'www.myservice.com'],
     ruleIdStart: 3000,
     ruleIdEnd: 3999,
     instanceFetcher: {
       url: 'https://instances.example.com/list.json',
       cacheTTLMs: 3_600_000,
       parse(raw) { /* return Instance[] */ },
       fallbackFile: 'data/myservice-fallback.json',
     },
     buildRules(extensionId, settings, excludedInitiatorDomains) {
       if (!settings.enabled || !settings.currentInstance) return [];
       const instance = settings.currentInstance;
       return [
         {
           id: 3000,
           priority: 1,
           condition: {
             regexFilter: '^https?://(www\\.)?myservice\\.com(/.*)',
             resourceTypes: ['main_frame'],
             isUrlFilterCaseSensitive: false,
             excludedInitiatorDomains,
           },
           action: {
             type: 'redirect',
             redirect: { regexSubstitution: `${instance}\\2` },
           },
         },
       ];
     },
     defaultSettings() {
       return {
         enabled: true,
         mode: 'random',
         fixedInstance: null,
         currentInstance: null,
         enabledInstances: [],
         allowCloudflare: false,
       };
     },
   };
   ```

2. **Create `data/myservice-fallback.json`** with a few known-good instances:

   ```json
   [
     { "url": "https://example-frontend.org", "country": "DE", "cloudflare": false }
   ]
   ```

3. **Register the service** in `services/registry.js`:

   ```js
   import { myService } from './myservice.js';

   const SERVICES = [
     youtubeService,
     redditService,
     myService,   // ← add here
   ];
   ```

That's it. The popup, options page, background worker, and DNR manager all discover services dynamically from the registry.

---

## Permissions

Switcheroo requests the minimum permissions necessary:

| Permission | Why |
|-----------|-----|
| `declarativeNetRequest` | Register URL redirect rules |
| `storage` | Persist settings and instance cache locally |
| `alarms` | Refresh instance lists hourly |
| Host: `api.invidious.io` | Fetch Invidious instance list |
| Host: `raw.githubusercontent.com` | Fetch Redlib instance list |

No `tabs`, `history`, `cookies`, `webRequest`, or broad host permissions are requested.

---

## Known limitations

- **Timestamps and playlist context on watch pages are not forwarded.** When redirecting a YouTube watch URL, only the video ID (`v=`) is preserved. Timestamps (`t=`) and playlist context (`list=`) are stripped. This is intentional — it avoids forwarding unnecessary URL data and keeps the DNR rules simple.
- **Reddit query parameters are not forwarded.** Sort order (`?sort=new`) and pagination tokens are dropped. The path (subreddit, post, user) is always preserved.
- **Instance randomisation is per-session, not per-visit.** The same instance is used for the duration of a browser session (rotated on startup and hourly). This means within a session you always land on the same instance, which is better for consistency (saved preferences, watch history on that instance) but less random than per-visit selection.

---

## License

MIT
