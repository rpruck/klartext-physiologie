/* ══════════════════════════════════════════════════════════════════════
   boot.js — document_start.

   Two jobs, both synchronous so they win before first paint:
     1. If the reskin is disabled, reveal the raw page instantly (never hide).
     2. Otherwise paint the user's last-used paper colour (so a dark-mode
        reader doesn't flash a light page) and arm a failsafe that reveals
        the page even if the document_end pipeline throws.

   chrome.storage is async and unavailable this early, so we read a tiny
   synchronous mirror from the page-origin localStorage that settings.js keeps
   in sync (`pr.enabled`, `pr.paper`). The source of truth remains
   chrome.storage.local; this mirror exists only for the document_start paint.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  var d = document.documentElement;
  var ls = null;
  try { ls = window.localStorage; } catch (e) { /* storage blocked */ }

  // 1 · Disabled → show the untouched site immediately and stop.
  if (ls && ls.getItem('pr.enabled') === '0') {
    d.classList.add('pr-ready');
    return;
  }

  // 2 · Correct the boot background to the cached theme (falls back to the
  //     neutral default painted by boot.css).
  try {
    var paper = ls && ls.getItem('pr.paper');
    if (paper) d.style.setProperty('background', paper, 'important');
  } catch (e) { /* ignore */ }

  // Failsafe: never strand the page hidden if content.js fails to run.
  setTimeout(function () { d.classList.add('pr-ready'); }, 4000);
})();
