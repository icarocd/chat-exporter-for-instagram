(() => {
  if (window.__igxLoaded) return;
  window.__igxLoaded = true;

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isCdn = u => { try { const h = new URL(u).hostname; return h.endsWith('.cdninstagram.com') || h.endsWith('.fbcdn.net'); } catch { return false; } };
  let running = false;
  let cancel = false;

  const pref = {
    get: (k, d) => { try { const v = localStorage.getItem('igx_' + k); return v === null ? d : v === '1'; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('igx_' + k, v ? '1' : '0'); } catch {} }
  };

  // ---------- UI ----------
  document.getElementById('igx-box')?.remove(); // old button from a previous load of the extension
  const box = document.createElement('div');
  box.id = 'igx-box';
  box.style.cssText = 'position:fixed;right:24px;bottom:90px;z-index:99999;font:13px sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:4px;background:#fff;color:#000;padding:8px;border-radius:8px;box-shadow:0 4px 12px #0004';
  const status = document.createElement('div');
  status.style.cssText = 'display:none;background:#fff;color:#000;padding:6px 10px;border-radius:8px;box-shadow:0 4px 12px #0004';
  const btnCss = 'background:#0095f6;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;text-align:left';
  const mainBtn = document.createElement('button');
  mainBtn.textContent = '⇩ Export';
  mainBtn.style.cssText = btnCss + ';opacity:.75';
  mainBtn.onmouseenter = () => (mainBtn.style.opacity = '1');
  mainBtn.onmouseleave = () => (mainBtn.style.opacity = '.75');

  const addItem = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = btnCss;
    b.onclick = () => { menu.style.display = 'none'; fn(); };
    menu.appendChild(b);
  };
  addItem('Only what is on screen', () => run(0));
  addItem('Last N scrolls...', () => {
    const n = parseInt(prompt('How many times to scroll up?', '20'), 10);
    if (n > 0) run(n);
  });
  addItem('Whole conversation', () => run(Infinity));

  const optLabel = document.createElement('label');
  optLabel.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 2px;cursor:pointer';
  const optAtt = document.createElement('input');
  optAtt.type = 'checkbox';
  optAtt.checked = pref.get('att', true);
  optAtt.onchange = () => pref.set('att', optAtt.checked);
  optLabel.append(optAtt, 'Download images');
  menu.appendChild(optLabel);

  mainBtn.onclick = () => {
    if (running) { cancel = true; return; }
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  };
  box.append(menu, status, mainBtn);
  document.body.appendChild(box);
  const setStatus = t => { status.style.display = t ? 'block' : 'none'; status.textContent = t || ''; };

  // Show the button only inside a DM thread (Instagram is a single page app).
  const syncVisible = () => { box.style.display = location.pathname.startsWith('/direct/') ? 'flex' : 'none'; };
  syncVisible();
  setInterval(syncVisible, 1000);

  // ---------- Find the message list ----------
  // Instagram class names are random, so we find the list by layout:
  // the biggest scrollable box in the right part of the page.
  function getScroller() {
    let best = null, bestArea = 0;
    for (const e of document.querySelectorAll('div')) {
      if (e.scrollHeight <= e.clientHeight + 20) continue;
      const oy = getComputedStyle(e).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 250 || r.height < 200 || r.left < innerWidth * 0.2) continue;
      const area = r.width * r.height;
      if (area > bestArea) { best = e; bestArea = area; }
    }
    return best;
  }

  function getRows(sc) {
    let rows = [...sc.querySelectorAll('[role="row"]')];
    if (rows.length) return rows.filter(r => !r.parentElement.closest('[role="row"]'));
    // Fallback: children of the element with the most children.
    let list = sc, max = 0;
    for (const e of sc.querySelectorAll('div')) if (e.children.length > max) { max = e.children.length; list = e; }
    return [...list.children];
  }

  function getTitle(sc) {
    const s = sc.getBoundingClientRect();
    let best = null;
    for (const e of document.querySelectorAll('h1, h2, span')) {
      const r = e.getBoundingClientRect();
      if (r.bottom > s.top || r.top < s.top - 120 || r.left < s.left || r.left > s.right || !r.width) continue;
      const t = clean(e.innerText);
      if (!t || e.querySelector('span')) continue;
      if (!best || r.top < best.r.top - 2 || (Math.abs(r.top - best.r.top) <= 2 && r.left < best.r.left)) best = { r, t };
    }
    return best ? best.t : 'conversation';
  }

  // ---------- Read one row ----------
  const NOISE = /^(seen|visto|enter|like|curtir|reply|responder|react|reagir|more|mais|edited|editado)$/i;

  function bestSrc(img) {
    const set = img.getAttribute('srcset');
    if (set) {
      let top = null, w = 0;
      for (const part of set.split(',')) {
        const [u, d] = part.trim().split(/\s+/);
        const n = parseFloat(d) || 0;
        if (u && n >= w) { w = n; top = u; }
      }
      if (top) return new URL(top, location.href).toString();
    }
    return img.currentSrc || img.src;
  }

  function parseRow(row, s) {
    const media = [];
    const seen = new Set();
    let anchor = null, anchorArea = 0;
    const consider = el => {
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > anchorArea) { anchor = r; anchorArea = a; }
    };
    const POST_LINK = /instagram\.com\/(p|reel|reels|stories|tv)\//;
    const videos = row.querySelectorAll('video');
    const isVideoRow = videos.length > 0 || !!row.querySelector('svg[aria-label*="play" i], svg[aria-label*="reproduzir" i]');
    row.querySelectorAll('img').forEach(img => {
      const r = img.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return; // avatars, emojis
      const url = bestSrc(img);
      if (!isCdn(url)) return;
      consider(img);
      // Only images sent directly in the chat are saved; video thumbnails and shared post previews become links.
      if (isVideoRow) return;
      const a = img.closest('a[href]');
      if (a && POST_LINK.test(a.href)) return;
      const key = new URL(url).pathname;
      if (seen.has(key)) return;
      seen.add(key);
      media.push({ url, name: key.split('/').pop() || 'image.jpg' });
    });
    const links = [];
    row.querySelectorAll('a[href]').forEach(a => {
      const h = a.href;
      if (POST_LINK.test(h) || /l\.instagram\.com/.test(h)) {
        if (!links.includes(h)) links.push(h);
      }
    });
    // Videos are not downloaded: keep the post/reel link if there is one, else the direct video link.
    let video = false;
    if (isVideoRow) {
      video = true;
      if (!links.some(l => POST_LINK.test(l))) {
        videos.forEach(v => {
          const url = v.currentSrc || v.src || (v.querySelector('source') || {}).src || '';
          consider(v);
          if (url && isCdn(url) && !links.includes(url)) links.push(url);
        });
      }
    }
    row.querySelectorAll('[dir="auto"]').forEach(e => { if (clean(e.innerText)) consider(e); });

    const text = (row.innerText || '').split('\n').map(l => l.trim()).filter(l => l && !NOISE.test(l)).join('\n');
    if (!text && !media.length && !links.length && !video) return null;

    if (!anchor) anchor = row.getBoundingClientRect();
    const rel = ((anchor.left + anchor.right) / 2 - s.left) / s.width;
    let side = rel > 0.55 ? 'me' : rel < 0.45 ? 'them' : 'center';
    const sys = side === 'center' && !media.length && text.length < 80;
    if (side === 'center' && !sys) side = 'them';
    const key = side + '|' + text + '|' + media.map(m => m.name).join(',') + '|' + links.map(l => { try { return new URL(l).pathname; } catch { return l; } }).join(',') + (video ? '|v' : '');
    return { side, text, media, links, video, sys, key };
  }

  function snapshot(sc) {
    const s = sc.getBoundingClientRect();
    return getRows(sc)
      .map(r => ({ r, top: r.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map(x => parseRow(x.r, s))
      .filter(Boolean);
  }

  // Joins an older snapshot in front of what we already have, using the overlap.
  function merge(acc, snap) {
    if (!acc.length) return snap;
    const K = Math.min(5, acc.length);
    for (let p = 0; p + K <= snap.length; p++) {
      let ok = true;
      for (let j = 0; j < K; j++) if (snap[p + j].key !== acc[j].key) { ok = false; break; }
      if (ok) return snap.slice(0, p).concat(acc);
    }
    return snap.concat([{ sys: true, text: '(some messages may be missing here)', media: [], links: [], key: 'gap' }], acc);
  }

  const atBeginning = sc =>
    [...sc.querySelectorAll('a, div[role="button"], button')].some(e => /^(view profile|ver perfil)$/i.test(clean(e.innerText)));

  // ---------- Download ----------
  async function fetchBytes(url) {
    try {
      const r = await fetch(url);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {}
    const res = await chrome.runtime.sendMessage({ type: 'fetch', url });
    if (!res || !res.ok) throw new Error((res && res.error) || 'failed');
    const bin = atob(res.b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function downloadAll(arr, files) {
    const jobs = [];
    let n = 0;
    for (const m of arr) for (const a of m.media) {
      n++;
      let base = a.name.replace(/[\\/:*?"<>|]+/g, '_').slice(-80);
      if (!/\.\w{2,4}$/.test(base)) base += '.jpg';
      a.path = `media/${String(n).padStart(4, '0')}_${base}`;
      jobs.push(a);
    }
    let done = 0, idx = 0;
    const worker = async () => {
      while (idx < jobs.length && !cancel) {
        const a = jobs[idx++];
        try {
          files.push({ name: a.path, data: await fetchBytes(a.url) });
          a.ok = true;
        } catch (e) {
          a.ok = false;
          a.err = String(e.message || e);
        }
        done++;
        setStatus(`Downloading media ${done}/${jobs.length}`);
      }
    };
    await Promise.all([1, 2, 3, 4].map(worker));
  }

  // ---------- ZIP (no compression) ----------
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = d => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, dtime, true); h.setUint16(12, ddate, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dtime, true);
      c.setUint16(14, ddate, true); c.setUint32(16, crc, true); c.setUint32(20, size, true);
      c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
  }

  // ---------- Output ----------
  const who = (m, title) => (m.side === 'me' ? 'You' : title);

  function buildTxt(arr, title, header) {
    const lines = arr.map(m => {
      if (m.sys) return `\n[${m.text}]`;
      let s = `${who(m, title)}: ${m.text.replace(/\n/g, '\n    ')}`;
      for (const a of m.media) s += a.ok ? `\n    image: ${a.path}` : `\n    image (not downloaded${a.err ? ': ' + a.err : ''}): ${a.url}`;
      for (const l of m.links) s += `\n    ${m.video ? 'video link' : 'link'}: ${l}`;
      if (m.video && !m.links.length) s += '\n    video (no link available)';
      return s;
    });
    return header + '\n' + lines.join('\n') + '\n';
  }

  function buildHtml(arr, title, header) {
    const rows = arr.map(m => {
      if (m.sys) return `<div class="s">${esc(m.text)}</div>`;
      let h = `<div class="m ${m.side === 'me' ? 'me' : 'th'}"><div class="b"><div class="a">${esc(who(m, title))}</div><div class="x">${esc(m.text)}</div>`;
      for (const a of m.media) {
        if (!a.ok) h += `<div class="f">image not downloaded: <a href="${esc(a.url)}">link</a></div>`;
        else h += `<a href="${esc(a.path)}"><img loading="lazy" src="${esc(a.path)}"></a>`;
      }
      for (const l of m.links) h += `<div class="f">${m.video ? '▶ ' : ''}<a href="${esc(l)}">${esc(l)}</a></div>`;
      if (m.video && !m.links.length) h += '<div class="f">▶ video (no link available)</div>';
      return h + '</div></div>';
    });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:14px/1.4 sans-serif;max-width:800px;margin:auto;padding:16px;background:#fff;color:#000}pre{color:#737373;white-space:pre-wrap}.m{display:flex;margin:6px 0}.me{justify-content:flex-end}.b{max-width:70%;padding:8px 12px;border-radius:18px;background:#efefef}.me .b{background:#3797f0;color:#fff}.me a{color:#fff}.a{font-size:11px;opacity:.7}.x{white-space:pre-wrap}.s{text-align:center;color:#737373;font-size:12px;margin:16px 0 8px}.f{margin:4px 0;word-break:break-all}a{color:#0095f6}img{max-width:100%;max-height:360px;display:block;margin:4px 0;border-radius:8px}@media (prefers-color-scheme:dark){body{background:#000;color:#f5f5f5}.b{background:#262626}}</style></head><body><pre>${esc(header)}</pre>${rows.join('\n')}</body></html>`;
  }

  // ---------- Flow ----------
  async function run(maxScrolls) {
    const sc = location.pathname.startsWith('/direct/t/') && getScroller();
    if (!sc) { alert('Open an Instagram conversation first'); return; }
    running = true; cancel = false;
    mainBtn.textContent = '✕ Cancel';
    try {
      const title = getTitle(sc);
      let arr = snapshot(sc);
      let i = 0, stale = 0;
      while (i < maxScrolls && !cancel) {
        const before = arr.length;
        sc.scrollTop = -1e9; // goes to the top in normal and in reversed (column-reverse) lists
        await wait(1200);
        arr = merge(arr, snapshot(sc));
        i++;
        setStatus(`Scroll ${i}${isFinite(maxScrolls) ? '/' + maxScrolls : ''}: ${arr.length} messages`);
        if (arr.length === before) {
          stale++;
          if (atBeginning(sc) || stale >= 4) break;
          await wait(1500);
        } else stale = 0;
      }
      const partialScroll = cancel;
      cancel = false;

      const files = [];
      if (optAtt.checked) await downloadAll(arr, files);
      const partial = partialScroll || cancel;

      const msgs = arr.filter(m => !m.sys);
      const nMed = msgs.reduce((s, m) => s + m.media.length, 0);
      const nOk = msgs.reduce((s, m) => s + m.media.filter(a => a.ok).length, 0);
      const header = `${title}\n${location.href}\nExported at ${new Date().toLocaleString()}${partial ? ' (partial)' : ''}\n${msgs.length} messages, ${nMed} images (${nOk} downloaded)`;
      const enc = new TextEncoder();
      files.unshift(
        { name: 'conversation.txt', data: enc.encode(buildTxt(arr, title, header)) },
        { name: 'conversation.html', data: enc.encode(buildHtml(arr, title, header)) }
      );

      const safe = title.normalize('NFD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'conversation';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(makeZip(files));
      a.download = `instagram_${safe}_${stamp}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setStatus(`Exported ${msgs.length} messages and ${nOk}/${nMed} images${partial ? ' (partial)' : ''}`);
    } catch (e) {
      setStatus('Error: ' + (e.message || e));
    } finally {
      if (maxScrolls > 0) sc.scrollTop = 1e9; // back to the newest message (bottom in normal and reversed lists)
      running = false;
      mainBtn.textContent = '⇩ Export';
      setTimeout(() => setStatus(''), 8000);
    }
  }
})();
