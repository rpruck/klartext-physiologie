/* ══════════════════════════════════════════════════════════════════════
   visited.js — "have I read this?" markers.

   The book is 200+ pages of near-identical index entries, and the browser's
   own :visited styling is both stripped by the reskin and unstylable beyond
   a colour swap. So we keep our own record (chrome.storage.local, key
   `visited`) of every page opened with the reskin on, and tag links pointing
   at those pages with `.pr-seen` — content.css does the rest.

   Keyed by lowercased pathname, exactly like store.pageKey(), so www. and
   non-www. share one record.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  const KEY = 'visited';
  const CAP = 500;                       // the whole book is ~200 pages; a cap
                                         // just stops a runaway record growing
  const path = (p) => (p || '/').toLowerCase();

  // Record this page, prune the oldest entries if the record ever overflows.
  async function record(seen) {
    const here = path(location.pathname);
    seen[here] = Date.now();
    const keys = Object.keys(seen);
    if (keys.length > CAP) {
      keys.sort((a, b) => seen[a] - seen[b])
          .slice(0, keys.length - CAP)
          .forEach((k) => { delete seen[k]; });
    }
    await PR.store.set(KEY, seen);
  }

  // Tag every link that points at a page already read. Same-page links (the
  // in-page anchor lists) are skipped — "you are here" isn't "you've read it".
  function tag(root, seen) {
    root.querySelectorAll('a[href]').forEach((a) => {
      let u;
      // a.href, not the attribute — already resolved, and honours any <base>.
      try { u = new URL(a.href); } catch (e) { return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (!/(^|\.)physiologie\.cc$/i.test(u.hostname)) return;
      const p = path(u.pathname);
      if (p === path(location.pathname)) return;
      if (seen[p]) a.classList.add('pr-seen');
    });
  }

  async function apply(root) {
    if (!PR.store || !root) return;
    const seen = (await PR.store.get(KEY)) || {};
    tag(root, seen);
    await record(seen);
  }

  // Forget everything (Einstellungen → "Gelesenes vergessen"). Strips the
  // markers from the open page too, so the panel's effect is visible at once —
  // this page re-records itself on its next load, not now.
  async function clear() {
    if (!PR.store) return;
    await PR.store.remove(KEY);
    document.querySelectorAll('#pr-reader a.pr-seen').forEach((a) => a.classList.remove('pr-seen'));
  }

  PR.visited = { apply, tag, record, clear };
})();
