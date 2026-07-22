/* ══════════════════════════════════════════════════════════════════════
   ui.js — the injected UI chrome, isolated in one Shadow DOM.

   A single host on <html> (sibling of <body>) carries a full-viewport,
   pointer-events:none overlay; each control re-enables pointer events so the
   reader underneath stays selectable. ui.css (a web_accessible_resource) is
   fetched and injected into the shadow root. CSS custom properties set on
   :root by settings.apply() inherit across the boundary and theme it all.

   M5 mounts the top-right controls + settings panel. Later milestones append
   the lightbox / popover / note gutter / pin rail / context menu / toaster /
   activation overlay into the same shadow root.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});
  let host = null, shadow = null;

  /* Unicode has no bookmark that isn't an emoji (🔖 paints in colour and in the
     system's font, next to glyphs drawn in ours), so the ribbon is a path — and
     the list beside it is drawn to the same weight rather than borrowed from
     ☰/≡, which sit on a different baseline in every fallback font. */
  const RIBBON = `<svg class="tb-glyph" viewBox="0 0 10 13" aria-hidden="true"><path d="M1 1.6h8v10.2l-4-3-4 3z"/></svg>`;
  const LIST = `<svg class="tb-glyph tb-glyph-list" viewBox="0 0 13 10" aria-hidden="true"><path d="M1 1.4h11M1 5h11M1 8.6h7"/></svg>`;
  /* The source glyph. Drawn rather than typed for the same reason as the two
     above: ⟨/⟩ assembled from characters sits on three different baselines
     depending on which fallback font answers for the chevrons. */
  const SOURCE = `<svg class="tb-glyph tb-glyph-src" viewBox="0 0 14 11" aria-hidden="true"><path d="M4.7 2.2 1.6 5.5l3.1 3.3M9.3 2.2l3.1 3.3-3.1 3.3M8.1 1.2 5.9 9.8"/></svg>`;

  /* The icon buttons say what they do on hover (data-tip), not in the bar —
     three words of German each would crowd out the two labelled controls.
     Setting a bookmark and reading the book's bookmarks back are two halves of
     one thing, so they are two halves of one pill. */
  const TOPBAR = `
    <div id="pr-topbar" part="topbar">
      <button class="tb-btn tb-icon" id="unpinAll" hidden data-tip="Alle Abbildungen lösen" aria-label="Alle Abbildungen lösen">⊘</button>
      <button class="tb-btn tb-icon" id="laneImg" data-tip="Bildspalte" aria-label="Bildspalte" aria-pressed="true">◧</button>
      <button class="tb-btn tb-icon" id="laneNotes" data-tip="Notizspalte" aria-label="Notizspalte" aria-pressed="true">◨</button>
      <button class="tb-btn tb-icon" id="inspectBtn" data-tip="Original ansehen" aria-label="Original ansehen" aria-pressed="false">${SOURCE}</button>
      <div class="tb-split" id="bookmarkPill">
        <button class="tb-btn tb-half" id="bookmarkBtn" data-tip="Hier ein Lesezeichen setzen" aria-label="Hier ein Lesezeichen setzen">${RIBBON}</button>
        <button class="tb-btn tb-half" id="openMarks" data-tip="Lesezeichen des Buches" aria-label="Lesezeichen des Buches">${LIST}</button>
      </div>
      <button class="tb-btn" id="openPanel">✦ Einstellungen</button>
    </div>`;

  /* The reading rail: a ruler of the page's sections down the right edge.
     progress.js fills #railTicks / #railLabels / #railMarks; everything here is
     the frame it hangs in. */
  const RAIL = `
    <aside class="pr-rail" id="pr-rail" aria-label="Lesefortschritt">
      <div class="rail-ticks" id="railTicks"></div>
      <div class="rail-labels" id="railLabels"></div>
      <div class="rail-marks" id="railMarks"></div>
      <div class="rail-foot">
        <span class="rail-pct" id="railPct">0 %</span>
        <button class="rail-reset" id="railReset" data-label="↺ Zurücksetzen">↺ Zurücksetzen</button>
      </div>
    </aside>`;

  // Left pin rail (figures docked to the margin) + lightbox + undo toaster.
  const PINRAIL = `<aside class="pr-pin-rail empty" id="pinRail" aria-label="Angeheftete Abbildungen"></aside>`;
  const LIGHTBOX = `
    <div class="lightbox" id="lightbox">
      <div class="lb-tools">
        <button id="lbPin">✚ An den Rand heften</button>
        <button id="lbClose">✕ Schließen</button>
      </div>
      <figure><img id="lbImg" alt=""><figcaption id="lbCap"></figcaption></figure>
      <div class="lb-zoom">
        <button id="lbZoomOut" title="Verkleinern">−</button>
        <button id="lbZoomPct" title="Zurücksetzen">100 %</button>
        <button id="lbZoomIn" title="Vergrößern">+</button>
      </div>
    </div>`;
  const TOASTER = `<div class="toaster" id="toaster" aria-live="polite"></div>`;

  /* The source window: a hairline rule that follows the pointer while the
     picker is armed, the movable frame the original renders in, and the
     screenshot reminder that hangs in the opposite corner from it. No backdrop
     — the whole point is that the reader stays visible and clickable beside it.
     inspect.js fills #inspectHints and appends the iframe. */
  const INSPECT = `
    <div class="insp-rule" id="inspectRule"><span class="insp-rule-tag">Original</span></div>
    <aside class="insp-win" id="inspectWin" aria-label="Originalquelltext">
      <div class="insp-bar">
        <span class="spacer"></span>
        <span class="insp-title">Original</span>
        <button class="insp-full" title="Ursprüngliche Größe" aria-label="Ursprüngliche Größe">⤢</button>
        <button class="insp-close" title="Schließen" aria-label="Schließen">✕</button>
      </div>
      <div class="insp-body"></div>
      <div class="insp-resize" aria-hidden="true"></div>
    </aside>
    <div class="insp-hints" id="inspectHints"></div>`;

  // Right note gutter + text-selection popover (highlight colours + note).
  const NOTEGUTTER = `<aside class="pr-note-gutter" id="noteGutter" aria-label="Randnotizen"></aside>`;
  const HLPOP = `
    <div class="hl-pop" id="hlPop">
      <span class="sw" data-color="teal" title="Türkis"></span>
      <span class="sw" data-color="amber" title="Gelb"></span>
      <span class="sw" data-color="rose" title="Rosa"></span>
      <span class="sw" data-color="underline" title="Unterstreichen"></span>
      <span class="divider"></span>
      <button class="act" data-act="note">✎ Notiz</button>
    </div>`;

  /* The book's bookmarks, not the page's — the same drawer as Einstellungen,
     because the list is a column of three-line rows and a popover under the
     pill would have to scroll inside 30 characters of width. bookmarks.js
     fills #marksBody. */
  const MARKS = `
    <aside class="panel" id="marks" aria-label="Lesezeichen">
      <div class="panel-head">
        <h2>Lesezeichen</h2><span class="bm-count" id="marksCount"></span><span class="spacer"></span>
        <button class="panel-close" id="closeMarks" aria-label="Schließen">✕</button>
      </div>
      <div class="panel-body" id="marksBody"></div>
    </aside>`;

  const PANEL = `
    <div class="backdrop" id="backdrop"></div>
    <aside class="panel" id="panel" aria-label="Einstellungen">
      <div class="panel-head">
        <h2>Einstellungen</h2><span class="spacer"></span>
        <button class="panel-close" id="closePanel" aria-label="Schließen">✕</button>
      </div>
      <div class="panel-body">
        <div class="group">
          <span class="g-label">Schrift</span>
          <div class="field">
            <div class="f-row"><label for="proseFont">Lesefont</label></div>
            <select id="proseFont">
              <optgroup label="Serif">
                <option value="eb">EB Garamond</option>
                <option value="cmu">Computer Modern (CMU Serif)</option>
                <option value="source-serif">Source Serif 4</option>
                <option value="newsreader">Newsreader</option>
              </optgroup>
              <optgroup label="Sans-serif">
                <option value="inter">Inter</option>
                <option value="source-sans">Source Sans 3</option>
                <option value="plex-sans">IBM Plex Sans</option>
              </optgroup>
            </select>
          </div>
          <div class="field">
            <div class="f-row"><label for="labelFont">Label-/Bildtextfont</label></div>
            <select id="labelFont">
              <option value="inter-label">Inter</option>
              <option value="space-mono">Space Mono</option>
              <option value="plex-mono">IBM Plex Mono</option>
              <option value="cmu-tt">CMU Typewriter</option>
            </select>
          </div>
          <div class="field">
            <div class="f-row"><label for="noteFont">Notizfont</label></div>
            <select id="noteFont">
              <option value="inter">Inter</option>
              <option value="plex-sans">IBM Plex Sans</option>
              <option value="source-sans">Source Sans 3</option>
              <option value="eb">EB Garamond</option>
              <option value="space-mono">Space Mono</option>
            </select>
          </div>
          <div class="field">
            <div class="f-row"><label for="fs">Schriftgröße</label><span class="val" id="fsVal">19px</span></div>
            <input type="range" id="fs" min="16" max="24" step="1" value="19">
          </div>
          <div class="field">
            <div class="f-row"><label for="lh">Zeilenhöhe</label><span class="val" id="lhVal">1.68</span></div>
            <input type="range" id="lh" min="1.35" max="1.95" step="0.01" value="1.68">
          </div>
        </div>
        <div class="group">
          <span class="g-label">Layout</span>
          <div class="field">
            <div class="f-row"><label for="measure">Textbreite</label><span class="val" id="measureVal">680px</span></div>
            <input type="range" id="measure" min="540" max="880" step="10" value="680">
          </div>
          <div class="field">
            <div class="f-row"><label for="gap">Absatzabstand</label><span class="val" id="gapVal">1.00</span></div>
            <input type="range" id="gap" min="0.5" max="1.8" step="0.05" value="1.0">
          </div>
          <div class="field">
            <div class="f-row"><label>Textsatz</label></div>
            <div class="seg" id="alignSeg">
              <button data-v="left" aria-pressed="false">Linksbündig</button>
              <button data-v="justify" aria-pressed="true">Blocksatz</button>
            </div>
          </div>
        </div>
        <div class="group">
          <span class="g-label">Farbe</span>
          <div class="field">
            <div class="f-row"><label>Akzentfarbe</label></div>
            <div class="swatches" id="swatches">
              <span class="cs" data-c="#0e8373" style="background:#0e8373" title="Physio-Türkis"></span>
              <span class="cs" data-c="#3a6ea5" style="background:#3a6ea5" title="Blau"></span>
              <span class="cs" data-c="#7048c4" style="background:#7048c4" title="Violett"></span>
              <span class="cs" data-c="#b0562a" style="background:#b0562a" title="Terrakotta"></span>
              <span class="cs" data-c="#5a7d3c" style="background:#5a7d3c" title="Moos"></span>
              <input type="color" id="customColor" value="#0e8373" title="Eigene Farbe">
            </div>
          </div>
          <div class="field">
            <div class="f-row"><label>Hintergrund</label></div>
            <div class="seg" id="bgSeg">
              <button data-v="neutral" aria-pressed="true">Neutral</button>
              <button data-v="paper" aria-pressed="false">Papier</button>
              <button data-v="white" aria-pressed="false">Weiß</button>
              <button data-v="sepia" aria-pressed="false">Sepia</button>
              <button data-v="dark" aria-pressed="false">Dunkel</button>
            </div>
          </div>
        </div>
        <div class="group">
          <span class="g-label">Bilder</span>
          <div class="field toggle">
            <label for="hidedeco">Dekobilder ausblenden</label>
            <button class="sw-toggle" id="hidedeco" aria-pressed="true"></button>
          </div>
          <div class="field">
            <div class="f-row"><label>Abbildungsrahmen</label></div>
            <div class="seg" id="frameSeg">
              <button data-v="hairline" aria-pressed="true">Haarlinie</button>
              <button data-v="shadow" aria-pressed="false">Schatten</button>
              <button data-v="none" aria-pressed="false">Ohne</button>
            </div>
          </div>
        </div>
        <div class="group">
          <span class="g-label">Lesen</span>
          <div class="field toggle">
            <label for="collapse">Abschnitte einklappen</label>
            <button class="sw-toggle" id="collapse" aria-pressed="true"></button>
          </div>
          <div class="field toggle">
            <label for="rail">Fortschrittsleiste</label>
            <button class="sw-toggle" id="rail" aria-pressed="true"></button>
          </div>
          <div class="field toggle">
            <label for="progress">Gelesenes markieren</label>
            <button class="sw-toggle" id="progress" aria-pressed="true"></button>
          </div>
        </div>
        <div class="group">
          <span class="g-label">Bewegung</span>
          <div class="field toggle">
            <label for="motion">Animationen</label>
            <button class="sw-toggle" id="motion" aria-pressed="true"></button>
          </div>
        </div>
        <div class="panel-foot">
          <div class="foot-row">
            <button class="reset" id="resetBtn">↺ Zurücksetzen</button>
            <button class="reset" id="forgetBtn" data-label="• Gelesenes vergessen">• Gelesenes vergessen</button>
          </div>
          <div class="saved-note">Einstellungen &amp; Notizen werden lokal gespeichert.</div>
        </div>
      </div>
    </aside>`;

  async function loadCss() {
    try {
      const url = chrome.runtime.getURL('src/ui.css');
      /* no-cache, or an edited stylesheet keeps rendering as whatever the HTTP
         cache kept from the last session: the URL never changes across extension
         reloads, so the reload alone doesn't invalidate it. A local file. */
      const txt = await fetch(url, { cache: 'no-cache' }).then((r) => r.text());
      const style = document.createElement('style');
      style.textContent = txt;
      shadow.appendChild(style);
    } catch (e) { /* offline / test: shadow renders unstyled but functional */ }
  }

  async function mount() {
    if (host) return shadow;
    host = document.createElement('div');
    host.id = 'physio-reskin-ui';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    PR.ui.host = host;
    PR.ui.shadow = shadow;
    await loadCss();

    const root = document.createElement('div');
    root.className = 'pr-ui-root';
    // one-time activation overlay (played once per session by activate.js)
    const ACTIVATE = `<div class="activate" id="activate"></div><div class="activate-line" id="activateLine"></div>`;
    root.innerHTML = TOPBAR + RAIL + PINRAIL + NOTEGUTTER + LIGHTBOX + HLPOP + PANEL + MARKS + INSPECT + TOASTER + ACTIVATE;
    shadow.appendChild(root);
    PR.ui.root = root;

    wirePanel();
    return shadow;
  }

  /* Two drawers now hang off the same backdrop (Einstellungen · Lesezeichen),
     and they occupy the same edge — so opening either closes the other, and
     the backdrop and Escape close whatever stands open. */
  function wirePanel() {
    const $ = (s) => shadow.querySelector(s);
    const backdrop = $('#backdrop');
    const drawers = ['#panel', '#marks'].map($);
    const closeDrawer = () => {
      drawers.forEach((d) => d.classList.remove('open'));
      backdrop.classList.remove('show');
    };
    const openDrawer = (sel) => {
      drawers.forEach((d) => d.classList.toggle('open', d === $(sel)));
      backdrop.classList.add('show');
    };
    $('#openPanel').onclick = () => openDrawer('#panel');
    $('#closePanel').onclick = closeDrawer;
    $('#closeMarks').onclick = closeDrawer;
    backdrop.onclick = closeDrawer;
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && drawers.some((d) => d.classList.contains('open'))) closeDrawer();
    });
    PR.ui.openDrawer = openDrawer;
    PR.ui.closeDrawer = closeDrawer;
  }

  PR.ui = { mount };
})();
