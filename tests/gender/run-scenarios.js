// ทดสอบระบบเพศ/สรรพนาม/ครับ-ค่ะ ด้วยบทจำลอง (scenarios.json) ผ่านแอปจริงใน Chromium
//   node tests/gender/run-scenarios.js <model[,model...]> [tag]
// - เรียก OpenRouter ผ่าน curl (key มาจาก proxy/ตัวแปร OPENROUTER_API_KEY ถ้ามี)
// - คลังศัพท์เริ่มว่าง + Auto Glossary เปิด → ทดสอบการสกัดเพศไปด้วย
// - WS_TEMPLATE=<ไฟล์ workspace .json> → ใช้ presets/presetId ของ workspace นั้น (เช่นพรีเซ็ตที่ใช้จริง)
// ผล: tests/gender/out/<tag>-<model>.json + สรุปบนจอ
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execFile, spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const DIR = __dirname, ROOT = path.resolve(DIR, '../..'), OUT = DIR + '/out';
const PORT = +(process.env.PORT || 8097);
const SC = JSON.parse(fs.readFileSync(DIR + '/scenarios.json', 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

function curlPost(url, body) {
  return new Promise(res => {
    const f = `${OUT}/req-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
    fs.writeFileSync(f, body);
    const args = ['-sS', '--max-time', '300', '-X', 'POST', url, '-H', 'Content-Type: application/json', '--data-binary', '@' + f];
    if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
    execFile('curl', args, { maxBuffer: 80e6 }, (e, out) => { fs.unlinkSync(f); res(out || ''); });
  });
}

// ── ตัวตรวจ ──
const QUOTE_START = /^[“"‘'「『]/;
const mask = t => t.replace(/ภูเขา|หุบเขา|เขาวงกต|ยอดเขา|เทือกเขา|เชิงเขา|นางฟ้า|นางสาว|นางกำนัล|นางเอก|นางร้าย|นางพญา|นางสนม|นางใน|คะแนน/g, '#');
const BAD = {
  femaleSpeech: /ครับ|ขอรับ|กระผม|ผม/,   // ผู้หญิงพูด/คิด
  maleSpeech: /ค่ะ|คะ|ดิฉัน|เจ้าค่ะ|เพคะ/, // ผู้ชายพูด/คิด
  femaleNarr: /เขา/,                     // บรรยายผู้หญิง
  maleNarr: /เธอ|หล่อน|นาง/,             // บรรยายผู้ชาย
};
const PARTICLE = /ครับ|ค่ะ|คะ|ขอรับ|เจ้าค่ะ/;

function checkChapter(ch, thai) {
  const src = ch.paras;
  const th = String(thai || '').split('\n').map(s => s.trim()).filter(Boolean);
  const res = { aligned: th.length === src.length, errors: [], suspects: [], missingParticle: [], extraParticle: [] };
  // จับคู่: นับย่อหน้าตรงกัน → ตามลำดับ · ไม่ตรง → จับเฉพาะบทพูด/ความคิดตามลำดับเครื่องหมายคำพูด
  let pairs;
  if (res.aligned) pairs = src.map((p, i) => [p, th[i]]);
  else {
    const sq = src.filter(p => p.t !== 'n'), tq = th.filter(l => QUOTE_START.test(l));
    pairs = sq.length === tq.length ? sq.map((p, i) => [p, tq[i]]) : [];
    res.note = `ย่อหน้าไม่ตรง (ต้นฉบับ ${src.length} / ไทย ${th.length}) · บทพูด ${sq.length}/${tq.length}` + (pairs.length ? '' : ' → ข้ามการตรวจ');
  }
  for (const [p, line] of pairs) {
    const t = mask(line);
    if (p.t === 'q' || p.t === 'th') {
      const g = SC.characters[p.who];
      const bad = g === 'female' ? BAD.femaleSpeech : BAD.maleSpeech;
      if (bad.test(t)) res.errors.push({ kind: 'speech', who: p.who, ko: p.k, th: line });
      else if (p.polite && !PARTICLE.test(t)) res.missingParticle.push({ who: p.who, ko: p.k, th: line });
      else if (p.t === 'q' && p.polite === false && PARTICLE.test(t)) res.extraParticle.push({ who: p.who, ko: p.k, th: line });
    } else if (p.t === 'n' && p.g && res.aligned) {
      const bad = p.g === 'f' ? BAD.femaleNarr : BAD.maleNarr;
      if (bad.test(t)) res.suspects.push({ kind: 'narration', expect: p.g, ko: p.k, th: line, note: p.note || '' });
    }
  }
  return res;
}

async function runModel(model, tag) {
  const tpl = process.env.WS_TEMPLATE ? JSON.parse(fs.readFileSync(process.env.WS_TEMPLATE, 'utf8')) : null;
  const now = Date.now();
  const ws = {
    id: 'gender-test-' + now, name: 'Gender test ' + model, emoji: '🧪', description: '', glossary: [], customStyles: [], presets: [],
    chapters: SC.chapters.map((c, i) => ({ id: 'gt' + i, title: c.title, chapterNum: i + 1, sourceText: c.paras.map(p => p.k).join('\n\n'),
      translation: '', status: 'pending', notes: '', createdAt: now, updatedAt: now })),
    settings: { aiProvider: 'openrouter', translateModel: model, temperature: 0.7, autoGlossary: true },
    translationContext: { enabled: false, maxTokens: 1500, summaries: [] }, createdAt: now,
  };
  if (tpl) { ws.presets = tpl.presets || []; ws.presetId = tpl.presetId; ws.customStyles = tpl.customStyles || []; }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const log = [];
  page.on('pageerror', e => log.push('PAGEERROR ' + e.message));
  await page.route('https://openrouter.ai/**', async route => {
    const body = route.request().postData() || '{}';
    const out = await curlPost(route.request().url(), body);
    const j = JSON.parse(body);
    if (process.env.DEBUG) log.push({ req: j.messages?.map(m => m.content).join('\n---\n').slice(0, 20000), res: out.slice(0, 20000) });
    await route.fulfill({ status: 200, headers: { 'content-type': j.stream ? 'text/event-stream' : 'application/json' }, body: out });
  });
  await page.addInitScript(() => localStorage.setItem('nt8_apikey', 'via-proxy'));
  await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForTimeout(800);
  await page.evaluate(async w => {
    ensureWsStylesPresets(w);
    await lsSaveWorkspace(w);
    const list = await lsGetWorkspaceList(); list.push({ id: w.id, name: w.name, emoji: w.emoji }); await lsSaveWorkspaceList(list);
    await selectWorkspace(w.id);
  }, ws);

  const result = { model, tag, chapters: [], glossary: [], log };
  for (let i = 0; i < SC.chapters.length; i++) {
    const t0 = Date.now();
    const r = await page.evaluate(async idx => {
      const ch = _getSortedChapters()[idx];
      try { await translateChapterCore(ch, { model: S.currentWs.settings.translateModel, awaitGlossary: true }); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    }, i);
    const translation = await page.evaluate(idx => _getSortedChapters()[idx].translation, i);
    const check = checkChapter(SC.chapters[i], translation);
    result.chapters.push({ num: i + 1, ...r, sec: Math.round((Date.now() - t0) / 1000), translation, check });
  }
  result.glossary = await page.evaluate(() => S.currentWs.glossary.map(g => ({ korean: g.korean, thai: g.thai, type: g.type, gender: g.gender })));
  await browser.close();

  // เพศในคลังศัพท์ที่สกัดได้
  result.glossaryCheck = Object.entries(SC.characters).map(([ko, g]) => {
    const e = result.glossary.find(x => x.type === 'character' && (x.korean === ko || x.korean.includes(ko)));
    return { ko, expect: g, got: e ? (e.gender || 'none') : 'missing', thai: e?.thai || '', ok: !!e && e.gender === g };
  });
  fs.writeFileSync(`${OUT}/${tag}-${model.split('/').pop()}.json`, JSON.stringify(result, null, 1));
  return result;
}

function report(r) {
  const L = [`\n=== ${r.model} ===`];
  let err = 0, sus = 0, miss = 0, extra = 0;
  for (const c of r.chapters) {
    const k = c.check; err += k.errors.length; sus += k.suspects.length; miss += k.missingParticle.length; extra += k.extraParticle.length;
    L.push(`ch${c.num} ${c.ok ? 'ok' : 'FAIL ' + c.err} ${c.sec}s · พูดผิดเพศ ${k.errors.length} · บรรยายน่าสงสัย ${k.suspects.length} · ขาดหางเสียง ${k.missingParticle.length} · หางเสียงเกิน ${k.extraParticle.length}${k.note ? ' · ' + k.note : ''}`);
    for (const e of k.errors) L.push(`   ✗ [${e.who}] ${e.th}`);
    for (const s of k.suspects) L.push(`   ? [ควร ${s.expect === 'f' ? 'หญิง' : 'ชาย'}] ${s.th}${s.note ? '  (' + s.note + ')' : ''}`);
    for (const m of k.missingParticle) L.push(`   · ขาดหางเสียง [${m.who}] ${m.th}`);
    for (const m of k.extraParticle) L.push(`   · หางเสียงเกิน (พูดภาษาปกติ) [${m.who}] ${m.th}`);
  }
  L.push('glossary: ' + r.glossaryCheck.map(g => `${g.ko}=${g.thai || '-'}(${g.got})${g.ok ? '✅' : '❌'}`).join(' '));
  L.push(`รวม: พูดผิดเพศ ${err} · บรรยายน่าสงสัย ${sus} · ขาดหางเสียง ${miss} · หางเสียงเกิน ${extra} · เพศในคลัง ${r.glossaryCheck.filter(g => g.ok).length}/${r.glossaryCheck.length}`);
  return L.join('\n');
}

(async () => {
  if (!process.argv[2]) { console.log('usage: node run-scenarios.js <model[,model]> [tag]'); process.exit(1); }
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  try {
    const tag = process.argv[3] || 'run';
    const results = await Promise.all(process.argv[2].split(',').map(m => runModel(m, tag)));
    for (const r of results) console.log(report(r));
  } finally { server.kill(); }
})();

