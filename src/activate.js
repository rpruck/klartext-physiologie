/* ══════════════════════════════════════════════════════════════════════
   activate.js — the top→bottom "drawn-in" activation reveal.

   Plays once per browser session (a sessionStorage flag) when the reskin turns
   on; the ⟲ Reveal button replays it any time (force=true bypasses the
   once-per-session gate). Respects the motion setting + prefers-reduced-motion.
   The overlay lives in the shadow root and sweeps away to reveal the page.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const PR = (window.__physioReskin ||= {});
  const SESSION_KEY = 'pr.revealed';

  function motionOn() {
    const s = PR.settings && PR.settings.get ? PR.settings.get() : null;
    const on = s ? s.motion !== false : true;
    return on && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function play(force) {
    const sh = PR.ui && PR.ui.shadow; if (!sh) return;
    if (!force) {
      try { if (sessionStorage.getItem(SESSION_KEY)) return; sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* ignore */ }
    }
    if (!motionOn()) return;
    const a = sh.querySelector('#activate'), line = sh.querySelector('#activateLine');
    if (!a) return;
    [a, line].forEach((el) => { if (!el) return; el.classList.remove('run'); void el.offsetWidth; el.classList.add('run'); });
    a.addEventListener('animationend', () => { a.classList.remove('run'); if (line) line.classList.remove('run'); }, { once: true });
  }

  PR.activate = { play };
})();
