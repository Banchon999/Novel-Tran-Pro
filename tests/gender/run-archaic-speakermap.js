// แผนที่ผู้พูด เปิด/ปิด → บทพูดเรื่องยุทธภพยังเป็น ข้า/ขอรับ/เจ้าค่ะ ไหม (เรื่องออฟฟิศ kom ต้องยังเป็น ผม/ครับ)
// ใช้: node tests/gender/run-archaic-speakermap.js <รอบ> [zh,ko,kom]  · ต้องเปิด http.server 8099 ก่อน
// GENRE='{"zh":"zh-wuxia"}' ตั้งแนว · PREV=1 ใส่ตอนก่อนที่แปลแบบโบราณไว้แล้ว · ใช้ Gemini 3.1 Flash Lite ทั้งแผนที่และการแปล
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('child_process'); const fs = require('fs');
const MODEL = 'google/gemini-3.1-flash-lite', RUNS = +(process.argv[2] || 2), ONLY = process.argv[3] || '';
const GENRE = JSON.parse(process.env.GENRE || '{}');   // {"zh":"zh-wuxia"} ตั้งแนว
fs.mkdirSync(__dirname + '/out', { recursive: true });
const C = JSON.parse(fs.readFileSync(__dirname + '/archaic-cases.json', 'utf8'));
let cost = 0;
function llm(prompt, max = 4000) {
  const args = ['-sS', '--max-time', '240', 'https://openrouter.ai/api/v1/chat/completions', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: max, usage: { include: true } })];
  if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const j = JSON.parse(out); cost += j.usage?.cost || 0; return j.choices?.[0]?.message?.content || '';
}
(async () => {
  const br = await chromium.launch(); const p = await (await br.newContext({ serviceWorkers: 'block' })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.exposeFunction('__llm', (prompt, max) => llm(prompt, max));
  await p.addInitScript(() => {
    localStorage.setItem('nt8_apikey', 'proxy');
    const rf = window.fetch;
    window.fetch = async (u, o = {}) => {
      if (!String(u).includes('openrouter.ai')) return rf(u, o);
      const b = JSON.parse(o.body || '{}');
      const text = await window.__llm(b.messages.map(m => m.content).join('\n\n'), b.max_tokens || 4000);
      if (!b.stream) return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }), { status: 200 });
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    };
  });
  if (process.env.PREV) await p.addInitScript(() => { window.__PREV = true; });
  await p.goto('http://localhost:' + (process.env.PORT || 8099) + '/index.html'); await p.waitForTimeout(800);
  const res = [];
  for (const [key, c] of Object.entries(C)) { if (ONLY && !ONLY.split(',').includes(key)) continue;
    for (const sm of [false, true]) for (let r = 0; r < RUNS; r++) {
      const o = await p.evaluate(async ([c, sm, genre, MODEL]) => {
        const w = { id: 'sm' + Math.random(), name: 'test', glossary: c.glossary, customStyles: [], chapters: [], settings: { sourceLang: c.lang, speakerMap: sm, proofreadModel: MODEL, ...(genre ? { genrePreset: genre } : {}) }, createdAt: Date.now() };
        if (window.__PREV) w.chapters = [{ id: 'p1', chapterNum: 1, title: '1', sourceText: 'x', status: 'done', translation: ('“ข้าน้อยเข้าใจแล้วขอรับ ท่านอาจารย์” เขากล่าว\n“เจ้าอย่าได้ประมาท” อาจารย์ตอบ\n“ศิษย์พี่ ข้ารอท่านอยู่เจ้าค่ะ”\n').repeat(6) }];
        await lsSaveWorkspace(w); await selectWorkspace(w.id);
        const ws = S.currentWs; const g = {}; for (const e of ws.glossary) g[e.korean] = e;
        const map = sm ? await buildSpeakerMap(c.text, MODEL, ws) : null;
        const prompt = buildTranslatePrompt({ sourceText: c.text, glossaryStr: buildGlossaryStr(g), ws, speakerMap: map });
        let t = await window.__llm(prompt, 4000);
        if (map) t = applySpeakerFixes(t, map).text ?? t;
        return { t, block: map ? speakerMapPromptBlock(map, ws) : '' };
      }, [c, sm, GENRE[key] || '', MODEL]);
      const dl = (o.t.match(/[“"「][^”"」]*[”"」]/g) || []).join(' ');
      const n = re => (dl.match(re) || []).length;
      const modern = n(/ผม(?!เผ้า|ขาว|ยาว)/g) + n(/ครับ/g) + n(/(?<!เจ้า)ค่ะ|(?<!เจ้า)คะ(?!แนน|เน)/g) + n(/(?<!ศิษย์)พี่/g), old = n(/ข้า(?![งวม])/g) + n(/ขอรับ/g) + n(/เจ้าค่ะ|เจ้าคะ/g);
      res.push(`${key} map=${sm ? 'ON ' : 'off'} modern(ผม/ครับ/ค่ะ/พี่)=${modern} old(ข้า/ขอรับ/เจ้าค่ะ)=${old}`);
      fs.appendFileSync(__dirname + `/out/archaic-${key}-${sm ? 'on' : 'off'}.txt`, o.t + '\n----BLOCK----\n' + o.block + '\n=====\n');
    }
  }
  await br.close();
  console.log(res.join('\n')); console.log('cost $' + cost.toFixed(4));
})();
