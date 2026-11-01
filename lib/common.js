/* Shared code for the gate app: event loading, QR drawing, badge rendering.
   Used by index.html (scanner), admin.html (management) and badge.html (personal badge page). */
(function () {
  'use strict';
  var G = (window.GATE = {});
  G.VERSION = '5.2.0';

  /* ---------- defaults ---------- */
  G.DEFAULT_CATEGORIES = [
    { key: 'att', label: 'حضور', color: '#2563eb', prefix: 'A' },
    { key: 'spk', label: 'متحدث', color: '#1e3a8a', prefix: 'S' },
    { key: 'org', label: 'منظم', color: '#0f766e', prefix: 'O' },
    { key: 'vol', label: 'متطوع', color: '#b45309', prefix: 'V' }
  ];

  G.defaultDesign = function () {
    return {
      pages: [{ src: null, bg: '#ffffff' }],
      fields: [
        { type: 'text', text: '', page: 0, x: 0, y: 0, w: 1, h: 0.19, bg: '{catColor}' },
        { type: 'text', text: '{event}', page: 0, x: 0.08, y: 0.05, w: 0.84, h: 0.12, color: '#ffffff', font: 'Cairo', weight: 700, align: 'center' },
        { type: 'name', page: 0, x: 0.07, y: 0.21, w: 0.86, h: 0.15, color: '#111827', font: 'Cairo', weight: 700, align: 'center', lines: 2 },
        { type: 'cat', page: 0, x: 0.2, y: 0.37, w: 0.6, h: 0.055, color: '{catColor}', font: 'Cairo', weight: 700, align: 'center' },
        { type: 'qr', page: 0, x: 0.14, y: 0.45, w: 0.72, h: 0.44 },
        { type: 'id', page: 0, x: 0.3, y: 0.9, w: 0.4, h: 0.045, color: '#6b7280', font: 'Cairo', weight: 400, align: 'center' }
      ]
    };
  };

  G.normalizeEvent = function (ev) {
    ev = ev || {};
    ev.version = 5;
    ev.code = String(ev.code || 'EVENT').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    ev.name = ev.name || 'فعالية';
    ev.org = ev.org || 'التكنوقراط السوريون';
    ev.docLabel = ev.docLabel || 'البطاقة';
    ev.nameColors = Array.isArray(ev.nameColors) ? ev.nameColors : [];
    ev.days = Array.isArray(ev.days) ? ev.days.filter(Boolean).sort() : [];
    ev.categories = Array.isArray(ev.categories) && ev.categories.length ? ev.categories : JSON.parse(JSON.stringify(G.DEFAULT_CATEGORIES));
    ev.badge = Object.assign({ w: 50, h: 85, bleed: 3 }, ev.badge || {});
    ev.designs = ev.designs || {};
    if (!ev.designs['*']) ev.designs['*'] = G.defaultDesign();
    ev.people = Array.isArray(ev.people) ? ev.people : [];
    ev.counters = ev.counters || {};
    ev.syncUrl = ev.syncUrl || '';
    ev.cooldownSec = ev.cooldownSec == null ? 30 : ev.cooldownSec;
    return ev;
  };

  G.loadEvent = function () {
    return fetch('event.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(G.normalizeEvent);
  };

  G.cat = function (ev, key) {
    for (var i = 0; i < ev.categories.length; i++) if (ev.categories[i].key === key) return ev.categories[i];
    return { key: key, label: key || '—', color: '#6b7280', prefix: 'X' };
  };

  G.designFor = function (ev, catKey) {
    var d = ev.designs[catKey];
    return d && d.pages && d.pages.length ? d : ev.designs['*'];
  };

  /* QR content: event code | person id | per-person check code (unforgeable without the invitation) */
  G.payload = function (ev, p) { return ev.code + '|' + p.id + (p.ck ? '|' + p.ck : ''); };

  /* ---------- crypto (WebCrypto: PBKDF2-SHA256 + AES-GCM-256) ----------
     - One random event key K encrypts the roster. K is wrapped once per user with a key derived
       from that user's password; only hashed usernames and wrapped keys are published.
     - Each invitation is encrypted separately with a key derived from the secret token in its link,
       and stored under a lookup id derived from the same token, so links cannot be enumerated. */
  var TE = new TextEncoder(), TD = new TextDecoder();
  G.KDF_ITER = 300000;
  G.b64 = function (u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  G.unb64 = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  G.rand = function (n) { var u = new Uint8Array(n); crypto.getRandomValues(u); return u; };
  G.hex = function (u8) { return Array.from(u8).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); };
  G.sha256 = async function (str) { return new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(str))); };
  G.userHash = async function (u) { return G.hex(await G.sha256('gate-user:' + String(u).trim().toLowerCase())).slice(0, 32); };
  async function kek(password, salt, iter) {
    var base = await crypto.subtle.importKey('raw', TE.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function asKey(k) { return (window.CryptoKey && k instanceof CryptoKey) ? Promise.resolve(k) : crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  G.seal = async function (k, data) {
    var key = await asKey(k), iv = G.rand(12), pt = typeof data === 'string' ? TE.encode(data) : data;
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, pt));
    var out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return G.b64(out);
  };
  G.open = async function (k, b64) {
    var key = await asKey(k), u = G.unb64(b64);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
  };
  G.openText = async function (k, b64) { return TD.decode(await G.open(k, b64)); };
  G.wrapKey = async function (K, username, password) {
    var s = G.rand(16);
    return { h: await G.userHash(username), s: G.b64(s), i: G.KDF_ITER, w: await G.seal(await kek(password, s, G.KDF_ITER), K) };
  };
  /* returns the raw event key, or throws Error('login') for an unknown user or wrong password */
  G.unwrapKey = async function (keyring, username, password) {
    var h = await G.userHash(username);
    var e = (keyring || []).find(function (x) { return x.h === h; });
    if (!e) { await kek(password, G.rand(16), G.KDF_ITER); throw new Error('login'); } // same timing as a wrong password
    try { return await G.open(await kek(password, G.unb64(e.s), e.i || G.KDF_ITER), e.w); }
    catch (x) { throw new Error('login'); }
  };
  G.isSecure = function (ev) { return !!(ev && ev.secure && ev.secure.enc); };
  G.tokenKeys = async function (t) {
    return { lookup: G.hex(await G.sha256('gate-lookup:' + t)).slice(0, 24), key: await G.sha256('gate-key:' + t) };
  };
  /* roster = { people: [{id,name,cat,nc,ck,t}], users: [names] } */
  G.decryptRoster = async function (ev, K) { return JSON.parse(await G.openText(K, ev.secure.enc)); };
  G.openInvite = async function (ev, t) {
    var tk = await G.tokenKeys(t), c = ev.secure && ev.secure.inv && ev.secure.inv[tk.lookup];
    if (!c) return null;
    return JSON.parse(await G.openText(tk.key, c));
  };
  G.buildSecure = async function (K, keyring, people, users) {
    var slim = function (p, withT) { var o = { id: p.id, name: p.name, cat: p.cat, ck: p.ck }; if (p.nc) o.nc = p.nc; if (p.title) o.title = p.title; if (withT) o.t = p.t; return o; };
    var inv = {};
    for (var i = 0; i < people.length; i++) {
      var tk = await G.tokenKeys(people[i].t);
      inv[tk.lookup] = await G.seal(tk.key, JSON.stringify(slim(people[i], false)));
    }
    return {
      v: 1, keyring: keyring,
      enc: await G.seal(K, JSON.stringify({ people: people.map(function (p) { return slim(p, true); }), users: users || [] })),
      inv: inv
    };
  };

  G.token = function (n) {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', out = '', b = new Uint8Array(n || 10);
    crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) out += a[b[i] % a.length];
    return out;
  };

  G.nextId = function (ev, catKey) {
    var c = G.cat(ev, catKey), pre = (c.prefix || 'X').toUpperCase();
    var max = ev.counters[pre] || 0;
    ev.people.forEach(function (p) {
      var m = String(p.id).match(/^([A-Z]+)(\d+)$/);
      if (m && m[1] === pre) max = Math.max(max, +m[2]);
    });
    ev.counters[pre] = max + 1;
    return pre + String(max + 1).padStart(3, '0');
  };

  G.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  G.isRTL = function (s) { return /[֐-ࣿיִ-ﻼ]/.test(s || ''); };

  G.normName = function (s) {
    return String(s || '').trim().replace(/\s+/g, ' ')
      .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْـ]/g, '').toLowerCase();
  };

  /* ---------- QR ---------- */
  G.qrMatrix = function (text, ecl) {
    var qr = window.qrcode(0, ecl || 'M');
    qr.addData(text);
    qr.make();
    return { n: qr.getModuleCount(), dark: function (r, c) { return qr.isDark(r, c); } };
  };

  /* Draws a QR code filling a square of `size` px at (x, y), quiet zone included. */
  G.drawQR = function (ctx, text, x, y, size, opt) {
    opt = opt || {};
    var m = G.qrMatrix(text, opt.ecl);
    var quiet = opt.quiet == null ? 2 : opt.quiet;
    var cells = m.n + quiet * 2;
    var cell = size / cells;
    ctx.fillStyle = opt.bg || '#ffffff';
    var rad = (opt.radius || 0) * size;
    if (rad > 0) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, size, size, rad);
      else { ctx.moveTo(x + rad, y); ctx.arcTo(x + size, y, x + size, y + size, rad); ctx.arcTo(x + size, y + size, x, y + size, rad); ctx.arcTo(x, y + size, x, y, rad); ctx.arcTo(x, y, x + size, y, rad); ctx.closePath(); }
      ctx.fill();
    } else ctx.fillRect(x, y, size, size);
    ctx.fillStyle = opt.fg || '#000000';
    for (var r = 0; r < m.n; r++) {
      for (var c = 0; c < m.n; c++) {
        if (m.dark(r, c)) {
          var px = x + (c + quiet) * cell, py = y + (r + quiet) * cell;
          // overlap by a hair to avoid hairline gaps between modules
          ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cell + (px - Math.floor(px))) + 0.5, Math.ceil(cell + (py - Math.floor(py))) + 0.5);
        }
      }
    }
  };

  /* ---------- images & fonts ---------- */
  var imgCache = {};
  G.loadImage = function (src) {
    if (!imgCache[src]) {
      imgCache[src] = new Promise(function (res, rej) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { res(im); };
        im.onerror = function () { delete imgCache[src]; rej(new Error('تعذر تحميل الصورة: ' + src)); };
        im.src = src;
      });
    }
    return imgCache[src];
  };
  G.forgetImage = function (src) { delete imgCache[src]; };

  G.fontsReady = function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = [];
    ['Cairo', 'Tajawal'].forEach(function (f) {
      [400, 700].forEach(function (w) {
        loads.push(document.fonts.load(w + ' 32px "' + f + '"', 'أبجد Abc 123'));
      });
    });
    return Promise.all(loads).catch(function () {});
  };

  /* ---------- badge rendering ---------- */
  G.mmPx = function (mm, dpi) { return Math.round(mm / 25.4 * dpi); };

  function fill(tpl, ev, p) {
    var c = G.cat(ev, p.cat);
    return String(tpl == null ? '' : tpl)
      .replace(/\{event\}/g, ev.name)
      .replace(/\{org\}/g, ev.org)
      .replace(/\{date\}/g, ev.days[0] || '')
      .replace(/\{name\}/g, p.name || '')
      .replace(/\{id\}/g, p.id || '')
      .replace(/\{cat\}/g, c.label)
      .replace(/\{catColor\}/g, c.color);
  }
  G.fill = fill;

  function balancedSplit(ctx, words) {
    var best = null;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      var w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || w < best.w) best = { lines: [a, b], w: w };
    }
    return best;
  }

  G.drawText = function (ctx, text, bx, by, bw, bh, f) {
    text = String(text || '').trim();
    if (!text) return;
    var pad = (f.pad == null ? 0.04 : f.pad) * bw;
    var iw = bw - pad * 2;
    var fam = '"' + (f.font || 'Cairo') + '", "Cairo", "Tajawal", sans-serif';
    var weight = f.weight || 700;
    var setF = function (s) { ctx.font = weight + ' ' + s + 'px ' + fam; };
    var maxScale = f.scale || 0.78;
    // one line
    var s1 = bh * maxScale; setF(s1);
    var w1 = ctx.measureText(text).width;
    if (w1 > iw) s1 = s1 * iw / w1;
    var lines = [text], size = s1;
    // two lines when allowed and clearly better
    var words = text.split(/\s+/);
    if ((f.lines || 1) > 1 && words.length > 1) {
      var s2 = Math.min(bh * maxScale, bh * 0.78 / 2.45); setF(s2);
      var sp = balancedSplit(ctx, words);
      if (sp.w > iw) s2 = s2 * iw / sp.w;
      if (s2 > s1 * 1.15) { lines = sp.lines; size = s2; }
    }
    setF(size);
    ctx.fillStyle = f.color || '#111';
    ctx.textBaseline = 'middle';
    ctx.direction = G.isRTL(text) ? 'rtl' : 'ltr';
    var align = f.align || 'center';
    ctx.textAlign = align;
    var x = align === 'center' ? bx + bw / 2 : align === 'right' ? bx + bw - pad : bx + pad;
    var lh = size * 1.18;
    var y0 = by + bh / 2 - (lh * (lines.length - 1)) / 2;
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y0 + i * lh);
  };

  /* Name with the job title on a second, smaller line; the pair is centred as one block in the box.
     The name stays on one line (shrinking to fit); a long title may wrap to two lines. */
  G.drawNameTitle = function (ctx, name, title, bx, by, bw, bh, f) {
    var pad = (f.pad == null ? 0.04 : f.pad) * bw, iw = bw - pad * 2;
    var fam = function (ff) { return '"' + (ff || 'Cairo') + '", "Cairo", "Tajawal", sans-serif'; };
    var ts = f.titleScale || 0.55;
    var sN = bh * (f.scale || 0.78), sT = sN * ts;
    var fit = function (txt, size, weight, font) { ctx.font = weight + ' ' + size + 'px ' + fam(font); var w = ctx.measureText(txt).width; return w > iw ? size * iw / w : size; };
    var tLines = [title];
    var block = function () { return sN * 1.2 + sN * 0.12 + tLines.length * sT * 1.25; };
    // fit widths
    sN = fit(name, sN, f.weight || 700, f.font);
    var tw = f.titleWeight || 400, sT1 = fit(title, sT, tw, f.font);
    var words = title.split(/\s+/);
    if (sT1 < sT * 0.72 && words.length > 1) {
      ctx.font = tw + ' ' + sT + 'px ' + fam(f.font);
      var sp = balancedSplit(ctx, words);
      tLines = sp.lines; sT = sp.w > iw ? sT * iw / sp.w : sT;
    } else sT = sT1;
    // fit height
    var tot = block();
    if (tot > bh) { var k = bh / tot; sN *= k; sT *= k; }
    tot = block();
    var align = f.align || 'center';
    var x = align === 'center' ? bx + bw / 2 : align === 'right' ? bx + bw - pad : bx + pad;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    var y = by + (bh - tot) / 2;
    ctx.font = (f.weight || 700) + ' ' + sN + 'px ' + fam(f.font);
    ctx.fillStyle = f.color || '#111'; ctx.direction = G.isRTL(name) ? 'rtl' : 'ltr';
    ctx.fillText(name, x, y + sN * 0.6);
    y += sN * 1.2 + sN * 0.12;
    ctx.font = tw + ' ' + sT + 'px ' + fam(f.font);
    ctx.fillStyle = f.titleColor || f.color || '#111'; ctx.direction = G.isRTL(title) ? 'rtl' : 'ltr';
    for (var i = 0; i < tLines.length; i++) ctx.fillText(tLines[i], x, y + sT * 1.25 * (i + 0.5));
  };

  G.drawField = function (ctx, f, ev, p, W, H) {
    var x = f.x * W, y = f.y * H, w = f.w * W, h = f.h * H;
    if (f.bg) { ctx.fillStyle = fill(f.bg, ev, p); ctx.fillRect(x, y, w, h); }
    var col = Object.assign({}, f, { color: fill(f.color || '#111', ev, p) });
    if (f.type === 'qr') {
      var s = Math.min(w, h);
      G.drawQR(ctx, G.payload(ev, p), x + (w - s) / 2, y + (h - s) / 2, s, { quiet: f.quiet, fg: f.fg, bg: f.qrBg, radius: f.radius });
    } else if (f.type === 'name') {
      var nc = p.nc && ev.nameColors.find(function (c) { return c.key === p.nc; });
      if (nc) col.color = nc.color;
      var title = String(p.title || '').trim();
      if (title && f.withTitle !== false) G.drawNameTitle(ctx, String(p.name || '').trim(), title, x, y, w, h, col);
      else G.drawText(ctx, p.name, x, y, w, h, col);
    } else if (f.type === 'id') {
      G.drawText(ctx, p.id, x, y, w, h, col);
    } else if (f.type === 'cat') {
      G.drawText(ctx, G.cat(ev, p.cat).label, x, y, w, h, col);
    } else if (f.type === 'text') {
      G.drawText(ctx, fill(f.text, ev, p), x, y, w, h, col);
    }
  };

  /* Renders one page of a person's badge to a canvas.
     opts: dpi (default 300), trim (crop the bleed), resolve(src)->url, design (override) */
  G.renderPage = async function (ev, p, pageIdx, opts) {
    opts = opts || {};
    var b = ev.badge, dpi = opts.dpi || 300;
    var design = opts.design || G.designFor(ev, p.cat);
    var W = G.mmPx(b.w + 2 * b.bleed, dpi), H = G.mmPx(b.h + 2 * b.bleed, dpi);
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var page = design.pages[pageIdx] || {};
    ctx.fillStyle = fill(page.bg || '#ffffff', ev, p);
    ctx.fillRect(0, 0, W, H);
    if (page.src) {
      var img = await G.loadImage(opts.resolve ? opts.resolve(page.src) : page.src);
      ctx.drawImage(img, 0, 0, W, H);
    }
    design.fields.forEach(function (f) { if ((f.page || 0) === pageIdx) G.drawField(ctx, f, ev, p, W, H); });
    if (opts.trim && b.bleed > 0) {
      var bl = G.mmPx(b.bleed, dpi);
      var t = document.createElement('canvas');
      t.width = W - 2 * bl; t.height = H - 2 * bl;
      t.getContext('2d').drawImage(c, bl, bl, t.width, t.height, 0, 0, t.width, t.height);
      return t;
    }
    return c;
  };

  G.pageCount = function (ev, p) { return G.designFor(ev, p.cat).pages.length; };

  /* Index of the page that carries the QR code (for the digital badge), default 0. */
  G.qrPage = function (ev, p) {
    var d = G.designFor(ev, p.cat);
    for (var i = 0; i < d.fields.length; i++) if (d.fields[i].type === 'qr') return d.fields[i].page || 0;
    return 0;
  };

  G.badgeLink = function (p, base) {
    base = base || (location.origin + location.pathname.replace(/[^/]*$/, ''));
    return base + 'badge.html#t=' + p.t;
  };

  G.fileName = function (p, suffix) {
    return (p.id + ' - ' + String(p.name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() + (suffix || '')).slice(0, 120);
  };

  /* ---------- dates ---------- */
  G.pad = function (n) { return String(n).padStart(2, '0'); };
  G.dstr = function (d) { d = d || new Date(); return d.getFullYear() + '-' + G.pad(d.getMonth() + 1) + '-' + G.pad(d.getDate()); };
  G.tstr = function (d) { d = d || new Date(); return G.pad(d.getHours()) + ':' + G.pad(d.getMinutes()) + ':' + G.pad(d.getSeconds()); };
  G.dayLabel = function (ev, date) {
    var i = ev.days.indexOf(date);
    if (i < 0) return 'خارج أيام الفعالية';
    return ev.days.length > 1 ? 'اليوم ' + (i + 1) : 'يوم الفعالية';
  };
  G.arDate = function (iso) {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('ar-SY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return iso; }
  };
})();
