/**
 * content/redirect.js — Switcheroo navigation redirect
 *
 * Runs at document_start on all service source domains. Reads the current
 * instance from chrome.storage.local, delegates URL transformation to each
 * service's transformUrl() method, and redirects if a match is found.
 *
 * Using window.stop() + window.location.replace() avoids a history entry
 * and stops any partial page load before the redirect fires.
 */

import { youtubeService } from '../services/youtube.js';
import { redditService }  from '../services/reddit.js';
import { imgurService }   from '../services/imgur.js';
import { tiktokService }  from '../services/tiktok.js';
import { scribeService }  from '../services/scribe.js';

const SERVICES = [youtubeService, redditService, imgurService, tiktokService, scribeService];

(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) return;

  const href = window.location.href;

  for (const svc of SERVICES) {
    const s = settings[svc.id];
    if (!s?.enabled || !s?.currentInstance) continue;

    // Per-service URL allowlist: if the current URL starts with any excluded
    // prefix, skip redirection for this service. Prefixes are matched verbatim
    // (e.g. "https://www.youtube.com/feed/subscriptions").
    if (Array.isArray(s.excludedUrls) && s.excludedUrls.length > 0) {
      if (s.excludedUrls.some(p => p && href.startsWith(p))) continue;
    }

    const redirectUrl = svc.transformUrl(href, s.currentInstance);
    if (redirectUrl && redirectUrl !== href) {
      window.stop();
      window.location.replace(redirectUrl);
      return;
    }
  }
})();
