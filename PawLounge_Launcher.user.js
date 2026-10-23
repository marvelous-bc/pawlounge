// ==UserScript==
// @name         BC PawLounge — Automatic Update Launcher
// @namespace    https://github.com/marvelous-bc/kittychat/launcher
// @homepageURL  https://github.com/marvelous-bc/pawlounge
// @supportURL   https://github.com/marvelous-bc/pawlounge/issues
// @version      1.2.0
// @description  Always load the newest PawLounge (formerly Kittychat) from GitHub on each BC load.
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

  // New home: marvelous-bc/pawlounge. Publish KittyChat.user.js to MAIN.
  // Keep this new URL stable for future releases; no repeated launcher edits.
  const SOURCE_URL = 'https://raw.githubusercontent.com/marvelous-bc/pawlounge/main/KittyChat.user.js';
  // Prevent loading an outdated copy from the new repository during migration.
  const MIN_VERSION = '0.8.1';
  const TIMEOUT_MS = 15000;
  const STATUS_KEY = '__KittyChatLauncher';

  // This launcher intentionally has no automatic hot-swap. It updates safely
  // on the NEXT BC page load, without reinstalling a running addon.
  if (window[STATUS_KEY]?.started) return;
  const status = {
    started: Date.now(), phase: 'starting', launcherVersion: '1.2.0',
    sourceUrl: SOURCE_URL, minimumVersion: MIN_VERSION,
    loadedVersion: '', error: '', finished: 0
  };
  window[STATUS_KEY] = status;
  window.KittyChatLauncherDiag = () => ({ ...status });

  const parseVersion = version => String(version || '').match(/^\d+(?:\.\d+){1,3}$/)?.[0] || '';
  const compareVersions = (a, b) => {
    const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aa.length, bb.length); ++i) {
      const diff = (aa[i] || 0) - (bb[i] || 0);
      if (diff) return Math.sign(diff);
    }
    return 0;
  };
  function showError(message) {
    status.phase = 'failed';
    status.error = String(message || 'Unknown error').slice(0, 350);
    status.finished = Date.now();
    console.error('[PawLounge Launcher]', status.error);
    const paint = () => {
      if (!document.body || document.getElementById('kittychat-launcher-error')) return;
      const toast = document.createElement('div');
      toast.id = 'kittychat-launcher-error';
      toast.style.cssText = 'position:fixed;right:15px;bottom:20px;z-index:2147483647;max-width:350px;background:#32142e;color:#ffe3f0;border:2px solid #f789bb;border-radius:15px;padding:13px 14px;font:13px/1.5 system-ui;box-shadow:0 8px 30px #0009';
      toast.textContent = 'PawLounge launcher: ' + status.error + ' Check KittyChatLauncherDiag() in the browser console.';
      document.body.appendChild(toast);
    };
    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint, { once: true });
  }
  async function run() {
    if (window.KittyChat?.version) {
      status.phase = 'existing-installation';
      status.error = `Standalone PawLounge ${window.KittyChat.version} is already running. Disable its userscript; only keep the launcher enabled.`;
      showError(status.error);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let source;
    try {
      status.phase = 'fetching';
      const url = SOURCE_URL + '?kittychat_update=' + Date.now();
      const response = await fetch(url, {
        method: 'GET', cache: 'no-store', mode: 'cors', credentials: 'omit',
        redirect: 'error', signal: controller.signal,
        headers: { Accept: 'text/plain' }
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 3_000_000) throw new Error('Published Kittychat file is unexpectedly large.');
      source = await response.text();
    } catch (error) {
      showError(error?.name === 'AbortError'
        ? 'GitHub download timed out. Please reload BC when connected.'
        : `Could not download PawLounge from GitHub (${error?.message || error}).`);
      return;
    } finally {
      clearTimeout(timeout);
    }

    // This is remote executable code: refuse redirects, missing/corrupt files,
    // wrong repositories and accidentally published old versions.
    if (source.length < 15_000 || source.length > 3_000_000 || !source.startsWith('// ==UserScript==')) {
      showError('GitHub did not return a complete PawLounge userscript.');
      return;
    }
    if (!/^\/\/\s*@namespace\s+https:\/\/github\.com\/marvelous-bc\/(?:kittychat|pawlounge)\s*$/m.test(source) ||
        !/^\/\/\s*@name\s+BC (?:PawLounge|Kittychat)\s*$/m.test(source) ||
        !source.includes('window.KittyChat')) {
      showError('GitHub file did not pass PawLounge identity checks.');
      return;
    }
    const match = source.match(/^\/\/\s*@version\s+(\S+)\s*$/m);
    const version = parseVersion(match?.[1]);
    if (!version) {
      showError('GitHub PawLounge file has no valid version number.');
      return;
    }
    if (compareVersions(version, MIN_VERSION) < 0) {
      showError(`GitHub hosts PawLounge ${version}, but the launcher requires ${MIN_VERSION} or newer. Upload KittyChat.user.js (v0.8.1+) to pawlounge/main.`);
      return;
    }
    // Avoid accidental double injection when an old standalone copy is installed.
    if (window.KittyChat?.version || window.KittyChatBootDiag?.().phase === 'injected') {
      showError('Another PawLounge/Kittychat copy started while downloading. Disable the standalone copy.');
      return;
    }
    try {
      status.phase = 'executing';
      // @grant none + @inject-into page keeps BC's native JS globals available.
      // Indirect eval runs the main addon in the same page world.
      (0, eval)(source + '\n//# sourceURL=KittyChat-GitHub.user.js\n');
      status.loadedVersion = version;
      status.phase = 'loaded';
      status.finished = Date.now();
      console.info(`[PawLounge Launcher] Started PawLounge ${version} from GitHub.`);
    } catch (error) {
      showError(`PawLounge ${version} downloaded but could not execute (${error?.message || error}).`);
    }
  }
  void run();
})();
