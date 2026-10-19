// ═══ text.js — นับคำ, ตรวจชื่อใน Codex, escape, ประมาณ token ═══

let _seg = null;
try {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    _seg = new Intl.Segmenter('th', { granularity: 'word' });
  }
} catch { /* บาง browser ไม่มี Segmenter */ }

// นับคำภาษาไทย (ไม่มีเว้นวรรคคั่นคำ) — ใช้ Intl.Segmenter ถ้ามี
export function countWords(text) {
  if (!text) return 0;
  if (_seg) {
    let n = 0;
    for (const s of _seg.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  // fallback หยาบๆ: ช่วงอักษรไทยประมาณ 4 ตัวอักษร = 1 คำ + คำละตินตามช่องว่าง
  const thai = (text.match(/[฀-๿]/g) || []).length;
  const latin = (text.replace(/[฀-๿]/g, ' ').match(/\S+/g) || []).length;
  return Math.round(thai / 4) + latin;
}

// ประมาณ token จากจำนวนตัวอักษร (ไทย ~2-4 ตัวอักษร/token)
export function estimateTokens(chars) {
  return Math.ceil(chars / 3);
}

export function fmtNum(n) {
  return (n || 0).toLocaleString('th-TH');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── ตรวจชื่อจาก Codex ในเนื้อหา ──
// คืน entry ที่ชื่อหรือ alias ปรากฏในข้อความ (ภาษาไทยไม่มี word boundary → ใช้ substring match)
export function detectCodexMentions(text, codexEntries) {
  if (!text) return [];
  return codexEntries.filter(e =>
    allNames(e).some(n => n.length >= 2 && text.includes(n))
  );
}

export function allNames(entry) {
  return [entry.name, ...(entry.aliases || [])].map(s => (s || '').trim()).filter(Boolean);
}

// สร้าง regex รวมทุกชื่อ (ยาวก่อน เพื่อ match ชื่อยาวสุด) — คืน null ถ้าไม่มีชื่อ
export function buildNamesRegex(codexEntries) {
  const names = [];
  for (const e of codexEntries) {
    for (const n of allNames(e)) {
      if (n.length >= 2) names.push({ n, e });
    }
  }
  if (!names.length) return null;
  names.sort((a, b) => b.n.length - a.n.length);
  const map = new Map(names.map(({ n, e }) => [n, e]));
  const re = new RegExp(names.map(({ n }) => escapeRegex(n)).join('|'), 'g');
  return { re, map };
}

// ไฮไลต์ชื่อ Codex ในข้อความ → HTML (ใช้กับ backdrop ของ editor)
export function highlightCodexHtml(text, codexEntries) {
  const built = buildNamesRegex(codexEntries);
  if (!built || !text || text.length > 300000) return escapeHtml(text);
  const { re, map } = built;
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    const entry = map.get(m[0]);
    out += escapeHtml(text.slice(last, m.index));
    out += `<mark class="t-${entry?.type || 'other'}">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // กัน infinite loop
  }
  out += escapeHtml(text.slice(last));
  return out;
}

export function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// debounce ธรรมดา
export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); t = null; fn(...args); };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  wrapped.pending = () => t !== null;
  return wrapped;
}
