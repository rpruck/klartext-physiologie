/* ══════════════════════════════════════════════════════════════════════
   store.js — chrome.storage.local wrapper (async).

   Layout:
     settings            → global (one key)
     page:<normPath>      → per-page record (see PR.page below)

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

  /* ── the page record ────────────────────────────────────────────────────
     One object under page:<path>, shared by every module that persists
     something about THIS page (tools' highlights/pins, outline's open
     sections, progress' read marks and bookmarks). It has to be one record
     with one writer: each module used to write the whole key, so the last
     one to save would drop what the others had put there.
       highlights  [ … ]   marks + notes          (tools.js)
       pins        [ … ]   docked figures          (tools.js)
       open        [ id ]  expanded sections       (outline.js)
       read        { id: fraction }                (progress.js)
       marks       [ … ]   manual bookmarks        (progress.js)
       auto        { … }   "where I left off"      (progress.js) */
  const REC = { highlights: [], pins: [], open: null, read: {}, marks: [], auto: null };
  let pageTimer = null;

  async function pageLoad() {
    const stored = await get(pageKey());
    Object.assign(REC, stored || {});
    // A record written before these fields existed comes back without them.
    REC.highlights = REC.highlights || [];
    REC.pins = REC.pins || [];
    REC.read = REC.read || {};
    REC.marks = REC.marks || [];
    return REC;
  }
  // Debounced whole-record write — rapid edits (drag-resize, reorder, a
  // scroll advancing the read mark) collapse into one storage round-trip.
  function pageSave() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => set(pageKey(), REC), 120);
  }

  PR.page = { load: pageLoad, save: pageSave, rec: REC };
})();
