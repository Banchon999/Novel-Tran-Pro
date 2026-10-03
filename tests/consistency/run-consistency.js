// วัดความต่อเนื่องของคำแปลข้ามตอน/ข้ามรอบ (scenarios.json) ผ่านแอปจริงใน Chromium
//   node tests/consistency/run-consistency.js <model> <tag> [runs=2]
//   env: BASE=http://localhost:8097 (URL ของแอปที่จะทดสอบ — ไม่ใส่ = เปิด server จาก repo นี้เอง)
//        STYLE=1   ใส่คู่มือการแปล (styleSheet ใน scenarios.json)
//        STABLE=0  ปิดแปลแบบคงที่ (stableTemp=false)
// preset ทดสอบ: ไม่มี {context} + temperature 1 (แบบ preset ที่ผู้ใช้สร้างเองหลายตัว)
// ผล: tests/consistency/out/<tag>.json + สรุปบนจอ
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execFile, spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const DIR = __dirname, ROOT = path.resolve(DIR, '../..'), OUT = DIR + '/out';
const SC = JSON.parse(fs.readFileSync(DIR + '/scenarios.json', 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const PRESET = {
  id: 'test-noctx', name: 'Test (no {context})', emoji: '🧪', temperature: 1, polish: false,
  systemPrompt: 'You are a professional Korean→Thai web-novel translator. Translate faithfully and naturally into Thai.\n\nGLOSSARY:\n{glossary}\n\nKOREAN SOURCE:\n{text}\n\nOutput only the Thai translation.',
};

function curlPost(url, body) {
  return new Promise(res => {
    const f = `${OUT}/req-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
    fs.writeFileSync(f, body);
    const args = ['-sS', '--max-time', '300', '-X', 'POST', url, '-H', 'Content-Type: application/json', '--data-binary', '@' + f];
    if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
    execFile('curl', args, { maxBuffer: 80e6 }, (e, out) => { fs.unlinkSync(f); res(out || ''); });
  });
}

// นับรูปแบบคำแปลที่ใช้ (ยาวสุดก่อน — คำย่อยในคำยาวไม่นับซ้ำ)
function variantsUsed(text) {
  const used = {};
  for (const [ko, groups] of Object.entries(SC.terms)) {
    let t = String(text || '');
    const all = Object.entries(groups).flatMap(([g, vs]) => vs.map(v => [g, v])).sort((a, b) => b[1].length - a[1].length);
    const seen = new Set();
    for (const [g, v] of all) if (t.includes(v)) { seen.add(g); t = t.split(v).join('■'); }
    used[ko] = [...seen];
  }
  return used;
}

async function oneRun(base, model, runNo) {
  const now = Date.now();
  const ws = {
    id: `cons-${now}-${runNo}`, name: 'Consistency test', emoji: '🧪', glossary: [], customStyles: [],
    presets: [PRESET], presetId: PRESET.id,
    chapters: SC.chapters.map((c, i) => ({ id: 'c' + i, title: c.title, chapterNum: i + 1, sourceText: c.text, translation: '', status: 'pending', createdAt: now, updatedAt: now })),
    settings: { aiProvider: 'openrouter', translateModel: model, temperature: 1, autoGlossary: true, stableTemp: process.env.STABLE !== '0' },
    translationContext: { enabled: false, maxTokens: 1500, summaries: [] }, createdAt: now,
  };
  if (process.env.STYLE === '1') ws.styleSheet = SC.styleSheet;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const prompts = [];
  await page.route('https://openrouter.ai/**', async route => {
    const body = route.request().postData() || '{}';
    const j = JSON.parse(body);
    if (j.stream) prompts.push({ temperature: j.temperature, hasCtx: /CONTEXT FROM EARLIER|ท้ายคำแปลตอนก่อน/.test(j.messages?.[0]?.content || ''), hasStyle: /TRANSLATION STYLE SHEET/.test(j.messages?.[0]?.content || '') });
    const out = await curlPost(route.request().url(), body);
    await route.fulfill({ status: 200, headers: { 'content-type': j.stream ? 'text/event-stream' : 'application/json' }, body: out });
  });
  await page.route(base + '/**', r => r.continue());   // ปิด HTTP cache
  await page.addInitScript(() => localStorage.setItem('nt8_apikey', 'via-proxy'));
  await page.goto(`${base}/index.html`); await page.waitForTimeout(800);
  await page.evaluate(async w => { await lsSaveWorkspace(w); await selectWorkspace(w.id); }, ws);
  const chapters = [];
  for (let i = 0; i < SC.chapters.length; i++) {
    const r = await page.evaluate(async idx => {
      const ch = _getSortedChapters()[idx];
      try { await translateChapterCore(ch, { model: S.currentWs.settings.translateModel, awaitGlossary: true }); return { ok: true, t: ch.translation }; }
      catch (e) { return { ok: false, err: e.message }; }
    }, i);
    chapters.push({ num: i + 1, ...r, used: variantsUsed(r.t) });
  }
  const glossary = await page.evaluate(() => S.currentWs.glossary.map(g => `${g.korean}=${g.thai}`));
  await browser.close();
  return { run: runNo, chapters, glossary, prompts };
}

function summarize(runs) {
  const rows = [];
  let consistentWithin = 0, consistentAll = 0, n = 0, totalVariants = 0;
  for (const ko of Object.keys(SC.terms)) {
    const perRun = runs.map(r => new Set(r.chapters.flatMap(c => c.used[ko] || [])));
    const all = new Set(perRun.flatMap(s => [...s]));
    if (!all.size) continue;
    n++; totalVariants += all.size;
    const within = perRun.every(s => s.size <= 1);
    if (within) consistentWithin++;
    if (all.size === 1) consistentAll++;
    rows.push(`  ${ko}: ${[...all].join(' | ')}${all.size > 1 ? '  ← ' + all.size + ' แบบ' : ''}  (ต่อรอบ: ${perRun.map(s => [...s].join('/') || '-').join(' ; ')})`);
  }
  return { rows, n, consistentWithin, consistentAll, avgVariants: n ? totalVariants / n : 0 };
}

(async () => {
  const [model, tag, runsArg] = process.argv.slice(2);
  if (!model || !tag) { console.log('usage: node run-consistency.js <model> <tag> [runs=2]'); process.exit(1); }
  let base = process.env.BASE, server = null;
  if (!base) { base = 'http://localhost:8097'; server = spawn('python3', ['-m', 'http.server', '8097'], { cwd: ROOT, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1200)); }
  try {
    const runs = [];
    for (let i = 1; i <= (+runsArg || 2); i++) runs.push(await oneRun(base, model, i));
    const s = summarize(runs);
    const p = runs.flatMap(r => r.prompts);
    console.log(`\n=== ${tag} · ${model} · ${runs.length} รอบ × ${SC.chapters.length} ตอน ===`);
    console.log(`prompt: temperature=${[...new Set(p.map(x => x.temperature))].join(',')} · มีบริบทตอนก่อน ${p.filter(x => x.hasCtx).length}/${p.length} · มีคู่มือ ${p.filter(x => x.hasStyle).length}/${p.length}`);
    console.log(`ล้มเหลว: ${runs.flatMap(r => r.chapters).filter(c => !c.ok).length}`);
    console.log(s.rows.join('\n'));
    console.log(`สรุป: ใช้คำเดียวตลอดทุกตอนทุกรอบ ${s.consistentAll}/${s.n} คำ · คงที่ภายในรอบ ${s.consistentWithin}/${s.n} · เฉลี่ย ${s.avgVariants.toFixed(2)} แบบ/คำ`);
    fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({ model, tag, runs, summary: s }, null, 1));
  } finally { if (server) server.kill(); }
})();
