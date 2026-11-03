// เลือกโมเดลช่วยของแผนที่ผู้พูด: วัดความแม่น + ราคา + เวลา ของหลายโมเดล
// ใช้: node tests/gender/run-speakermap-models.js <โมเดล1,โมเดล2,...>   · ต้องเปิด http.server 8099 ก่อน
//   โมเดลแรก = ตัวอ้างอิง · เคสเล็กใน archaic-cases.json เทียบกับเฉลยเพศต่อบรรทัด
//   WS_FILE=<ไฟล์ workspace ที่ export> CHAPTERS=2,7 → วัดกับตอนจริงด้วย (เทียบกับโมเดลแรก: ตรงกันกี่บรรทัด · เพศสลับกี่บรรทัด)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('child_process'); const fs = require('fs');
const MODELS = (process.argv[2] || 'google/gemini-3-flash-preview,google/gemma-4-26b-a4b-it,google/gemini-2.5-flash-lite').split(',');
const C = JSON.parse(fs.readFileSync(__dirname + '/archaic-cases.json', 'utf8'));
const TRUTH = { ko: 'mmmmfmffm', zh: 'mmmmfmffm', kom: 'mumfmf' };   // kom บรรทัด 2 = 부장 (ต้นฉบับไม่บอกเพศ)
const WS = process.env.WS_FILE ? JSON.parse(fs.readFileSync(process.env.WS_FILE, 'utf8')) : null;
const CHAPTERS = WS ? (process.env.CHAPTERS || '1').split(',').map(Number) : [];
const cost = {}, time = {};
function llm(b) {
  const t0 = Date.now();
  const args = ['-sS', '--max-time', '300', 'https://openrouter.ai/api/v1/chat/completions', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ model: b.model, messages: b.messages, temperature: 0, max_tokens: b.max_tokens, usage: { include: true } })];
  if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
  let out = ''; try { out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch {}
  let j = {}; try { j = JSON.parse(out); } catch {}
  cost[b.model] = (cost[b.model] || 0) + (j.usage?.cost || 0); time[b.model] = (time[b.model] || 0) + (Date.now() - t0);
  return j.choices?.[0]?.message?.content || '';
}
(async () => {
  const br = await chromium.launch(); const p = await (await br.newContext({ serviceWorkers: 'block' })).newPage();
  await p.exposeFunction('__llm', b => llm(b));
  await p.addInitScript(() => { localStorage.setItem('nt8_apikey', 'proxy'); const rf = window.fetch; window.fetch = async (u, o = {}) => { if (!String(u).includes('openrouter.ai')) return rf(u, o); const b = JSON.parse(o.body || '{}'); const text = await window.__llm(b); return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }), { status: 200 }); }; });
  await p.goto(`http://localhost:${process.env.PORT || 8099}/index.html`); await p.waitForTimeout(800);
  const maps = {};
  for (const model of MODELS) {
    maps[model] = await p.evaluate(async ([C, WS, CHAPTERS, model]) => {
      const out = {};
      for (const [k, c] of Object.entries(C)) {
        const w = { id: 'm' + Math.random(), name: 't', glossary: c.glossary, customStyles: [], chapters: [], settings: { sourceLang: c.lang, speakerMap: true, proofreadModel: model }, createdAt: Date.now() };
        await lsSaveWorkspace(w); await selectWorkspace(w.id);
        const m = await buildSpeakerMap(c.text, model, S.currentWs); out[k] = m ? m.map(x => x.gender[0]).join('') : null;
      }
      for (const n of CHAPTERS) {
        const ws = JSON.parse(JSON.stringify(WS)); ws.id = 'u' + Math.random(); ws.settings.proofreadModel = model; ws.chapters = ws.chapters.filter(c => c.chapterNum === n);
        if (!ws.chapters.length) continue;
        await lsSaveWorkspace(ws); await selectWorkspace(ws.id);
        const m = await buildSpeakerMap(S.currentWs.chapters[0].sourceText, model, S.currentWs);
        out['ch' + n] = m ? m.map(x => x.gender[0]).join('') : null;
      }
      return out;
    }, [C, WS, CHAPTERS, model]);
  }
  await br.close();
  const ref = maps[MODELS[0]];
  for (const model of MODELS) {
    const m = maps[model];
    const small = Object.entries(TRUTH).map(([k, t]) => { const g = m[k]; if (!g) return `${k}:FAIL`; let ok = 0; for (let i = 0; i < t.length; i++) if (g[i] === t[i]) ok++; return `${k}:${ok}/${t.length}`; }).join(' ');
    const chs = CHAPTERS.map(n => { const g = m['ch' + n], r = ref['ch' + n]; if (!g) return `ch${n}:FAIL`; if (!r) return `ch${n}:?`;
      let agree = 0, opp = 0; for (let i = 0; i < r.length; i++) { if (g[i] === r[i]) agree++; else if ((g[i] + r[i]).match(/^(mf|fm)$/)) opp++; } return `ch${n}: ตรง ${agree}/${r.length} เพศสลับ ${opp}`; }).join(' ');
    console.log(`${model.padEnd(34)} ${small}${chs ? ' | ' + chs : ''} | $${(cost[model] || 0).toFixed(5)} | ${((time[model] || 0) / 1000).toFixed(0)}s`);
  }
})();
