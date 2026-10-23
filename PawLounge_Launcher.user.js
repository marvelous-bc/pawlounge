// ==UserScript==
// @name         BC PawLounge — Automatic Update Launcher
// @namespace    https://github.com/marvelous-bc/kittychat/launcher
// @homepageURL  https://github.com/marvelous-bc/pawlounge
// @supportURL   https://github.com/marvelous-bc/pawlounge/issues
// @version      1.3.0
// @description  Fetch a fresh, uncached PawLounge build from GitHub whenever Bondage Club loads.
// @author       marvelous-bc
// @match        *://bondageprojects.elementfx.com/*
// @match        *://www.bondageprojects.elementfx.com/*
// @match        *://*.bondageprojects.elementfx.com/*
// @match        *://bondageprojects.com/*
// @match        *://www.bondageprojects.com/*
// @match        *://*.bondageprojects.com/*
// @match        *://bondage-europe.com/*
// @match        *://www.bondage-europe.com/*
// @match        *://bondage-asia.com/*
// @match        *://www.bondage-asia.com/*
// @match        *://*.bondage-asia.com/*
// @inject-into  page
// @run-at       document-end
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // Keep the namespace and internal "KittyChat" globals to avoid duplicate
  // userscript installations and to preserve PawLounge's stored user data.
  const REPO = 'marvelous-bc/pawlounge';
  const FILE = 'KittyChat.user.js';
  const PRIMARY_URL = `https://raw.githubusercontent.com/${REPO}/main/${FILE}`;
  const BACKUP_URL = `https://raw.githubusercontent.com/${REPO}/refs/heads/main/${FILE}`;
  const MIN_VERSION = '0.8.7'; // Never run an older release from a stale CDN edge.
  const FETCH_TIMEOUT_MS = 15000;
  const STATUS_KEY = '__KittyChatLauncher';

  if (window[STATUS_KEY]?.started) return;
  const status = {
    started: Date.now(),
    launcherVersion: '1.3.0',
    phase: 'starting',
    sourceUrl: PRIMARY_URL,
    cachePolicy: 'always-network-no-store',
    minimumVersion: MIN_VERSION,
    requestCount: 0,
    lastRequestUrl: '',
    receivedVersion: '',
    loadedVersion: '',
    errors: [],
    error: '',
    finished: 0
  };
  window[STATUS_KEY] = status;
  window.KittyChatLauncherDiag = window.PawLoungeLauncherDiag = () => ({
    ...status, errors: [...status.errors]
  });

  const versionOf = s => String(s || '').match(/^\d+(?:\.\d+){1,3}$/)?.[0] || '';
  const compare = (a, b) => {
    const av = a.split('.').map(Number), bv = b.split('.').map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const diff = (av[i] || 0) - (bv[i] || 0);
      if (diff) return Math.sign(diff);
    }
    return 0;
  };

  // Even CDNs caching the base URL cannot reuse a previously requested URL.
  // Avoid localStorage, IndexedDB, sessionStorage and cached source fallbacks.
  function freshUrl(url) {
    const nonce = Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2) + '-' + status.requestCount;
    return url + (url.includes('?') ? '&' : '?') + 'pawlounge_fresh=' + nonce;
  }

  function hideError() {
    document.getElementById('pawlounge-launcher-error')?.remove();
    document.getElementById('kittychat-launcher-error')?.remove();
  }

  function showError(message) {
    status.phase = 'failed';
    status.error = String(message || 'Unknown launcher error').slice(0, 480);
    status.finished = Date.now();
    console.error('[PawLounge Launcher]', status.error);
    const paint = () => {
      if (!document.body) return;
      hideError();
      const toast = document.createElement('div');
      toast.id = 'pawlounge-launcher-error';
      toast.style.cssText = 'position:fixed;right:15px;bottom:20px;z-index:2147483647;max-width:360px;background:#32142e;color:#ffe3f0;border:2px solid #f789bb;border-radius:15px;padding:13px 14px;font:13px/1.5 system-ui;box-shadow:0 8px 30px #0009';
      const label = document.createElement('div');
      label.textContent = 'PawLounge: ' + status.error;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry fresh download';
      retry.style.cssText = 'margin-top:8px;background:#ed92bf;color:#28102c;border:0;border-radius:9px;padding:7px 10px;font:600 12px system-ui;cursor:pointer';
      retry.addEventListener('click', () => { void run(); });
      toast.append(label, retry);
      document.body.appendChild(toast);
    };
    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint, { once: true });
  }

  function validateSource(source) {
    source = String(source || '').replace(/^\uFEFF/, '');
    if (source.length < 15000 || source.length > 3000000 ||
        !source.startsWith('// ==UserScript==')) {
      throw new Error('GitHub did not return the full PawLounge userscript.');
    }
    if (!/^\/\/\s*@namespace\s+https:\/\/github\.com\/marvelous-bc\/(?:kittychat|pawlounge)\s*$/m.test(source) ||
        !/^\/\/\s*@name\s+BC (?:PawLounge|Kittychat)\s*$/m.test(source) ||
        !source.includes('window.KittyChat')) {
      throw new Error('GitHub response failed PawLounge identity checks.');
    }
    const version = versionOf(source.match(/^\/\/\s*@version\s+(\S+)\s*$/m)?.[1]);
    if (!version) throw new Error('Published PawLounge has no valid version header.');
    status.receivedVersion = version;
    if (compare(version, MIN_VERSION) < 0) {
      throw new Error(`GitHub returned stale v${version} (minimum v${MIN_VERSION}).`);
    }
    return { source, version };
  }

  async function getFreshSource(base) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const url = freshUrl(base);
    status.requestCount++;
    status.lastRequestUrl = url;
    try {
      // cache:no-store bypasses the browser's HTTP cache entirely. Every run
      // also uses a unique URL to avoid stale intermediaries/CDN entries.
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      if (new URL(response.url).hostname !== 'raw.githubusercontent.com') {
        throw new Error('Unexpected response origin.');
      }
      const claimedLength = Number(response.headers.get('content-length') || 0);
      if (claimedLength > 3000000) throw new Error('Unexpectedly large userscript.');
      return validateSource(await response.text());
    } finally {
      clearTimeout(timeout);
    }
  }

  let running = false;
  async function run() {
    if (running || status.phase === 'loaded') return;
    if (window.KittyChat?.version) {
      showError(`PawLounge v${window.KittyChat.version} is already running. Disable its standalone userscript and any older launcher, then reload BC.`);
      return;
    }
    running = true;
    hideError();
    status.error = '';
    status.errors = [];
    status.receivedVersion = '';
    status.phase = 'fetching';
    try {
      let result;
      // Try a fresh primary URL, then a different canonical GitHub path.
      // Never execute a cached fallback script or silently downgrade.
      for (const endpoint of [PRIMARY_URL, BACKUP_URL]) {
        try {
          result = await getFreshSource(endpoint);
          break;
        } catch (error) {
          const detail = error?.name === 'AbortError'
            ? 'download timed out' : String(error?.message || error);
          status.errors.push(detail);
          console.warn('[PawLounge Launcher] Fresh fetch attempt failed:', detail);
        }
      }
      if (!result) {
        showError('Could not download a current PawLounge build. ' +
          status.errors.join(' | ') + ' See PawLoungeLauncherDiag().');
        return;
      }
      if (window.KittyChat?.version ||
          window.KittyChatBootDiag?.().phase === 'injected') {
        showError('Another copy started while downloading. Disable any standalone PawLounge and older launchers.');
        return;
      }
      status.phase = 'executing';
      // Runs inside the BC page world so base-game globals remain accessible.
      (0, eval)(result.source + '\n//# sourceURL=PawLounge-GitHub.user.js\n');
      status.loadedVersion = result.version;
      status.phase = 'loaded';
      status.finished = Date.now();
      console.info(`[PawLounge Launcher] Fresh network load completed: PawLounge v${result.version} (${status.requestCount} request(s)).`);
    } catch (error) {
      showError(`PawLounge downloaded but could not execute (${error?.message || error}).`);
    } finally {
      running = false;
    }
  }

  // Optional manual retry after an error; still never reloads the whole game
  // or re-executes an already loaded plugin.
  window.PawLoungeLauncherRetry = () => { void run(); };
  void run(); // Runs on EVERY BC page load, including hard refresh.
})();
