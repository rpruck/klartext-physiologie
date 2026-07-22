/* ══════════════════════════════════════════════════════════════════════
   inspect.js — the original, beside the reskin.

   reskin.js is lossy by design: it infers structure from computed font sizes,
   image filenames and glyph dimensions, and then mountReader() wipes the body.
   Every heuristic in it was arrived at by reading the source markup next to the
   rendered result — which until now meant a second window with the extension
   switched off, hand-scrolled to the same place in 825 KB of <font> soup.

   Arm the topbar button, point at a block, click: the original opens in a
   movable, resizable window already scrolled to the markup that made it. The
   window is deliberately smaller than the screen and the picker stays armed, so
   the intended posture is side by side — shrink it to one half and walk down
   the column, block by block.

   The mapping is reskin.js's provenance stamp: ord() numbers each source
   element the walk consults, the number rides token → line → block → rendered
   element as data-pr-o, and mountReader serialises the stamped markup. Here
   that is one closest() and one querySelector. Blocks with no source at all
   (the crumb, the synthesised pager pills, the home hero) fall back to the
   nearest stamped block above them.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  const PEEK = 80;              // of the window must stay reachable, as for pins
  const MIN_W = 320, MIN_H = 200;
  const $ = (s) => (PR.ui && PR.ui.shadow) ? PR.ui.shadow.querySelector(s) : null;
  /* The book is served in QUIRKS mode — its HTML 4.0 Transitional doctype
     carries no system identifier, so every page is BackCompat. There
     `documentElement.clientHeight` is the height of the whole DOCUMENT (10 616px
     on X.1), not the viewport, and a window sized off it opened seven screens
     tall. document.scrollingElement is <body> in quirks and <html> in standards
     and answers with the viewport in both — scrollbar excluded, which is what
     the clamping wants (a strip under the scrollbar is not a strip). The dev
     harness emits its own <!doctype html>, which is exactly why this never
     showed up there. */
  const vp = () => document.scrollingElement || document.documentElement;
  const vw = () => vp().clientWidth || window.innerWidth;
  const vh = () => vp().clientHeight || window.innerHeight;

  let reader = null, armed = false, open = false;
  let win = null, frame = null, rule = null, hints = null, btn = null;
  let hit = null;               // the block under the pointer, while armed
  let loaded = false, want = null;   // ordinal queued until the iframe is up
  let geo = null;

  /* ── geometry ─────────────────────────────────────────────────────────
     Persisted under its own storage key, not in `settings` — where a window
     sits is a workspace position, not something the Einstellungen panel should
     have an opinion about. Clamped like a pin: any position is allowed that
     leaves PEEK of the frame on screen, measured against clientWidth so a strip
     under the scrollbar doesn't count. */
  // Centred, and short enough that the corner handle is plainly on screen: at
  // 85% of the height it sat past the fold on a laptop and the one control that
  // makes the window smaller was the one you couldn't reach.
  const defaultGeo = () => {
    const w = Math.round(vw() * 0.9), h = Math.round(vh() * 0.7);
    return { w, h, x: Math.round((vw() - w) / 2), y: Math.round((vh() - h) / 2) };
  };
  // Horizontally the window may be parked past an edge, as a pin may — PEEK of
  // it is enough to get it back. Vertically it may not: the resize handle is in
  // the bottom corner, and a window whose bottom is off screen can only be made
  // bigger. So the height never exceeds the viewport and the whole frame stays
  // between the two edges.
  const EDGE = 8;
  function clamp(g) {
    const w = Math.max(MIN_W, Math.min(vw(), g.w));
    const h = Math.max(MIN_H, Math.min(vh() - 2 * EDGE, g.h));
    return {
      w, h,
      x: Math.max(PEEK - w, Math.min(vw() - PEEK, g.x)),
      y: Math.max(EDGE, Math.min(vh() - h - EDGE, g.y)),
    };
  }
  function applyGeo() {
    geo = clamp(geo);
    win.style.width = geo.w + 'px'; win.style.height = geo.h + 'px';
    win.style.left = geo.x + 'px'; win.style.top = geo.y + 'px';
  }
  const persist = () => PR.store && PR.store.set('inspect', geo);

  /* ── the source window ────────────────────────────────────────────────────
     Loaded from a blob: URL, NOT srcdoc. An iframe srcdoc document never enters
     quirks mode — the parser skips the doctype's mode-setting step for it
     entirely — so the book, which is quirks on every page, would be laid out
     here under rules it has never once been laid out under. A blob: URL is
     parsed like any other document and honours the doctype the snapshot
     carries. It inherits this page's origin, so contentDocument stays reachable
     for the marker and the scrolling. */
  const EMPTY = '<!doctype html><p style="font:14px sans-serif;padding:2rem">Kein Original gespeichert.</p>';

  function ensureFrame() {
    if (frame) return;
    const snap = (PR.reskin && PR.reskin.snapshot && PR.reskin.snapshot()) || EMPTY;
    frame = document.createElement('iframe');
    frame.className = 'insp-frame';
    frame.setAttribute('title', 'Originalquelltext');
    frame.addEventListener('load', onFrameLoad);
    try {
      const url = URL.createObjectURL(new Blob([snap], { type: 'text/html;charset=utf-8' }));
      frame.dataset.blob = url;
      frame.src = url;
    } catch (e) {
      frame.srcdoc = snap;                   // no Blob/URL: standards mode, but readable
    }
    win.querySelector('.insp-body').appendChild(frame);
  }

  function onFrameLoad() {
    // A blob whose origin we cannot reach into would leave the window showing
    // the page but never marking anything. Fall back once to srcdoc, which is
    // always same-origin — the wrong rendering mode beats a dead window.
    let reachable = false;
    try { reachable = !!frame.contentDocument; } catch (e) { reachable = false; }
    const url = frame.dataset.blob;
    if (url) { URL.revokeObjectURL(url); delete frame.dataset.blob; }
    if (!reachable) {
      frame.removeEventListener('load', onFrameLoad);
      const snap = (PR.reskin && PR.reskin.snapshot && PR.reskin.snapshot()) || EMPTY;
      frame.addEventListener('load', onFrameLoad, { once: true });
      frame.removeAttribute('src');
      frame.srcdoc = snap;
      return;
    }
    loaded = true;
    if (want != null) { goto(want); want = null; }
  }

  // Move the marker and scroll — never re-render. A second pick must keep
  // whatever the reader has scrolled to in the source, not throw it away.
  function goto(o) {
    if (!loaded) { want = o; return; }
    let doc = null;
    try { doc = frame.contentDocument; } catch (e) { return; }
    if (!doc) return;
    doc.querySelectorAll('.pr-o-hit').forEach((e) => e.classList.remove('pr-o-hit'));
    const target = o == null ? null : doc.querySelector('[data-pr-o="' + o + '"]');
    if (!target) { doc.defaultView.scrollTo(0, 0); return; }
    // A block often begins at something with no size worth flashing: the 12×12
    // dot the author sets in front of every "Abbildung:" caption, an empty
    // <a name>, the stray one-letter <font> behind the "NNach" typo. Grow to the
    // first ancestor that has a shape — but only from a glyph-sized target, so a
    // narrow table cell is still marked as itself.
    let mark = target;
    for (let i = 0; i < 3 && mark.parentElement && mark.parentElement !== doc.body; i++) {
      const r = mark.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 8) break;
      mark = mark.parentElement;
    }
    // Re-adding the class must restart the flash, and it won't while the class
    // is still on the element from the pick before.
    mark.classList.remove('pr-o-hit');
    void mark.offsetWidth;
    mark.classList.add('pr-o-hit');
    mark.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function show() {
    if (!open) {
      open = true;
      // The window lands under the cursor, so there is nothing hovered any
      // more — left up, the rule of the block you just picked sits behind it.
      drawRule(null);
      ensureFrame();
      win.classList.add('show');
      hints.classList.add('show');
      hints.classList.remove('dim');
      clearTimeout(show.t);
      // States itself once, then gets out of the way — it is a reminder, not a
      // control, and it sits over the reader you came here to look at.
      show.t = setTimeout(() => hints.classList.add('dim'), 6000);
      applyGeo();
    }
  }
  function hide() {
    open = false;
    win.classList.remove('show');
    hints.classList.remove('show');
    disarm();
  }

  /* ── the picker ───────────────────────────────────────────────────────── */
  function blockAt(node) {
    if (!node || !node.closest) return null;
    const el = node.closest('[data-pr-o]');
    if (el && reader.contains(el)) return el;
    // Synthetic blocks (crumb, pager pills, the home hero) carry no stamp of
    // their own — answer with the nearest stamped block above them instead of
    // nothing, so the picker never goes dead over a stretch of the page. Walked
    // backwards through siblings and up, not by scanning every stamp on the
    // page: this runs on every pointermove, and I.1 carries thousands.
    let n = node.closest('#pr-reader *');
    while (n && n !== reader) {
      for (let p = n.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.dataset.prO !== undefined) return p;
        const deep = p.querySelectorAll('[data-pr-o]');
        if (deep.length) return deep[deep.length - 1];
      }
      n = n.parentElement;
    }
    return null;
  }

  function drawRule(el) {
    hit = el || null;
    if (!el) { rule.classList.remove('show'); return; }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > vh()) { rule.classList.remove('show'); return; }
    rule.style.left = r.left + 'px';
    rule.style.top = r.top + 'px';
    rule.style.width = r.width + 'px';
    rule.classList.add('show');
  }

  const onMove = (e) => {
    if (!armed) return;
    // Over our own chrome (the window, the topbar) there is nothing to pick.
    if (PR.ui.host && e.composedPath().includes(PR.ui.host)) { drawRule(null); return; }
    drawRule(blockAt(e.target));
  };
  const onScroll = () => { if (armed && hit) drawRule(hit); };
  const onClick = (e) => {
    if (!armed) return;
    if (!e.target.closest || !e.target.closest('#pr-reader')) return;
    // The reader is full of links; while armed, a click picks and nothing else.
    e.preventDefault(); e.stopPropagation();
    show();
    // Nothing stamped anywhere is the home page's bespoke hero, which no
    // pipeline built — open the original at the top rather than doing nothing.
    const el = blockAt(e.target);
    goto(el ? +el.dataset.prO : null);
  };

  function arm() {
    if (armed) return;
    armed = true;
    document.documentElement.classList.add('pr-inspect');
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('click', onClick, true);
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    document.documentElement.classList.remove('pr-inspect');
    btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false');
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('click', onClick, true);
    drawRule(null);
  }

  /* ── drag / resize ─────────────────────────────────────────────────────
     The pin bar's idiom (tools.js): capture the pointer on the handle so the
     drag survives the cursor leaving it, and write straight to style — the
     record is saved once, on release. */
  function wireDrag() {
    const bar = win.querySelector('.insp-bar');
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, gx = geo.x, gy = geo.y;
      win.classList.add('grabbing');
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      const move = (ev) => { geo.x = gx + (ev.clientX - x0); geo.y = gy + (ev.clientY - y0); applyGeo(); };
      const up = (ev) => { bar.removeEventListener('pointermove', move); win.classList.remove('grabbing'); try { bar.releasePointerCapture(ev.pointerId); } catch (_) {} persist(); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up, { once: true });
      bar.addEventListener('pointercancel', up, { once: true });
    });

    const handle = win.querySelector('.insp-resize');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, y0 = e.clientY, w0 = geo.w, h0 = geo.h;
      win.classList.add('resizing');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      const move = (ev) => { geo.w = w0 + (ev.clientX - x0); geo.h = h0 + (ev.clientY - y0); applyGeo(); };
      const up = (ev) => { handle.removeEventListener('pointermove', move); win.classList.remove('resizing'); try { handle.releasePointerCapture(ev.pointerId); } catch (_) {} persist(); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
      handle.addEventListener('pointercancel', up, { once: true });
    });
  }

  /* ── screenshot hints ─────────────────────────────────────────────────
     The point of a side-by-side is usually to capture it, and every OS spells
     that differently. macOS gets the clipboard variant spelled out too: the
     modifier that turns "to a file on the Desktop" into "to the clipboard" is
     the one nobody remembers. */
  function shortcuts() {
    const p = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
    if (/mac|iphone|ipad/i.test(p)) {
      return [['⇧⌘4', 'Ausschnitt als Datei'], ['⌃⇧⌘4', 'Ausschnitt in die Zwischenablage'], ['⇧⌘5', 'Optionen & Fenster']];
    }
    if (/win/i.test(p)) {
      return [['Win+Umschalt+S', 'Ausschnitt in die Zwischenablage'], ['Win+Druck', 'Bildschirm als Datei']];
    }
    return [['Umschalt+Druck', 'Ausschnitt aufnehmen'], ['Druck', 'Bildschirm aufnehmen']];
  }

  /* ── init ──────────────────────────────────────────────────────────────── */
  async function init(root) {
    reader = root || document.getElementById('pr-reader');
    btn = $('#inspectBtn'); win = $('#inspectWin'); rule = $('#inspectRule'); hints = $('#inspectHints');
    if (!btn || !win || !reader) return;

    hints.innerHTML = '<span class="ih-title">Bildschirmfoto</span>' +
      shortcuts().map(([k, t]) => '<span class="ih-row"><kbd>' + k + '</kbd>' + t + '</span>').join('');

    // A record written while the quirks bug was live holds a height of several
    // thousand pixels — a size no drag on this screen could have produced. If
    // what was stored doesn't fit the screen it was never a choice, so take the
    // default rather than clamping a number the user never picked.
    const stored = PR.store ? await PR.store.get('inspect') : null;
    const fits = stored && stored.w <= vw() && stored.h <= vh();
    geo = clamp(Object.assign(defaultGeo(), fits ? stored : {}));

    // The button is the way out as well as the way in — hunting for the ✕ at a
    // corner of a window you just dragged somewhere is not a way out.
    btn.onclick = () => { if (open) hide(); else if (armed) disarm(); else arm(); };
    win.querySelector('.insp-close').onclick = hide;
    // Back to the size it opens at, for when a session of half-width comparison
    // is over and you just want to read the source.
    win.querySelector('.insp-full').onclick = () => { geo = defaultGeo(); applyGeo(); persist(); };
    wireDrag();
    window.addEventListener('resize', () => { if (open) applyGeo(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (open) hide(); else if (armed) disarm();
    });
  }

  PR.inspect = { init, arm, disarm, isArmed: () => armed, isOpen: () => open };
})();
