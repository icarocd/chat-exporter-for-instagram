// Fetches media from the Instagram CDN for the content script (avoids CORS blocks).
const allowed = h => h.endsWith('.cdninstagram.com') || h.endsWith('.fbcdn.net');

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.type !== 'fetch') return;
  (async () => {
    try {
      const u = new URL(msg.url);
      if (u.protocol !== 'https:' || !allowed(u.hostname)) throw new Error('host not allowed');
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      send({ ok: true, b64: btoa(s), type: r.headers.get('content-type') || '' });
    } catch (e) {
      send({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;
});

// On install or reload, add the button to Instagram tabs that are already open (no page reload needed).
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => {});
  }
});
