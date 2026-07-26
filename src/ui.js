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
  /* The scanner glyph — a page under a scan line, for looking at the original.
     Inlined from icons/scan.svg (which is where the drawing lives) so it takes
     the button's colour from currentColor. Filled where the other two are
     stroked, hence tb-glyph-fill. */
  const SOURCE = `<svg class="tb-glyph tb-glyph-fill" viewBox="0 0 24 24" aria-hidden="true">
      <path opacity=".4" d="M2.77 10C2.34 10 2 9.66 2 9.23V6.92C2 4.21 4.21 2 6.92 2H9.23C9.66 2 10 2.34 10 2.77C10 3.2 9.66 3.54 9.23 3.54H6.92C5.05 3.54 3.54 5.06 3.54 6.92V9.23C3.54 9.66 3.19 10 2.77 10Z"/>
      <path opacity=".4" d="M21.23 10C20.81 10 20.46 9.66 20.46 9.23V6.92C20.46 5.05 18.94 3.54 17.08 3.54H14.77C14.34 3.54 14 3.19 14 2.77C14 2.35 14.34 2 14.77 2H17.08C19.79 2 22 4.21 22 6.92V9.23C22 9.66 21.66 10 21.23 10Z"/>
      <path d="M17.0799 21.9997H15.6899C15.2699 21.9997 14.9199 21.6597 14.9199 21.2297C14.9199 20.8097 15.2599 20.4597 15.6899 20.4597H17.0799C18.9499 20.4597 20.4599 18.9397 20.4599 17.0797V15.6997C20.4599 15.2797 20.7999 14.9297 21.2299 14.9297C21.6499 14.9297 21.9999 15.2697 21.9999 15.6997V17.0797C21.9999 19.7897 19.7899 21.9997 17.0799 21.9997Z"/>
      <path d="M9.23 22H6.92C4.21 22 2 19.79 2 17.08V14.77C2 14.34 2.34 14 2.77 14C3.2 14 3.54 14.34 3.54 14.77V17.08C3.54 18.95 5.06 20.46 6.92 20.46H9.23C9.65 20.46 10 20.8 10 21.23C10 21.66 9.66 22 9.23 22Z"/>
      <path d="M18.46 11.2305H17.1H6.90002H5.54002C5.11002 11.2305 4.77002 11.5805 4.77002 12.0005C4.77002 12.4205 5.11002 12.7705 5.54002 12.7705H6.90002H17.1H18.46C18.89 12.7705 19.23 12.4205 19.23 12.0005C19.23 11.5805 18.89 11.2305 18.46 11.2305Z"/>
      <path d="M6.8999 13.9405V14.2705C6.8999 15.9305 8.2399 17.2705 9.8999 17.2705H14.0999C15.7599 17.2705 17.0999 15.9305 17.0999 14.2705V13.9405C17.0999 13.8205 17.0099 13.7305 16.8899 13.7305H7.1099C6.9899 13.7305 6.8999 13.8205 6.8999 13.9405Z"/>
      <path opacity=".4" d="M6.8999 10.0605V9.73047C6.8999 8.07047 8.2399 6.73047 9.8999 6.73047H14.0999C15.7599 6.73047 17.0999 8.07047 17.0999 9.73047V10.0605C17.0999 10.1805 17.0099 10.2705 16.8899 10.2705H7.1099C6.9899 10.2705 6.8999 10.1805 6.8999 10.0605Z"/>
    </svg>`;
  /* The GitHub mark, inlined from icons/github.svg the same way — icons/ is not
     a web_accessible_resource, and inlining is what lets it take currentColor.
     The source file's <g clip-path>/<defs> wrapper is dropped: the clip is a
     no-op rect covering the whole viewBox, and its bare id would be one more
     thing to collide in a shadow root everything else also lives in. */
  const GITHUB = `<svg class="tb-glyph tb-glyph-fill" viewBox="0 0 98 96" aria-hidden="true">
      <path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/>
    </svg>`;

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

  /* The source window: the magnetic picker cursor (a reticle of four corner
     brackets that snaps around the block under the pointer, plus a dot on the
     real pointer), the movable frame the original renders in, and the screenshot
     reminder that hangs in the opposite corner from it. No backdrop — the whole
     point is that the reader stays visible and clickable beside it. inspect.js
     drives the cursor, fills #inspectHints and appends the iframe. */
  const INSPECT = `
    <div class="insp-cur" id="inspectCur" aria-hidden="true">
      <i class="insp-cur-c tl"></i><i class="insp-cur-c tr"></i>
      <i class="insp-cur-c bl"></i><i class="insp-cur-c br"></i>
      <span class="insp-cur-tag">Original</span>
    </div>
    <div class="insp-dot" id="inspectDot" aria-hidden="true"></div>
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
      <button class="act act-icon" data-act="copy" title="Text kopieren" aria-label="Text kopieren">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2.3" width="6" height="3.4" rx="1.2"/></svg>
      </button>
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
            <div class="f-row"><label for="fs">Schriftgröße</label><span class="val" id="fsVal">18px</span></div>
            <input type="range" id="fs" min="16" max="24" step="1" value="18">
          </div>
          <div class="field">
            <div class="f-row"><label for="lh">Zeilenhöhe</label><span class="val" id="lhVal">1.65</span></div>
            <input type="range" id="lh" min="1.35" max="1.95" step="0.01" value="1.65">
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
          <!-- Where the project lives. New tab, always: navigating in place would
               throw away the reading position the rail and every annotation hang off. -->
          <div class="foot-links">
            <a class="foot-site" href="https://cmdf.dev/klartext-physiologie" target="_blank" rel="noopener noreferrer">cmdf.dev/klartext-physiologie</a>
            <a class="foot-gh" href="https://github.com/rpruck/klartext-physiologie" target="_blank" rel="noopener noreferrer">${GITHUB}GitHub</a>
          </div>
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
