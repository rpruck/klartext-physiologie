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

  const TOPBAR = `
    <div id="pr-topbar" part="topbar">
      <button class="tb-btn" id="notesToggle" hidden>Notizen</button>
      <button class="tb-btn" id="openPanel">✦ Einstellungen</button>
    </div>`;

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
      const txt = await fetch(url).then((r) => r.text());
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
    root.innerHTML = TOPBAR + PINRAIL + NOTEGUTTER + LIGHTBOX + HLPOP + PANEL + TOASTER + ACTIVATE;
    shadow.appendChild(root);
    PR.ui.root = root;

    wirePanel();
    return shadow;
  }

  function wirePanel() {
    const $ = (s) => shadow.querySelector(s);
    const panel = $('#panel'), backdrop = $('#backdrop');
    const open = () => { panel.classList.add('open'); backdrop.classList.add('show'); };
    const close = () => { panel.classList.remove('open'); backdrop.classList.remove('show'); };
    $('#openPanel').onclick = open;
    $('#closePanel').onclick = close;
    backdrop.onclick = close;
  }

  PR.ui = { mount };
})();
