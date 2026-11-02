// ทดสอบกฎเพศของ "ตำแหน่ง" + ไม่รู้เพศไม่เดา + คำแทนตัวผู้เล่า ทั้ง 3 ภาษา (เกาหลี/จีน/อังกฤษ) ด้วย AI จริง (~$0.01/รอบ กับ Gemini 3.1 Flash Lite)
//   python3 -m http.server 8099 &   แล้ว   node tests/gender/run-title-3lang.js [model=google/gemini-3.1-flash-lite] [รอบ=2]
// A ต้อง: บรรยายไม่มี "เขา" กับผู้อำนวยการ · B ต้อง: บรรยายไม่มีทั้ง เขา/เธอ/นาง · ทุกเคส: บรรยาย "ฉัน" ไม่มี "ผม" · ประโยคขอบคุณของผู้เล่ามี "ครับ"
// X ต้อง: ตำแหน่งผู้อำนวยการได้ female · ตำแหน่งที่หลายคนมี (ครูฝึก) ไม่มีเพศ (ดูผลดิบ — แอปตัดเพศให้อีกชั้นด้วย dropSharedTitleGender)
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const MODEL = process.argv[2] || 'google/gemini-3.1-flash-lite', RUNS = +(process.argv[3] || 2), PORT = process.env.PORT || 8099;
const OUT = __dirname + '/out'; fs.mkdirSync(OUT, { recursive: true });
const C = JSON.parse(fs.readFileSync(__dirname + '/title-cases.json', 'utf8')).cases;
const curl = body => new Promise(r => { const f = `${OUT}/q-${process.pid}-${Math.random().toString(36).slice(2)}.json`; fs.writeFileSync(f, body);
  const args = ['-sS', '--max-time', '240', '-X', 'POST', 'https://openrouter.ai/api/v1/chat/completions', '-H', 'Content-Type: application/json', '--data-binary', '@' + f];
  if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
  execFile('curl', args, { maxBuffer: 5e7 }, (e, o) => { fs.unlinkSync(f); r(o || ''); }); });
const n = (s, re) => (s.match(re) || []).length;
(async () => {
  const br = await chromium.launch(); const p = await (await br.newContext({ serviceWorkers: 'block' })).newPage();
  await p.goto(`http://localhost:${PORT}/index.html`); await p.waitForTimeout(800);
  const prompts = {};
  for (const [lang, c] of Object.entries(C)) for (const mode of ['A', 'B', 'X'])
    prompts[`${lang}|${mode}`] = await p.evaluate(async ([lang, c, mode]) => {
      const title = { korean: c.title, thai: 'ผู้อำนวยการ', type: 'title', note: 'head of the academy', ...(mode === 'A' ? { gender: 'female' } : {}) };
      const glossary = [title, { korean: c.narr[0], thai: c.narr[1], type: 'character', gender: 'male' }, { korean: c.other[0], thai: c.other[1], type: 'character', gender: 'female' },
        mode === 'X' ? { korean: c.inst[0], thai: c.inst[1], type: 'title' } : { korean: c.place[0], thai: c.place[1], type: 'place' }];
      const w = { id: lang + mode + Date.now(), name: 'Academy', glossary, customStyles: [], presets: [], chapters: [], settings: { sourceLang: lang, speakerMap: false }, createdAt: Date.now() };
      await lsSaveWorkspace(w); await selectWorkspace(w.id);
      if (mode === 'X') return fillGlossaryPrompt(agGetPrompt(lang), { ws: S.currentWs, text: c.extractText, lang });
      const g = {}; for (const e of S.currentWs.glossary) g[e.korean] = e;
      return buildTranslatePrompt({ sourceText: c.text, glossaryStr: buildGlossaryStr(g), ws: S.currentWs });
    }, [lang, c, mode]);
  await br.close();
  let cost = 0, bad = 0;
  const jobs = [];
  for (const key of Object.keys(prompts)) for (let i = 0; i < RUNS; i++) jobs.push((async () => {
    const [lang, mode] = key.split('|'), c = C[lang];
    const out = await curl(JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompts[key] }], temperature: 0.3, max_tokens: 4000 }));
    let j; try { j = JSON.parse(out); } catch { j = {}; } cost += j.usage?.cost || 0;
    const t = j.choices?.[0]?.message?.content || '';
    fs.appendFileSync(`${OUT}/title-${lang}-${mode}.txt`, t + '\n\n=====\n');
    if (!t) { bad++; return `${key} ERR ${j.error?.message || 'empty'}`; }
    if (mode === 'X') {
      let a; try { a = JSON.parse(t.replace(/```json|```/g, '').trim()); } catch { try { a = JSON.parse(t.match(/\[[\s\S]*\]/)[0]); } catch { a = null; } }
      if (!Array.isArray(a)) { bad++; return `${key} PARSE FAIL`; }
      const f = k => a.find(x => String(x.source || x.korean || '').trim().toLowerCase() === k.toLowerCase());
      const tg = f(c.title)?.gender || '—', ig = f(c.inst[0]) ? (f(c.inst[0]).gender || 'none') : '—';
      if (tg !== 'female' || !['none', '—'].includes(ig)) bad++;
      return `${key} title=${tg} ${tg === 'female' ? '✓' : '✗'} · shared title=${ig} ${['none', '—'].includes(ig) ? '✓' : '✗ (app drops it)'}`;
    }
    const nar = t.replace(/[“"「][^”"」]*[”"」]/g, ' '), hair = s => s.replace(/เส้นผม|ทรงผม|ผมยาว|ผมสั้น/g, '');
    const thanks = (t.match(/[“"「][^”"」]*ขอบ(?:คุณ|ใจ)[^”"」]*[”"」]/) || [''])[0];
    const r = { khao: n(nar, /เขา/g), thoe: n(nar, /เธอ|นาง(?!กำนัล)/g), phom: n(hair(nar), /ผม/g), chan: n(nar, /ฉัน/g), krap: /ครับ/.test(thanks) };
    const pass = r.khao === 0 && (mode === 'A' || r.thoe === 0) && r.phom === 0 && r.chan > 0 && r.krap;
    if (!pass) bad++;
    return `${key} ${pass ? '✓' : '✗'} narration: เขา=${r.khao} เธอ/นาง=${r.thoe} ผม=${r.phom} ฉัน=${r.chan} · thank-you: ${r.krap ? 'ครับ' : '✗'}`;
  })());
  for (const line of (await Promise.all(jobs)).sort()) console.log(line);
  console.log(`${MODEL} · problems ${bad} · cost $${cost.toFixed(4)} · outputs in tests/gender/out/`);
})();
