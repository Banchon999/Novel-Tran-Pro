// ═══════════════════════════════════════════════
// KnowFacts Factory — App (UI, views, batch pipeline)
// ═══════════════════════════════════════════════
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ─── Toast ───
let _toastTimer = null;
function showToast(msg, type = '') {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.className = 'toast', 3200);
}

// ─── Modal ───
function openModal(html, cls = '') {
  const back = $('modalBack');
  $('modalBody').innerHTML = html;
  $('modalBody').className = 'modal ' + cls;
  back.classList.add('show');
}
function closeModal() { $('modalBack').classList.remove('show'); }

async function copyText(text, label = 'คัดลอกแล้ว') {
  try { await navigator.clipboard.writeText(text); showToast('📋 ' + label, 'success'); }
  catch { showToast('คัดลอกไม่สำเร็จ — กดค้างเพื่อเลือกเอง', 'error'); }
}

// ═══════════════════════════════════════════════
// ─── Init ───
// ═══════════════════════════════════════════════
async function init() {
  loadCosts();
  await loadState();
  setView('board');
  updateCostUI();
  // SW
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── View routing ───
let _view = 'board';
function setView(v) {
  _view = v;
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  render();
}

function render() {
  const main = $('main');
  if (_view === 'board')    main.innerHTML = viewBoard();
  else if (_view === 'collect') main.innerHTML = viewCollect();
  else if (_view === 'score')   main.innerHTML = viewScore();
  else if (_view === 'schedule')main.innerHTML = viewSchedule();
  else if (_view === 'settings')main.innerHTML = viewSettings();
  if (_view === 'settings') syncSettingsUI();
  if (_view === 'collect')  syncCollectUI();
}

// ─── Helpers on facts ───
function getFact(id) { return KF.facts.find(f => f.id === id); }
function seriesName(id) { const s = KF.series.find(x => x.id === id); return s ? `${s.emoji} ${s.name}` : ''; }
function bumpStage(fact, stageId) {
  if (stageIndex(stageId) > stageIndex(fact.stage)) fact.stage = stageId;
}
function filteredFacts() {
  const { stage, series, q } = KF.filter;
  const qq = q.trim().toLowerCase();
  return KF.facts.filter(f =>
    (stage === 'all' || f.stage === stage) &&
    (series === 'all' || f.series === series) &&
    (!qq || (f.topic + ' ' + f.fact).toLowerCase().includes(qq))
  );
}

// ═══════════════════════════════════════════════
// ─── VIEW: Factory Board (Kanban = โครงสร้าง Folder) ───
// ═══════════════════════════════════════════════
function viewBoard() {
  const seriesOpts = `<option value="all">ทุกซีรีส์</option>` +
    KF.series.map(s => `<option value="${s.id}" ${KF.filter.series===s.id?'selected':''}>${esc(s.emoji)} ${esc(s.name)}</option>`).join('');
  const cols = STAGES.map(st => {
    const items = KF.facts.filter(f => f.stage === st.id &&
      (KF.filter.series === 'all' || f.series === KF.filter.series) &&
      (!KF.filter.q || (f.topic + ' ' + f.fact).toLowerCase().includes(KF.filter.q.toLowerCase())));
    return `<div class="col">
      <div class="col-head"><span>${st.emoji} ${st.label}</span><span class="badge">${items.length}</span></div>
      <div class="col-sub">${st.desc}</div>
      <div class="col-body">${items.map(cardHTML).join('') || '<div class="empty-col">— ว่าง —</div>'}</div>
    </div>`;
  }).join('');

  return `<div class="view-head">
      <h1>🏭 Factory — ${esc(KF.settings.channelName)}</h1>
      <div class="head-actions">
        <input class="inp" id="boardSearch" placeholder="🔍 ค้นหา..." value="${esc(KF.filter.q)}" oninput="KF.filter.q=this.value;rerenderBoardBody()"/>
        <select class="inp" onchange="KF.filter.series=this.value;render()">${seriesOpts}</select>
        <button class="btn" onclick="setView('collect')">＋ หา Fact</button>
      </div>
    </div>
    <div class="stat-row">${statRowHTML()}</div>
    <div class="board">${cols}</div>`;
}

function statRowHTML() {
  const total = KF.facts.length;
  const counts = STAGES.map(st => `<span class="chip"><b>${KF.facts.filter(f=>f.stage===st.id).length}</b> ${st.emoji}</span>`).join('');
  const ready = KF.facts.filter(f => f.stage === 'published').length;
  return `<span class="chip">รวม <b>${total}</b> คลิป</span>${counts}<span class="chip">🚀 เผยแพร่ <b>${ready}</b></span>`;
}

function rerenderBoardBody() { if (_view === 'board') render(); }

function cardHTML(f) {
  const sc = f.scores;
  const badge = sc ? `<span class="score-badge ${sc.total>=KF.settings.minTotalScore?'good':'low'}">★${sc.total}</span>` : '';
  const sName = f.series ? `<span class="card-series">${esc(seriesName(f.series))}${f.ep?` · EP${f.ep}`:''}</span>` : '';
  return `<div class="card" onclick="openItem('${f.id}')">
    <div class="card-top">${sName}${badge}</div>
    <div class="card-topic">${esc(f.topic || '—')}</div>
    <div class="card-fact">${esc(f.fact)}</div>
    <div class="card-foot">${pipelineDots(f)}</div>
  </div>`;
}

// จุดสถานะ pipeline ของแต่ละคลิป
function pipelineDots(f) {
  const steps = [
    ['📝', f.script], ['🖼️', f.scenes && f.scenes.length], ['🎙️', f.voiceDone], ['🎬', f.videoDone], ['🚀', f.stage==='published'],
  ];
  return steps.map(([e, on]) => `<span class="dot ${on?'on':''}">${e}</span>`).join('');
}

// ═══════════════════════════════════════════════
// ─── VIEW: Collect / หา Fact ───
// ═══════════════════════════════════════════════
function viewCollect() {
  const seriesOpts = `<option value="">— ไม่ระบุซีรีส์ —</option>` +
    KF.series.map(s => `<option value="${s.id}">${esc(s.emoji)} ${esc(s.name)}</option>`).join('');
  return `<div class="view-head"><h1>💡 รวบรวม & หา Fact</h1></div>
    <div class="panel">
      <p class="hint">วางลิงก์/หัวข้อ/บทความที่เก็บมา (Wikipedia, Reddit TIL, ScienceAlert ฯลฯ) แล้วให้ AI ดึง Fact ที่ "คนส่วนใหญ่ไม่รู้ + อธิบายได้ใน 20 วิ + น่าตกใจ + มีหลักฐาน"</p>
      <textarea class="inp ta" id="srcText" rows="9" placeholder="วางแหล่งข้อมูลที่นี่...">${esc(DEFAULT_SOURCES)}</textarea>
      <div class="form-row">
        <label>ซีรีส์ <select class="inp" id="srcSeries">${seriesOpts}</select></label>
        <label>จำนวน <input class="inp sm" id="srcCount" type="number" value="30" min="5" max="100"/></label>
        <button class="btn primary" id="findBtn" onclick="runFindFacts()">🔎 หา Fact</button>
      </div>
      <div id="findProgress" class="progress-box" style="display:none"></div>
    </div>
    <div class="panel">
      <h3>📋 NotebookLM Workflow</h3>
      <p class="hint">ทำตามลำดับ: รวบรวมลิงก์ทั้งหมด → โยนเข้า NotebookLM → ใช้ปุ่มด้านบนเพื่อให้ AI สกัด Fact → ให้คะแนน Viral → คัด ≥ ${KF.settings.minTotalScore} คะแนน → สร้าง Script/ภาพ/เสียง → ตัดต่อ → ตั้งเวลาโพสต์</p>
      <ol class="flow">
        <li>รวบรวมข้อมูล 50–100 บทความ/สัปดาห์</li>
        <li>AI หา Fact 100 ข้อ (ปุ่มด้านบน)</li>
        <li>AI ให้คะแนน Viral → เก็บคะแนนรวม ≥ ${KF.settings.minTotalScore}</li>
        <li>AI เขียน Script (Hook/Fact/Explanation/Question ≤ 50 คำ)</li>
        <li>AI แตก 4 ฉาก + Prompt ภาพอังกฤษ</li>
        <li>สร้างภาพ 4 ภาพ/คลิป (Gemini/ChatGPT/Flux)</li>
        <li>TTS เสียงเดิมทั้งช่อง → ตัดต่อ Template เดียว</li>
      </ol>
    </div>`;
}
function syncCollectUI() {}

async function runFindFacts() {
  const sources = $('srcText').value.trim();
  if (!sources) return showToast('ใส่แหล่งข้อมูลก่อน', 'error');
  const count = Math.max(5, Math.min(100, parseInt($('srcCount').value) || 30));
  const seriesId = $('srcSeries').value;
  const sName = seriesId ? KF.series.find(s => s.id === seriesId)?.name : '';
  const btn = $('findBtn'); const box = $('findProgress');
  btn.disabled = true; btn.textContent = '⏳ กำลังหา...';
  box.style.display = 'block'; box.innerHTML = '🤖 AI กำลังสกัด Fact... อาจใช้เวลาสักครู่';
  KF._abort = new AbortController();
  try {
    const facts = await kfFindFacts({ sources, count, seriesName: sName }, KF._abort.signal);
    if (!facts.length) { box.innerHTML = '⚠ ไม่พบ Fact ที่ตรงเงื่อนไข — ลองเพิ่มแหล่งข้อมูล'; return; }
    let ep = nextEp(seriesId);
    facts.forEach(f => {
      KF.facts.push({
        id: genId(), topic: f.topic, fact: f.fact, explain: f.explain,
        series: seriesId || '', ep: seriesId ? ep++ : null,
        scores: null, script: null, scenes: null,
        voiceDone: false, videoDone: false, publishSlot: '',
        stage: 'ideas', createdAt: Date.now(),
      });
    });
    saveState(true);
    box.innerHTML = `✅ เพิ่ม <b>${facts.length}</b> Fact เข้า Ideas แล้ว`;
    showToast(`เพิ่ม ${facts.length} Fact ✓`, 'success');
    setTimeout(() => setView('score'), 900);
  } catch (e) {
    if (e.name === 'AbortError') box.innerHTML = '⏹ ยกเลิกแล้ว';
    else box.innerHTML = '❌ ' + esc(e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔎 หา Fact'; KF._abort = null;
  }
}
function nextEp(seriesId) {
  if (!seriesId) return null;
  const eps = KF.facts.filter(f => f.series === seriesId && f.ep).map(f => f.ep);
  return eps.length ? Math.max(...eps) + 1 : 1;
}

// ═══════════════════════════════════════════════
// ─── VIEW: Score / คะแนน Viral ───
// ═══════════════════════════════════════════════
function viewScore() {
  const scored = KF.facts.filter(f => f.scores).sort((a, b) => b.scores.total - a.scores.total);
  const unscored = KF.facts.filter(f => !f.scores).length;
  const rows = scored.map(f => {
    const s = f.scores;
    const good = s.total >= KF.settings.minTotalScore;
    return `<tr class="${good?'':'row-low'}">
      <td onclick="openItem('${f.id}')" class="lk"><b>${esc(f.topic||'—')}</b><br><span class="muted">${esc(f.fact.slice(0,70))}</span></td>
      <td>${s.shock}</td><td>${s.curiosity}</td><td>${s.share}</td>
      <td><b class="${good?'good':'low'}">${s.total}</b></td>
      <td><button class="btn xs" onclick="delFact('${f.id}')">🗑</button></td>
    </tr>`;
  }).join('');
  return `<div class="view-head"><h1>🔥 คะแนน Viral</h1>
      <div class="head-actions">
        <button class="btn primary" id="scoreBtn" onclick="runScoreAll()" ${unscored?'':'disabled'}>⭐ ให้คะแนน (${unscored} ใหม่)</button>
        <button class="btn" onclick="pruneLow()">🧹 ลบที่ต่ำกว่า ${KF.settings.minTotalScore}</button>
      </div></div>
    <div id="scoreProgress" class="progress-box" style="display:none"></div>
    <div class="panel">
      <p class="hint">ให้คะแนน Shock + Curiosity + Shareability (อย่างละ 1–10) เรียงมาก→น้อย · เก็บเฉพาะคะแนนรวม ≥ <b>${KF.settings.minTotalScore}</b> (ตั้งค่าได้ในหน้า ⚙)</p>
      <table class="tbl"><thead><tr><th>หัวข้อ / Fact</th><th>Shock</th><th>Curio</th><th>Share</th><th>รวม</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty-col">ยังไม่มี Fact ที่ให้คะแนน — กดปุ่มด้านบน</td></tr>'}</tbody></table>
    </div>`;
}

async function runScoreAll() {
  const todo = KF.facts.filter(f => !f.scores);
  if (!todo.length) return;
  const btn = $('scoreBtn'); const box = $('scoreProgress');
  btn.disabled = true; box.style.display = 'block';
  KF._abort = new AbortController();
  // แบ่งเป็นชุดละ 30 เพื่อให้ AI ตอบครบ
  const chunks = [];
  for (let i = 0; i < todo.length; i += 30) chunks.push(todo.slice(i, i + 30));
  let done = 0;
  try {
    for (const ch of chunks) {
      box.innerHTML = `⭐ ให้คะแนน ${done}/${todo.length}...`;
      const map = await kfScore(ch, KF._abort.signal);
      ch.forEach(f => { if (map[f.id]) f.scores = map[f.id]; });
      done += ch.length; saveState(true);
    }
    box.innerHTML = `✅ ให้คะแนนครบ ${done} ข้อ`;
    showToast('ให้คะแนนเสร็จ ✓', 'success');
    render();
  } catch (e) {
    box.innerHTML = e.name === 'AbortError' ? '⏹ ยกเลิก' : '❌ ' + esc(e.message);
  } finally { btn.disabled = false; KF._abort = null; }
}

function pruneLow() {
  const low = KF.facts.filter(f => f.scores && f.scores.total < KF.settings.minTotalScore && f.stage === 'ideas');
  if (!low.length) return showToast('ไม่มีรายการคะแนนต่ำใน Ideas', '');
  if (!confirm(`ลบ ${low.length} Fact ที่คะแนน < ${KF.settings.minTotalScore} (เฉพาะที่ยังอยู่ใน Ideas)?`)) return;
  const ids = new Set(low.map(f => f.id));
  KF.facts = KF.facts.filter(f => !ids.has(f.id));
  saveState(true); render(); showToast(`ลบ ${low.length} รายการ`, 'success');
}

function delFact(id) {
  if (!confirm('ลบ Fact นี้?')) return;
  KF.facts = KF.facts.filter(f => f.id !== id);
  saveState(true); render();
}

// ═══════════════════════════════════════════════
// ─── ITEM DETAIL (pipeline ต่อคลิป) ───
// ═══════════════════════════════════════════════
function openItem(id) {
  const f = getFact(id);
  if (!f) return;
  openModal(itemHTML(f), 'wide');
}

function itemHTML(f) {
  const s = f.script;
  const vt = voiceText(f);
  const wc = wordCount(vt);
  const seriesSel = `<option value="">— ไม่มีซีรีส์ —</option>` +
    KF.series.map(x => `<option value="${x.id}" ${f.series===x.id?'selected':''}>${esc(x.emoji)} ${esc(x.name)}</option>`).join('');
  const stageSel = STAGES.map(st => `<option value="${st.id}" ${f.stage===st.id?'selected':''}>${st.emoji} ${st.label}</option>`).join('');

  const scoreHTML = f.scores
    ? `<span class="chip">Shock ${f.scores.shock}</span><span class="chip">Curio ${f.scores.curiosity}</span><span class="chip">Share ${f.scores.share}</span><span class="chip ${f.scores.total>=KF.settings.minTotalScore?'ok':'bad'}">รวม ${f.scores.total}</span>`
    : `<span class="muted">ยังไม่ให้คะแนน</span>`;

  const scriptHTML = s
    ? `<div class="script-box">
        <div class="sline"><b>Hook:</b> ${esc(s.hook)}</div>
        <div class="sline"><b>Fact:</b> ${esc(s.fact)}</div>
        <div class="sline"><b>Explanation:</b> ${esc(s.explanation)}</div>
        <div class="sline"><b>Question:</b> ${esc(s.question)}</div>
        <div class="wc ${wc>50?'over':''}">${wc} คำ ${wc>50?'⚠ เกิน 50':''}</div>
      </div>`
    : `<p class="muted">ยังไม่มีสคริปต์</p>`;

  const scenesHTML = (f.scenes && f.scenes.length)
    ? f.scenes.map(sc => `<div class="scene">
        <div class="scene-h">🎬 Scene ${sc.n} <span class="muted">${esc(sc.caption)}</span>
          <button class="btn xs" onclick="copyText(${JSON.stringify(sc.prompt).replace(/"/g,'&quot;')},'คัดลอก prompt ฉาก ${sc.n}')">📋</button></div>
        <div class="scene-p">${esc(sc.prompt)}</div>
      </div>`).join('')
    : `<p class="muted">ยังไม่แตกฉาก</p>`;

  const timelineHTML = s ? TIMELINE.map(t => `<div class="tl"><span class="tl-range">${t.range}</span><span class="tl-label">${t.label}</span><span class="tl-text">${esc(s[t.part]||'')}</span></div>`).join('') : '';

  return `<div class="item-head">
      <div><div class="item-topic">${esc(f.topic||'—')}</div>
      <div class="item-meta">${scoreHTML}</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="item-fact"><b>Fact:</b> ${esc(f.fact)}<br><span class="muted">${esc(f.explain||'')}</span></div>

    <div class="item-controls">
      <label>ซีรีส์ <select class="inp" onchange="setField('${f.id}','series',this.value)">${seriesSel}</select></label>
      <label>สถานะ <select class="inp" onchange="setField('${f.id}','stage',this.value)">${stageSel}</select></label>
    </div>

    <div class="step">
      <div class="step-h"><span>4️⃣ Script (Hook · Fact · Explanation · Question ≤ 50 คำ)</span>
        <span><button class="btn xs" onclick="genScript('${f.id}')">${s?'↻ ใหม่':'✍️ สร้าง'}</button>
        ${s?`<button class="btn xs" onclick="copyText(${JSON.stringify(vt).replace(/"/g,'&quot;')},'คัดลอกสคริปต์')">📋</button>`:''}</span>
      </div>
      ${scriptHTML}
    </div>

    <div class="step">
      <div class="step-h"><span>5️⃣ แตก 4 ฉาก + Prompt ภาพ (documentary · realistic · 4K)</span>
        <button class="btn xs" onclick="genScenes('${f.id}')" ${s?'':'disabled'}>${f.scenes?'↻ ใหม่':'🎬 สร้าง'}</button>
      </div>
      ${scenesHTML}
    </div>

    <div class="step">
      <div class="step-h"><span>7️⃣ เสียง (TTS — ${esc(KF.settings.ttsVoice)})</span>
        ${vt?`<span><button class="btn xs" onclick="copyText(${JSON.stringify(vt).replace(/"/g,'&quot;')},'คัดลอกข้อความพากย์')">📋 คัดลอกบทพากย์</button>
        <button class="btn xs ${f.voiceDone?'on':''}" onclick="toggleFlag('${f.id}','voiceDone')">${f.voiceDone?'✅ อัดแล้ว':'☐ อัดเสียง'}</button></span>`:''}
      </div>
      ${vt?`<pre class="voice-pre">${esc(vt)}</pre>`:'<p class="muted">สร้างสคริปต์ก่อน</p>'}
    </div>

    <div class="step">
      <div class="step-h"><span>8️⃣ ตัดต่อ (Template เดียว + Auto Caption)</span>
        <button class="btn xs ${f.videoDone?'on':''}" onclick="toggleFlag('${f.id}','videoDone')">${f.videoDone?'✅ ตัดแล้ว':'☐ ตัดต่อ'}</button>
      </div>
      ${timelineHTML?`<div class="timeline">${timelineHTML}</div>`:'<p class="muted">สร้างสคริปต์ก่อน</p>'}
    </div>

    <div class="step">
      <div class="step-h"><span>🚀 เผยแพร่</span></div>
      <div class="publish-row">
        <label>เวลาโพสต์ <select class="inp" onchange="setField('${f.id}','publishSlot',this.value)">
          <option value="">—</option>${POST_SLOTS.map(t=>`<option value="${t}" ${f.publishSlot===t?'selected':''}>${t}</option>`).join('')}
        </select></label>
        <button class="btn primary" onclick="publishItem('${f.id}')">🚀 ทำเครื่องหมายเผยแพร่</button>
        <button class="btn danger" onclick="delFact('${f.id}');closeModal()">🗑 ลบ</button>
      </div>
    </div>`;
}

// ─── Item field setters ───
function setField(id, field, val) {
  const f = getFact(id); if (!f) return;
  f[field] = val;
  if (field === 'stage') { /* manual override allowed */ }
  saveState(); refreshIfBoard();
}
function toggleFlag(id, flag) {
  const f = getFact(id); if (!f) return;
  f[flag] = !f[flag];
  if (flag === 'voiceDone' && f[flag]) bumpStage(f, 'voice');
  if (flag === 'videoDone' && f[flag]) bumpStage(f, 'videos');
  saveState(true); openModal(itemHTML(f), 'wide');
}
function publishItem(id) {
  const f = getFact(id); if (!f) return;
  f.stage = 'published'; f.publishedAt = Date.now();
  saveState(true); showToast('🚀 ทำเครื่องหมายเผยแพร่แล้ว', 'success');
  openModal(itemHTML(f), 'wide');
}
function refreshIfBoard() { if (_view === 'board' || _view === 'score' || _view === 'schedule') render(); }

// ─── Per-item AI steps ───
async function genScript(id) {
  const f = getFact(id); if (!f) return;
  showToast('✍️ กำลังเขียนสคริปต์...', '');
  try {
    f.script = await kfWriteScript(f);
    bumpStage(f, 'scripts'); saveState(true);
    openModal(itemHTML(f), 'wide'); showToast('สคริปต์เสร็จ ✓', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}
async function genScenes(id) {
  const f = getFact(id); if (!f || !f.script) return;
  showToast('🎬 กำลังแตกฉาก...', '');
  try {
    f.scenes = await kfMakeScenes(f);
    bumpStage(f, 'images'); saveState(true);
    openModal(itemHTML(f), 'wide'); showToast('แตกฉากเสร็จ ✓', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════
// ─── BATCH pipeline (รวดเดียวตามตารางสัปดาห์) ───
// ═══════════════════════════════════════════════
async function batchRun(kind) {
  // kind: 'scripts' | 'scenes'
  let todo;
  if (kind === 'scripts') todo = KF.facts.filter(f => !f.script && (!f.scores || f.scores.total >= KF.settings.minTotalScore));
  else todo = KF.facts.filter(f => f.script && (!f.scenes || !f.scenes.length));
  if (!todo.length) return showToast('ไม่มีงานค้างสำหรับขั้นตอนนี้', '');
  if (!confirm(`รัน ${kind === 'scripts' ? 'สร้าง Script' : 'แตกฉาก'} ${todo.length} คลิป?`)) return;
  KF._abort = new AbortController();
  let done = 0, fail = 0;
  showToast(`เริ่มประมวลผล ${todo.length} คลิป...`, '');
  for (const f of todo) {
    if (KF._abort.signal.aborted) break;
    try {
      if (kind === 'scripts') { f.script = await kfWriteScript(f, KF._abort.signal); bumpStage(f, 'scripts'); }
      else { f.scenes = await kfMakeScenes(f, KF._abort.signal); bumpStage(f, 'images'); }
      done++;
    } catch (e) { if (e.name === 'AbortError') break; fail++; }
    saveState();
    showToast(`${kind==='scripts'?'📝':'🖼️'} ${done}/${todo.length}${fail?` (พลาด ${fail})`:''}`, '');
  }
  saveState(true); KF._abort = null; render();
  showToast(`✅ เสร็จ ${done} คลิป${fail?` · พลาด ${fail}`:''}`, 'success');
}

// ═══════════════════════════════════════════════
// ─── VIEW: Schedule / ตารางผลิต ───
// ═══════════════════════════════════════════════
function viewSchedule() {
  const week = WEEK_PLAN.map(d => {
    const n = KF.facts.filter(f => stageIndex(f.stage) >= stageIndex(d.stage)).length;
    return `<div class="week-day">
      <div class="wd-name">${d.emoji} ${d.day}</div>
      <div class="wd-task">${esc(d.task)}</div>
      <div class="wd-meta"><span class="chip">${d.time}</span><span class="chip">${n} คลิปผ่านขั้นนี้</span></div>
    </div>`;
  }).join('');

  const slots = POST_SLOTS.map(t => {
    const items = KF.facts.filter(f => f.publishSlot === t);
    return `<div class="slot"><div class="slot-t">🕐 ${t}</div>${items.map(f=>`<div class="slot-item" onclick="openItem('${f.id}')">${esc(f.topic)} <span class="muted">${esc(f.fact.slice(0,40))}</span></div>`).join('')||'<div class="muted">— ว่าง —</div>'}</div>`;
  }).join('');

  return `<div class="view-head"><h1>📅 ระบบผลิต 30 คลิป/สัปดาห์</h1>
      <div class="head-actions">
        <button class="btn" onclick="batchRun('scripts')">📝 Batch Script</button>
        <button class="btn" onclick="batchRun('scenes')">🖼️ Batch ฉาก/ภาพ</button>
      </div></div>
    <div class="panel"><h3>🗓️ ตารางสัปดาห์</h3><div class="week">${week}</div></div>
    <div class="panel"><h3>⏰ ตั้งเวลาโพสต์ (วันละ 3 คลิป)</h3><div class="slots">${slots}</div></div>
    <div class="panel"><h3>📈 สูตรโตเร็ว — ทำเป็นซีรีส์</h3>
      <p class="hint">อย่าทำคลิปเดี่ยวลอยๆ — แบ่งเป็นซีรีส์ EP ต่อเนื่อง คนดูจะดูต่อเป็นชุด สำคัญกว่ายอดวิวคลิปเดี่ยว</p>
      <div class="series-grid">${seriesCardsHTML()}</div>
    </div>`;
}

function seriesCardsHTML() {
  return KF.series.map(s => {
    const eps = KF.facts.filter(f => f.series === s.id).sort((a,b)=>(a.ep||0)-(b.ep||0));
    const list = eps.map(f => `<li onclick="openItem('${f.id}')">EP${f.ep||'?'} ${esc(f.topic)} ${f.stage==='published'?'🚀':''}</li>`).join('') || '<li class="muted">ยังไม่มี EP</li>';
    return `<div class="series-card"><div class="sc-head">${esc(s.emoji)} ${esc(s.name)} <button class="btn xs" onclick="delSeries('${s.id}')">🗑</button></div><ul>${list}</ul></div>`;
  }).join('') + `<div class="series-card add" onclick="addSeries()">＋ เพิ่มซีรีส์</div>`;
}

function addSeries() {
  const name = prompt('ชื่อซีรีส์ (เช่น รู้ไหม? อวกาศ):');
  if (!name) return;
  const emoji = prompt('อิโมจิ:', '✨') || '✨';
  KF.series.push({ id: genId(), name: name.trim(), emoji: emoji.trim() });
  saveState(true); render();
}
function delSeries(id) {
  if (!confirm('ลบซีรีส์นี้? (คลิปในซีรีส์ยังอยู่ แต่จะไม่มีซีรีส์)')) return;
  KF.series = KF.series.filter(s => s.id !== id);
  KF.facts.forEach(f => { if (f.series === id) { f.series = ''; f.ep = null; } });
  saveState(true); render();
}

// ═══════════════════════════════════════════════
// ─── VIEW: Settings ───
// ═══════════════════════════════════════════════
function viewSettings() {
  return `<div class="view-head"><h1>⚙ ตั้งค่า</h1></div>
    <div class="panel">
      <h3>🤖 AI Provider</h3>
      <p class="hint">ใช้ API Key ร่วมกับ NovelTrans (เก็บใน browser นี้) — ไม่ต้องตั้งใหม่ถ้าเคยตั้งแล้ว</p>
      <div class="form-row">
        <label>Provider <select class="inp" id="setProvider" onchange="onProviderChange(this.value)"></select></label>
        <label>Model <select class="inp" id="setModel" onchange="KF.settings.model=this.value;saveState()"></select></label>
      </div>
      <div class="form-row">
        <label style="flex:1">API Key <input class="inp" id="setKey" type="password" placeholder="วาง key ที่นี่"/></label>
        <button class="btn" onclick="saveKey()">💾 บันทึก Key</button>
        <button class="btn" onclick="testKey()">🩺 ทดสอบ</button>
      </div>
      <p class="hint" id="keyHint"></p>
    </div>
    <div class="panel">
      <h3>🎬 ช่อง</h3>
      <div class="form-row">
        <label style="flex:1">ชื่อช่อง / Hook word <input class="inp" id="setChannel" value="${esc(KF.settings.channelName)}" onchange="KF.settings.channelName=this.value;saveState()"/></label>
        <label>เสียง TTS <input class="inp" id="setVoice" value="${esc(KF.settings.ttsVoice)}" onchange="KF.settings.ttsVoice=this.value;saveState()"/></label>
      </div>
      <div class="form-row">
        <label>คะแนนรวมขั้นต่ำที่เก็บ <input class="inp sm" id="setMin" type="number" min="0" max="30" value="${KF.settings.minTotalScore}" onchange="KF.settings.minTotalScore=parseInt(this.value)||24;saveState()"/></label>
        <label>Temperature <input class="inp sm" id="setTemp" type="number" min="0" max="1.5" step="0.1" value="${KF.settings.temperature}" onchange="KF.settings.temperature=parseFloat(this.value);saveState()"/></label>
      </div>
    </div>
    <div class="panel">
      <h3>💾 ข้อมูล</h3>
      <div class="form-row">
        <button class="btn" onclick="exportData()">📤 Export JSON</button>
        <label class="btn">📥 Import JSON<input type="file" accept=".json" style="display:none" onchange="importData(event)"/></label>
        <button class="btn danger" onclick="wipeData()">🗑 ล้างทั้งหมด</button>
      </div>
      <p class="hint">รวม ${KF.facts.length} คลิป · ${KF.series.length} ซีรีส์ · ค่าใช้จ่าย AI สะสม $${KF.costs.usd.toFixed(4)}</p>
    </div>`;
}

function syncSettingsUI() {
  renderProviderSelect($('setProvider'), getProvider());
  renderModelSelect($('setModel'), getProvider(), KF.settings.model);
  const prov = PROVIDERS[getProvider()];
  $('setKey').placeholder = prov.keyPlaceholder;
  $('setKey').value = getApiKey() ? '••••••••' : '';
  $('keyHint').textContent = prov.keyHint;
}
function onProviderChange(p) {
  KF.settings.provider = p;
  KF.settings.model = p === 'openrouter' ? 'google/gemini-2.5-flash' : PROVIDERS[p].models[0][1][0][0];
  saveState(); syncSettingsUI(); updateCostUI();
}
function saveKey() {
  const v = $('setKey').value.trim();
  if (!v || v.startsWith('•')) return showToast('วาง key ก่อน', '');
  localStorage.setItem(PROVIDERS[getProvider()].lsKey, v);
  showToast('บันทึก API Key แล้ว ✓', 'success'); syncSettingsUI();
}
async function testKey() {
  const prov = PROVIDERS[getProvider()];
  const key = getApiKey();
  if (!key) return showToast('ยังไม่มี key', 'error');
  showToast('🩺 กำลังทดสอบ...', '');
  try {
    const { url, headers } = prov.testEndpoint(key);
    const res = await fetch(url, { headers });
    showToast(res.ok ? `✅ เชื่อมต่อ ${prov.label} สำเร็จ` : `❌ ${prov.label}: HTTP ${res.status}`, res.ok ? 'success' : 'error');
  } catch { showToast('❌ เชื่อมต่อไม่ได้ (อาจติด CORS)', 'error'); }
}

// ─── Data export/import ───
function exportData() {
  const doc = { app: 'KnowFactsFactory', version: 1, exportedAt: new Date().toISOString(), facts: KF.facts, series: KF.series, settings: KF.settings };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `knowfacts-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Export แล้ว ✓', 'success');
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const doc = JSON.parse(r.result);
      if (!Array.isArray(doc.facts)) throw new Error('ไฟล์ไม่ถูกต้อง');
      if (!confirm(`นำเข้า ${doc.facts.length} คลิป? (รวมกับข้อมูลเดิม)`)) return;
      const existing = new Set(KF.facts.map(f => f.id));
      doc.facts.forEach(f => { if (!existing.has(f.id)) KF.facts.push(f); });
      (doc.series || []).forEach(s => { if (!KF.series.some(x => x.id === s.id)) KF.series.push(s); });
      saveState(true); render(); showToast('นำเข้าสำเร็จ ✓', 'success');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
  };
  r.readAsText(file);
  e.target.value = '';
}
function wipeData() {
  if (!confirm('ล้างข้อมูลทั้งหมด? (Export ก่อนแนะนำ)')) return;
  if (!confirm('แน่ใจนะ? ลบทุกคลิปและซีรีส์')) return;
  KF.facts = []; KF.series = SEED_SERIES.map(s => ({ ...s }));
  saveState(true); render(); showToast('ล้างข้อมูลแล้ว', 'success');
}

// ─── Stop button ───
function stopAll() {
  if (KF._abort) { KF._abort.abort(); showToast('⏹ กำลังหยุด...', ''); }
}

window.addEventListener('DOMContentLoaded', init);
