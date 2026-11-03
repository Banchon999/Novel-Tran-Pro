// คนที่ไม่รู้เพศ: แปลแล้วต้องไม่เดาเพศ (เขา/เธอ/นาง · ครับ/ค่ะ · ผม/ดิฉัน) และยังอ่านลื่น ไม่บิดบท
// ใช้: node tests/gender/run-neutral.js <โมเดลแปล1,โมเดล2> [รอบ]   · ต้องเปิด http.server 8099 ก่อน (PORT= เปลี่ยนได้)
// ขั้นตอนเหมือนแอปจริง: แผนที่ผู้พูด (โมเดลเดียวกับที่แปล) → prompt แปล → แปล → ตัวแก้บทพูด → ตรวจเพศคำบรรยาย
// วัด 2 ทาง: (1) นับคำบอกเพศในบรรทัดของคนที่ไม่รู้เพศ/คำบรรยาย ตามเฉลยใน neutral-cases.json
//            (2) ให้ JUDGE (ค่าเริ่มต้น Gemini 3 Flash Preview) ชี้จุดที่เดาเพศ · เรียกซ้ำจนแข็ง · บิดบท + คะแนนความลื่น 1–5
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('child_process'); const fs = require('fs');
const MODELS = (process.argv[2] || 'google/gemma-4-26b-a4b-it,google/gemini-3.1-flash-lite').split(',');
const RUNS = +(process.argv[3] || 2), ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const JUDGE = process.env.JUDGE || 'google/gemini-3-flash-preview', TAG = process.env.TAG || 'run';
const C = JSON.parse(fs.readFileSync(__dirname + '/neutral-cases.json', 'utf8')).cases;
const OUT = __dirname + '/out'; fs.mkdirSync(OUT, { recursive: true });
let cost = 0;
function llm(b) {
  const args = ['-sS', '--max-time', '300', 'https://openrouter.ai/api/v1/chat/completions', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ model: b.model, messages: b.messages, temperature: b.temperature ?? 0.3, max_tokens: b.max_tokens || 8000, usage: { include: true } })];
  if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
  let out = ''; try { out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch {}
  let j = {}; try { j = JSON.parse(out); } catch {}
  cost += j.usage?.cost || 0;
  return j.choices?.[0]?.message?.content || '';
}
const GENDER_IN_QUOTE = /ครับ|(?<!เจ้า)ค่ะ|คะ(?!แนน|เน)|ขอรับ|เจ้าค่ะ|เจ้าคะ|กระผม|ดิฉัน|อิฉัน|หม่อมฉัน|(?<!เส้น|ทรง)ผม(?!ยาว|สั้น|ขาว|ดำ|สี|เผ้า)/g;
const FEMALE_MARK = /(?<!เจ้า)ค่ะ|คะ(?!แนน|เน)|เจ้าค่ะ|เจ้าคะ|ดิฉัน|อิฉัน/g, MALE_MARK = /ครับ|ขอรับ|กระผม|(?<!เส้น|ทรง)ผม(?!ยาว|สั้น|ขาว|ดำ|สี|เผ้า)/g;
const THIRD = s => s.replace(/ภูเขา|หุบเขา|ยอดเขา|เขาวงกต|เทือกเขา|นางฟ้า|นางสาว|นางแบบ/g, '');
const n = (s, re) => (String(s).match(re) || []).length;
function judgePrompt(c, th) {
  return `You are a senior Korean→Thai literary translation editor. Check this Thai translation.

PEOPLE WHOSE GENDER THE SOURCE DOES NOT REVEAL: ${c.unknownPeople.join(' · ')}
For THESE people only, the translator must NOT guess a gender — no เขา/เธอ/นาง for them in narration, and no gendered particle or pronoun (ครับ/ค่ะ/คะ/ขอรับ/เจ้าค่ะ/ผม/ดิฉัน) in their own speech. Dropping the subject, a neutral word (ท่าน, อีกฝ่าย, คนผู้นั้น, the role word) or a neutral sentence ending is correct. ฉัน and ข้า are gender-neutral.
KNOWN GENDERS (gendered words for these are CORRECT, never report them under "guessed"): ${c.glossary.map(g => `${g.korean} = ${g.thai} (${g.gender})`).join(', ') || 'none'}${c.revealNote ? `\n${c.revealNote}` : ''}
Case notes: ${c.note}

SOURCE:
${c.text}

THAI:
${th}

Report (Thai excerpts copied exactly, short):
- "guessed": every place the Thai gives a gender the source does not give (a เขา/เธอ/นาง for an unknown person, a gendered particle/pronoun in an unknown person's line).
- "wrongKnown": a known character given the wrong gender.
- "awkward": places where the effort to stay neutral reads stiff — the same name/role word repeated so often it jars, or an odd neutral word.
- "distorted": meaning added, dropped or restructured beyond normal translation.
- "flow": 1–5, how smoothly it reads as a published Thai web novel (5 = natural).
Return ONLY JSON: {"guessed":[{"who":"","excerpt":""}],"wrongKnown":[{"who":"","excerpt":""}],"awkward":[{"excerpt":"","why":""}],"distorted":[{"excerpt":"","why":""}],"flow":0}`;
}
(async () => {
  const br = await chromium.launch(); const p = await (await br.newContext({ serviceWorkers: 'block' })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.exposeFunction('__llm', b => llm(b));
  await p.addInitScript(() => {
    localStorage.setItem('nt8_apikey', 'proxy');
    const rf = window.fetch;
    window.fetch = async (u, o = {}) => {
      if (!String(u).includes('openrouter.ai')) return rf(u, o);
      const b = JSON.parse(o.body || '{}'); const text = await window.__llm(b);
      if (!b.stream) return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }), { status: 200 });
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    };
  });
  await p.goto(`http://localhost:${process.env.PORT || 8099}/index.html`); await p.waitForTimeout(800);
  const rows = [];
  for (const model of MODELS) for (const [key, c] of Object.entries(C)) {
    if (ONLY && !ONLY.includes(key)) continue;
    for (let r = 0; r < RUNS; r++) {
      const th = await p.evaluate(async ([c, model]) => {
        const w = { id: 'n' + Math.random(), name: 'neutral', glossary: c.glossary, customStyles: [], chapters: [], settings: { sourceLang: c.lang, speakerMap: true, proofreadModel: 'same', translateModel: model }, createdAt: Date.now() };
        await lsSaveWorkspace(w); await selectWorkspace(w.id);
        const ws = S.currentWs, g = {}; for (const e of ws.glossary) g[e.korean] = e;
        const map = await buildSpeakerMap(c.text, model, ws);
        const prompt = buildTranslatePrompt({ sourceText: c.text, glossaryStr: buildGlossaryStr(g), ws, speakerMap: map });
        let t = await window.__llm({ model, messages: [{ role: 'user', content: prompt }], temperature: translateTemp(getActivePreset(ws).temperature, ws), max_tokens: 8000 });
        t = applySpeakerFixes(t, map, ws).text || t;
        if (map) t = (await genderProofread(c.text, t, model, ws)).text || t;
        return t;
      }, [c, model]);
      const quotes = th.match(/[“"][^”"]*[”"]/g) || [], srcQ = c.text.match(/“[^”]*”/g) || [];
      const nar = THIRD(th.replace(/[“"][^”"]*[”"]/g, ' '));
      const m = { model, key, r };
      if (quotes.length === srcQ.length) {
        m.unkMarks = c.unknownQuotes.reduce((a, i) => a + n(quotes[i - 1], GENDER_IN_QUOTE), 0);
        m.knownWrong = Object.entries(c.knownQuotes || {}).reduce((a, [i, gd]) => a + n(quotes[+i - 1], gd === 'male' ? FEMALE_MARK : MALE_MARK), 0);
      } else m.unkMarks = m.knownWrong = '?';
      if (c.noThirdPerson) m.narr3 = n(nar, /เขา|เธอ|นาง/g);
      if (c.noMaleThirdPerson) m.narr3 = n(nar, /เขา/g);
      if (c.expectFemaleAfterReveal) m.reveal = n(nar.slice(-Math.floor(nar.length / 3)), /เธอ|นาง/g) > 0;
      let jd = {}; const jr = llm({ model: JUDGE, temperature: 0, max_tokens: 4000, messages: [{ role: 'user', content: judgePrompt(c, th) }] });
      try { jd = JSON.parse(jr.replace(/```json|```/g, '').slice(jr.replace(/```json|```/g, '').indexOf('{'), jr.replace(/```json|```/g, '').lastIndexOf('}') + 1)); } catch {}
      Object.assign(m, { guessed: jd.guessed?.length ?? '?', wrongKnown: jd.wrongKnown?.length ?? '?', awkward: jd.awkward?.length ?? '?', distorted: jd.distorted?.length ?? '?', flow: jd.flow ?? '?' });
      rows.push(m);
      fs.appendFileSync(`${OUT}/neutral-${TAG}-${key}.txt`, `### ${model} run${r + 1}\n${th}\n\n--- judge ---\n${JSON.stringify(jd, null, 1)}\n\n`);
    }
  }
  await br.close();
  for (const m of rows) console.log(`${TAG} ${m.model.split('/')[1].padEnd(22)} ${m.key.padEnd(9)} r${m.r + 1} | ไม่รู้เพศแต่ใส่คำบอกเพศ=${m.unkMarks}${m.narr3 !== undefined ? ` บรรยายเดาเพศ=${m.narr3}` : ''}${m.reveal !== undefined ? ` หลังเฉลยใช้เธอ/นาง=${m.reveal ? 'ใช่' : 'ไม่'}` : ''} รู้เพศแต่ผิด=${m.knownWrong} | judge: เดา=${m.guessed} รู้เพศผิด=${m.wrongKnown} แข็ง=${m.awkward} บิด=${m.distorted} ลื่น=${m.flow}`);
  console.log(`${TAG} cost $${cost.toFixed(4)}`);
})();
