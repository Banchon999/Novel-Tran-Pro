// ═══════════════════════════════════════════════
// NovelTrans — Web Novel Import (ดึงนิยายจาก URL)
// ดึง HTML จากเว็บต้นฉบับผ่าน CORS proxy แล้วสกัดเนื้อหา/รายชื่อตอนด้วย DOMParser
// แนวคิดพอร์ตจากโปรเจค WEB-TO-EPUB (แต่ที่นั่นเป็น browser extension ข้าม CORS ได้เอง
// แอปนี้เป็นเว็บ/PWA ล้วน จึงต้องผ่าน proxy)
// ไม่ใช้ไลบรารีเสริม — อาศัย fetch + DOMParser ของเบราว์เซอร์
// ═══════════════════════════════════════════════
'use strict';

// proxy สาธารณะเริ่มต้น — {url} จะถูกแทนด้วย encodeURIComponent ของ URL เป้าหมาย
const WT_DEFAULT_PROXY = 'https://api.allorigins.win/raw?url={url}';

// state ชั่วคราวระหว่างเปิด modal (ผลลัพธ์ preview ล่าสุด)
const WT = { mode: 'toc', baseUrl: '', links: [], single: null };

// ─── ชั้น fetch (ข้าม CORS ผ่าน proxy) ───
function wtGetProxy() {
  const p = (S.currentWs && S.currentWs.settings && S.currentWs.settings.importProxy || '').trim();
  return p || WT_DEFAULT_PROXY;
}

function buildProxyUrl(template, targetUrl) {
  const tpl = (template || WT_DEFAULT_PROXY).trim();
  const enc = encodeURIComponent(targetUrl);
  if (tpl.includes('{url}')) return tpl.replace('{url}', enc);
  // ไม่มี placeholder — ต่อท้ายแบบ encode
  return tpl + enc;
}

async function wtFetchHtml(url) {
  const proxied = buildProxyUrl(wtGetProxy(), url);
  let res;
  try {
    res = await fetch(proxied, { redirect: 'follow' });
  } catch (err) {
    throw new Error('เชื่อมต่อ proxy ไม่ได้ — ตรวจอินเทอร์เน็ต หรือเปลี่ยน URL proxy ใน ⚙ ตั้งค่า (' + (err.message || err) + ')');
  }
  if (!res.ok) {
    throw new Error('proxy ตอบ HTTP ' + res.status + ' — เว็บอาจบล็อก หรือ proxy มี rate limit · ลองเปลี่ยน proxy ใน ⚙ ตั้งค่า');
  }
  const html = await res.text();
  if (!html || html.length < 50) throw new Error('ได้เนื้อหาว่างจาก proxy — ลองเปลี่ยน proxy หรือตรวจ URL');
  return html;
}

// ─── ชั้น parse ───
function wtParse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function wtResolveUrl(href, base) {
  try { return new URL(href, base).href; } catch (_) { return null; }
}

// แปลง element → ข้อความคงย่อหน้า (block element = ขึ้นย่อหน้าใหม่, <br> = ขึ้นบรรทัด)
const WT_BLOCK_TAGS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','SECTION','ARTICLE','TR','UL','OL','FIGURE']);
function wtNodeText(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += child.nodeValue; }
    else if (child.nodeType === 1) {
      const tag = child.tagName;
      if (tag === 'BR') { out += '\n'; continue; }
      const inner = wtNodeText(child);
      out += WT_BLOCK_TAGS.has(tag) ? ('\n' + inner + '\n') : inner;
    }
  }
  return out;
}

// ทำความสะอาด + แปลงเป็นข้อความ (ย่อหน้าคั่นด้วยบรรทัดว่าง)
function wtCleanToText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,nav,header,footer,iframe,ins,form,button,svg,.ads,[class*="ad-"],[class*="-ad"],[id*="banner"],[class*="share"],[class*="comment"]').forEach(n => n.remove());
  const raw = wtNodeText(clone);
  return raw.split('\n').map(s => s.trim()).filter(Boolean).join('\n\n');
}

// selector ยอดนิยมของกล่องเนื้อหาตอน
const WT_CONTENT_SELECTORS = [
  '.chapter-content', '.entry-content', '.reading-content', '.text-left', '.cha-content',
  '.chapter-c', '#chapter-content', '#content', '.post-content', '.article-content',
  '.novel-content', '.chapter', '.content', 'article', '.text', 'main',
];

function wtExtractContent(doc, contentSelector) {
  let el = null;
  if (contentSelector && contentSelector.trim()) {
    el = doc.querySelector(contentSelector.trim());
    if (!el) throw new Error('ไม่พบ element ตาม selector ที่ตั้ง: ' + contentSelector);
  } else {
    // heuristic: เลือก candidate ที่มีข้อความมากสุด
    let best = null, bestLen = 0;
    for (const sel of WT_CONTENT_SELECTORS) {
      doc.querySelectorAll(sel).forEach(c => {
        const len = (c.textContent || '').trim().length;
        if (len > bestLen) { bestLen = len; best = c; }
      });
    }
    el = (best && bestLen > 200) ? best : doc.body;
  }
  const text = wtCleanToText(el);
  // หาชื่อตอน: h1/h2 ในเนื้อหา → h1 ของหน้า → <title>
  let title = '';
  const h = el.querySelector('h1,h2') || doc.querySelector('h1') || doc.querySelector('title');
  if (h) title = (h.textContent || '').trim();
  if (!title) title = (doc.title || '').trim();
  return { title: title || 'ตอนนำเข้า', text };
}

// คอนเทนเนอร์รายชื่อตอนยอดนิยม (หน้าสารบัญ)
const WT_LIST_SELECTORS = [
  '.chapter-list', '.chapters', '#chapters', '.list-chapter', '.episode-list',
  '.wp-manga-chapter', '.toc', '#toc', '.su-spoiler-content', 'ul.main', '.panel-body',
];

function wtExtractLinks(doc, baseUrl, linkSelector) {
  let anchors = [];
  if (linkSelector && linkSelector.trim()) {
    anchors = Array.from(doc.querySelectorAll(linkSelector.trim()));
  } else {
    // หา container รายชื่อตอนที่มีลิงก์มากพอก่อน
    for (const sel of WT_LIST_SELECTORS) {
      for (const cont of doc.querySelectorAll(sel)) {
        const a = cont.querySelectorAll('a[href]');
        if (a.length >= 3) { anchors = Array.from(a); break; }
      }
      if (anchors.length) break;
    }
    // fallback: ลิงก์ทั้งหน้า (จะกรองด้วย hostname ด้านล่าง)
    if (!anchors.length) anchors = Array.from(doc.querySelectorAll('a[href]'));
  }

  let baseHost = '';
  try { baseHost = new URL(baseUrl).hostname; } catch (_) {}

  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const abs = wtResolveUrl(href, baseUrl);
    if (!abs || !/^https?:/i.test(abs)) continue;
    // เมื่อไม่ได้ตั้ง selector เอง ให้จำกัดเฉพาะโดเมนเดียวกัน กัน nav/โฆษณานอกเว็บ
    if (!(linkSelector && linkSelector.trim()) && baseHost) {
      try { if (new URL(abs).hostname !== baseHost) continue; } catch (_) { continue; }
    }
    const cleanUrl = abs.split('#')[0];
    if (seen.has(cleanUrl)) continue;
    const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
    if (!title || title.length > 200) continue;
    seen.add(cleanUrl);
    out.push({ title, url: cleanUrl });
  }
  return out;
}

// ─── UI ───
function openWebImport() {
  if (!S.currentWsId) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  WT.links = []; WT.single = null; WT.baseUrl = '';
  const st = (S.currentWs && S.currentWs.settings) || {};
  document.getElementById('wtUrl').value = '';
  document.getElementById('wtProxy').value = st.importProxy || WT_DEFAULT_PROXY;
  document.getElementById('wtContentSel').value = st.importContentSelector || '';
  document.getElementById('wtLinkSel').value = st.importLinkSelector || '';
  document.getElementById('wtPreview').innerHTML = '';
  wtSetMode('toc');
  openModal('modal-web-import');
}

function wtSetMode(mode) {
  WT.mode = mode;
  const setBtn = (el, on) => {
    if (!el) return;
    el.classList.toggle('btn-primary', on);
    el.classList.toggle('btn-ghost', !on);
  };
  setBtn(document.getElementById('wtModeToc'), mode === 'toc');
  setBtn(document.getElementById('wtModeSingle'), mode === 'single');
  // selector ของลิงก์เกี่ยวกับโหมดสารบัญเท่านั้น
  const lw = document.getElementById('wtLinkSelWrap');
  if (lw) lw.style.display = mode === 'toc' ? 'block' : 'none';
}

// อ่านค่า proxy/selector ชั่วคราวจากในฟอร์ม modal (ไม่บังคับให้ไปบันทึกที่ Settings)
function wtApplyFormToSettings() {
  if (!S.currentWs.settings) S.currentWs.settings = {};
  S.currentWs.settings.importProxy = document.getElementById('wtProxy').value.trim();
}

async function wtPreview() {
  const url = document.getElementById('wtUrl').value.trim();
  if (!url) { showToast('ใส่ URL ก่อน', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) { showToast('URL ต้องขึ้นต้นด้วย http:// หรือ https://', 'error'); return; }
  wtApplyFormToSettings();
  const contentSel = document.getElementById('wtContentSel').value.trim();
  const linkSel = document.getElementById('wtLinkSel').value.trim();
  const pv = document.getElementById('wtPreview');
  pv.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:0.85rem">⏳ กำลังดึงข้อมูลผ่าน proxy...</div>';
  try {
    const html = await wtFetchHtml(url);
    const doc = wtParse(html);
    WT.baseUrl = url;
    if (WT.mode === 'toc') {
      const links = wtExtractLinks(doc, url, linkSel);
      WT.links = links;
      wtRenderTocPreview(links);
    } else {
      const c = wtExtractContent(doc, contentSel);
      WT.single = c;
      wtRenderSinglePreview(c);
    }
  } catch (err) {
    pv.innerHTML = '<div style="padding:14px;color:var(--crimson-light);font-size:0.85rem">❌ ' + esc(err.message || String(err)) + '</div>';
  }
}

function wtRenderSinglePreview(c) {
  const pv = document.getElementById('wtPreview');
  if (!c.text || c.text.length < 20) {
    pv.innerHTML = '<div style="padding:14px;color:var(--crimson-light);font-size:0.85rem">⚠ ดึงเนื้อหาแทบไม่ได้ — ลองระบุ CSS selector ของกล่องเนื้อหาในส่วน Advanced (เช่น <code>.chapter-content</code>)</div>';
    return;
  }
  const preview = c.text.slice(0, 1500);
  pv.innerHTML = `
    <div class="sf-group"><div class="sf-label">ชื่อตอน (แก้ได้)</div>
      <input id="wtSingleTitle" type="text" class="text-input" value="${esc(c.title)}"/></div>
    <div style="font-size:0.74rem;color:var(--text-muted);margin:4px 0">ความยาว ${c.text.length.toLocaleString()} ตัวอักษร — แสดงตัวอย่าง 1,500 ตัวแรก</div>
    <div style="white-space:pre-wrap;max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-deep);font-size:0.82rem;line-height:1.6">${esc(preview)}${c.text.length > 1500 ? '\n\n…' : ''}</div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-primary" onclick="wtImportSingle()">➕ เพิ่มเป็นตอน</button>
    </div>`;
}

function wtRenderTocPreview(links) {
  const pv = document.getElementById('wtPreview');
  if (!links.length) {
    pv.innerHTML = '<div style="padding:14px;color:var(--crimson-light);font-size:0.85rem">⚠ ไม่พบรายชื่อตอน — ลองระบุ CSS selector ของลิงก์ตอนในส่วน Advanced (เช่น <code>.chapter-list a</code>) หรือสลับไปโหมด "ตอนเดียว"</div>';
    return;
  }
  const rows = links.map((l, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" class="wt-chk" data-idx="${i}" checked style="accent-color:var(--gold)"/>
      <span style="font-size:0.72rem;color:var(--text-muted);min-width:34px">#${i + 1}</span>
      <span style="font-size:0.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.title)}</span>
    </label>`).join('');
  pv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="display:flex;gap:6px">
        <button class="btn-xs" onclick="wtToggleAll(true)">เลือกทั้งหมด</button>
        <button class="btn-xs" onclick="wtToggleAll(false)">ยกเลิก</button>
      </div>
      <span style="font-size:0.74rem;color:var(--text-muted)">พบ ${links.length} ตอน</span>
    </div>
    <div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-deep)">${rows}</div>
    <div id="wtProgressBox" style="display:none;margin-top:10px">
      <div class="progress-label-row"><span id="wtProgressLabel">กำลังดึง...</span><span id="wtProgressPct">0%</span></div>
      <div class="progress-track"><div class="progress-fill" id="wtProgressFill"></div></div>
    </div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-primary" id="wtImportBtn" onclick="wtImportSelected()">⬇ ดึง &amp; เพิ่มตอนที่เลือก</button>
    </div>`;
}

function wtToggleAll(on) {
  document.querySelectorAll('#wtPreview .wt-chk').forEach(c => { c.checked = on; });
}

// chapterNum ต่อจาก max เดิม (เหมือน handleEpubImport)
function wtNextChapterNum() {
  const nums = (S.currentWs.chapters || []).map(c => c.chapterNum || 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function wtMakeChapter(title, text, num, sourceUrl) {
  return {
    id: genId(),
    title: title || ('ตอนที่ ' + num),
    chapterNum: num,
    sourceText: text,
    translation: '',
    status: 'pending',
    notes: 'นำเข้าจาก URL: ' + (sourceUrl || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: (text || '').length,
  };
}

async function wtImportSingle() {
  if (!WT.single) return;
  const title = (document.getElementById('wtSingleTitle')?.value || WT.single.title || '').trim();
  const num = wtNextChapterNum();
  S.currentWs.chapters.push(wtMakeChapter(title, WT.single.text, num, WT.baseUrl));
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  if (typeof updateChapterSaveSelect === 'function') updateChapterSaveSelect();
  closeModal('modal-web-import');
  showToast('เพิ่มตอน "' + title + '" ✓', 'success');
}

async function wtImportSelected() {
  const checked = Array.from(document.querySelectorAll('#wtPreview .wt-chk:checked'))
    .map(c => WT.links[parseInt(c.dataset.idx, 10)]).filter(Boolean);
  if (!checked.length) { showToast('เลือกตอนที่จะดึงก่อน', 'error'); return; }

  const contentSel = document.getElementById('wtContentSel').value.trim();
  const btn = document.getElementById('wtImportBtn');
  const box = document.getElementById('wtProgressBox');
  const fill = document.getElementById('wtProgressFill');
  const lbl = document.getElementById('wtProgressLabel');
  const pct = document.getElementById('wtProgressPct');
  if (btn) btn.disabled = true;
  if (box) box.style.display = 'block';

  let num = wtNextChapterNum();
  let added = 0, failed = 0;
  for (let i = 0; i < checked.length; i++) {
    const l = checked[i];
    if (lbl) lbl.textContent = `กำลังดึง ${i + 1}/${checked.length}: ${l.title}`;
    try {
      const html = await wtFetchHtml(l.url);
      const doc = wtParse(html);
      const c = wtExtractContent(doc, contentSel);
      // ใช้ชื่อจากรายการสารบัญถ้าเนื้อหาไม่มีหัวเรื่องที่ดี
      const title = c.title && c.title !== 'ตอนนำเข้า' ? c.title : l.title;
      if (c.text && c.text.length >= 20) {
        S.currentWs.chapters.push(wtMakeChapter(title, c.text, num++, l.url));
        added++;
      } else { failed++; }
    } catch (_) { failed++; }
    const p = Math.round(((i + 1) / checked.length) * 100);
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
    // หน่วงเล็กน้อยกันโดน rate limit ของ proxy/เว็บ
    if (i < checked.length - 1) await new Promise(r => setTimeout(r, 350));
  }

  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  if (typeof updateChapterSaveSelect === 'function') updateChapterSaveSelect();
  if (btn) btn.disabled = false;
  const failNote = failed ? ` · ดึงไม่สำเร็จ ${failed} ตอน (ลองตั้ง selector)` : '';
  if (added) {
    closeModal('modal-web-import');
    showToast(`เพิ่ม ${added} ตอน ✓${failNote}`, 'success');
  } else {
    showToast('ดึงไม่สำเร็จทั้งหมด — ลองระบุ CSS selector ของเนื้อหา' + failNote, 'error');
  }
}
