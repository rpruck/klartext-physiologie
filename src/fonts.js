/* ══════════════════════════════════════════════════════════════════════
   fonts.js — register the bundled woff2 faces.

   Static url() in a content-script stylesheet resolves against the PAGE origin
   (physiologie.cc) → 404. So we build the @font-face block in JS with
   chrome.runtime.getURL and inject it into <head>. @font-face is
   document-scoped, so one injection serves BOTH the light-DOM content reskin
   and the shadow-DOM UI.

   The spec below mirrors the files in /fonts exactly (see M1). Subset files
   carry a unicode-range so the browser only downloads what a page actually
   needs (e.g. greek-ext loads only for the polytonic etymology box).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});

  // Standard Google Fonts subset ranges.
  const RANGE = {
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    greek: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
    'greek-ext': 'U+1F00-1FFF',
  };

  // Fontsource families: [fsid, 'Family', [subsets], [normalWeights], [italicWeights]]
  const FS = [
    ['eb-garamond', 'EB Garamond', ['latin', 'latin-ext'], [400, 500, 600], [400]],
    ['eb-garamond', 'EB Garamond', ['greek', 'greek-ext'], [400], [400]],
    ['source-serif-4', 'Source Serif 4', ['latin', 'latin-ext'], [400, 600], [400]],
    ['newsreader', 'Newsreader', ['latin', 'latin-ext'], [400, 500], [400]],
    ['inter', 'Inter', ['latin', 'latin-ext'], [400, 500, 600], []],
    ['source-sans-3', 'Source Sans 3', ['latin', 'latin-ext'], [400, 600], []],
    ['ibm-plex-sans', 'IBM Plex Sans', ['latin', 'latin-ext'], [400, 600], []],
    ['ibm-plex-mono', 'IBM Plex Mono', ['latin', 'latin-ext'], [400, 500], []],
    ['space-mono', 'Space Mono', ['latin', 'latin-ext'], [400, 700], []],
  ];

  // Computer Modern full files (no subsetting). The package labels regular as
  // weight 500 with font-style "roman"; remap to the CSS 400 / normal the
  // reskin actually requests.  [file, 'Family', weight, style]
  const CMU = [
    ['cmu-serif-500-roman', 'CMU Serif', 400, 'normal'],
    ['cmu-serif-700-roman', 'CMU Serif', 700, 'normal'],
    ['cmu-serif-500-italic', 'CMU Serif', 400, 'italic'],
    ['cmu-typewriter-text-500-roman', 'CMU Typewriter Text', 400, 'normal'],
  ];

  const url = (file) =>
    (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('fonts/' + file)
      : 'fonts/' + file; // fallback for offline unit-testing

  function face(family, file, weight, style, range) {
    return `@font-face{font-family:'${family}';` +
      `src:url('${url(file)}') format('woff2');` +
      `font-weight:${weight};font-style:${style};font-display:swap;` +
      (range ? `unicode-range:${range};` : '') + '}';
  }

  function buildFaces() {
    const out = [];
    for (const [id, fam, subs, normW, italW] of FS) {
      for (const sub of subs) {
        for (const w of normW) out.push(face(fam, `${id}-${sub}-${w}-normal.woff2`, w, 'normal', RANGE[sub]));
        for (const w of italW) out.push(face(fam, `${id}-${sub}-${w}-italic.woff2`, w, 'italic', RANGE[sub]));
      }
    }
    for (const [file, fam, w, style] of CMU) out.push(face(fam, `${file}.woff2`, w, style, null));
    return out;
  }

  const cssText = buildFaces().join('');

  function inject() {
    if (document.getElementById('pr-fontface')) return;
    const s = document.createElement('style');
    s.id = 'pr-fontface';
    s.textContent = cssText;
    (document.head || document.documentElement).appendChild(s);
  }

  PR.fonts = { inject, css: () => cssText };
})();
