/* ══════════════════════════════════════════════════════════════════════
   store.js — chrome.storage.local wrapper (async).

   Layout:
     settings            → global (one key)
     page:<normPath>      → per-page annotations { highlights, pins }

   Also mirrors a tiny synchronous cache into page-origin localStorage
   (`pr.enabled`, `pr.paper`) that boot.js reads at document_start. The
   source of truth is chrome.storage; the mirror only avoids a boot flash.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  const area = () =>
    (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
      ? chrome.storage.local : null;

  function get(key) {
    return new Promise((res) => {
      const a = area();
      if (!a) { res(null); return; }
      try {
        a.get(key, (obj) => res(obj && obj[key] !== undefined ? obj[key] : null));
      } catch (e) { res(null); }
    });
  }

  function set(key, value) {
    return new Promise((res) => {
      const a = area();
      if (!a) { res(); return; }
      try { a.set({ [key]: value }, () => res()); } catch (e) { res(); }
    });
  }

  function remove(key) {
    return new Promise((res) => {
      const a = area();
      if (!a) { res(); return; }
      try { a.remove(key, () => res()); } catch (e) { res(); }
    });
  }

  // Per-page key, normalised to the pathname (query/hash dropped, lowercased),
  // e.g. page:/i.1.htm — shared by www. and non-www. hosts.
  function pageKey() {
    let p = location.pathname || '/';
    return 'page:' + p.toLowerCase();
  }

  // Synchronous boot cache for boot.js (document_start).
  function mirror(obj) {
    try {
      const ls = window.localStorage;
      if ('enabled' in obj) ls.setItem('pr.enabled', obj.enabled ? '1' : '0');
      if ('paper' in obj && obj.paper) ls.setItem('pr.paper', obj.paper);
    } catch (e) { /* storage blocked */ }
  }

  function onChanged(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') cb(changes);
      });
    }
  }

  PR.store = { get, set, remove, pageKey, mirror, onChanged };
})();
