/* popup.js — the toolbar on/off switch. Writes chrome.storage.local['enabled'];
   the content script reacts via storage.onChanged (reloads the page). */
(function () {
  const btn = document.getElementById('toggle');
  function paint(on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }

  chrome.storage.local.get('enabled', (o) => paint(o.enabled !== false));

  btn.addEventListener('click', () => {
    chrome.storage.local.get('enabled', (o) => {
      const next = !(o.enabled !== false);
      chrome.storage.local.set({ enabled: next }, () => paint(next));
    });
  });
})();
