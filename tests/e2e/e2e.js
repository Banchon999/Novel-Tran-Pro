// ชุดทดสอบ e2e (ไม่เรียก AI จริง — mock OpenRouter) เปิดแอปจริงใน Chromium แล้วตรวจ prompt/การทำงาน
// ใช้: bash tests/e2e/run.sh   (เปิด http.server พอร์ต 8099 ให้เอง)
// เพิ่มเคส: ต่อท้ายก่อน "no page errors" · window.__plan = ลำดับคำตอบของ AI จำลอง ('ok:<ข้อความ>' | 'hang' | 'err')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('nt8_apikey', 'test-key');
    // mock provider: window.__plan = list of behaviours consumed per call: 'ok:<text>' | 'hang' | 'err'
    window.__plan = []; window.__calls = 0;
    const realFetch = window.fetch;
    window.fetch = async (url, opts = {}) => {
      if (!String(url).includes('openrouter.ai')) return realFetch(url, opts);
      window.__calls++;
      const step = window.__plan.length ? window.__plan.shift() : 'ok:คำแปล';
      if (step === 'err') return new Response('{"error":{"message":"boom"}}', { status: 500 });
      if (step === 'hang') return new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      const text = step.slice(3);
      const body = JSON.parse(opts.body || '{}');
      if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: {} }), { status: 200 });
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    };
  });
  await page.goto('http://localhost:' + (process.env.PORT || 8099) + '/index.html');
  await page.waitForTimeout(800);
  const ev = (f, a) => page.evaluate(f, a);
  let fail = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };

  // 1) ภาษาตามข้อความจริง: ต้นฉบับจีนใน workspace ที่ตั้งเป็นเกาหลี → prompt จีน + แจ้งครั้งเดียว
  const tl = await ev(async () => {
    const now = Date.now();
    const zh = '林动站在青阳镇的山门前，抬头望向那座古老的天剑宗。\n“师兄，宗主让你去藏经阁一趟。”苏柔轻声说道。';
    const w = { id: 'mis' + now, name: 'ตั้งผิด', glossary: [{ korean: '林动', thai: 'หลินต้ง', type: 'character', gender: 'male' }, { korean: '天剑宗', thai: 'สำนักกระบี่สวรรค์', type: 'clan' }, { korean: '藏经阁', thai: 'หอคัมภีร์', type: 'place' }],
      customStyles: [], presets: [], chapters: [{ id: 'm1', title: '1', chapterNum: 1, sourceText: zh, translation: '', status: 'pending' }, { id: 'm2', title: '2', chapterNum: 2, sourceText: zh, translation: '', status: 'pending' }],
      settings: { sourceLang: 'ko', autoGlossary: false, speakerMap: false, genrePreset: 'ko-murim' }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const toasts = []; const st = window.showToast; window.showToast = (m, t) => { toasts.push(m); return st(m, t); };
    window.__bodies = []; window.__plan = ['ok:หลินต้งยืนอยู่หน้าประตูสำนัก', 'ok:หลินต้งยืนอยู่หน้าประตูสำนัก'];
    const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('openrouter')) window.__bodies.push(JSON.parse(o.body)); return f(u, o); };
    await translateChapterCore(S.currentWs.chapters[0], { awaitGlossary: true });
    await translateChapterCore(S.currentWs.chapters[1], { awaitGlossary: true });
    window.fetch = f; window.showToast = st;
    const tr = window.__bodies.find(b => b.stream)?.messages?.[0]?.content || '';
    const koPrompt = buildTranslatePrompt({ sourceText: '레온은 창문 너머로 비가 내리는 정원을 내려다보았다. 아침부터 머리가 무거웠다.', ws: S.currentWs });
    const mis = toasts.filter(m => m.includes('ตั้งค่าเรื่องไว้เป็น'));
    openGlossaryAnalyze(); const first = document.getElementById('gaModel').options[0].value; closeModal('modal-glossary-analyze');
    return { trZh: tr.includes('SOURCE LANGUAGE: CHINESE'), trNoKo: !/[가-힣]/.test(tr.replace(/\{[^}]*\}/g, '')), noKoGenre: !tr.includes('GENRE GUIDE'), koOk: !koPrompt.includes('SOURCE LANGUAGE: CHINESE') && koPrompt.includes('GENRE GUIDE'),
      mis: mis.length, misText: mis[0] || '', done: S.currentWs.chapters.every(c => c.translation), first };
  });
  ok('translate prompt follows text language (zh text in ko workspace)', tl.trZh && tl.trNoKo && tl.noKoGenre && tl.done);
  ok('Korean text still gets Korean rules + Korean genre', tl.koOk);
  ok('language mismatch notice shown once', tl.mis === 1 && tl.misText.includes('จีน') && tl.misText.includes('เกาหลี'));
  ok('glossary analysis ranks models by glossary language', tl.first === 'deepseek/deepseek-v4-pro');

  // 2) prompt สกัดคำแบบมืออาชีพ: บริบทเรื่อง + คำในคลังพร้อมคำแปล + [gender?] · 생도 ในโรงเรียนฮันเตอร์ ≠ นักเรียนนายร้อย
  const pro = await ev(async () => {
    const now = Date.now();
    const src = '오늘은 시요람 1학년 생도들의 첫 던전 실습이 있는 날이었다.\n"생도 여러분, 집합!" 교관 백도현이 소리쳤다. 이하율은 고개를 끄덕였다.';
    const w = { id: 'pro' + now, name: '헌터 아카데미', description: '각성자들이 다니는 헌터 아카데미 시요람 이야기', glossary: [{ korean: '시요람', thai: 'ชียอรัม', type: 'place' }, { korean: '이하율', thai: 'อีฮายุล', type: 'character' }, { korean: '서울', thai: 'โซล', type: 'place' }],
      customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'ko', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const p = fillGlossaryPrompt(agGetPrompt('ko'), { ws: S.currentWs, text: src, lang: 'ko' });
    const legacy = fillGlossaryPrompt('เก่า {existing}\n{text}\nOUTPUT: JSON', { ws: S.currentWs, text: src, lang: 'ko' });
    window.__bodies = []; window.__plan = ['ok:[{"source":"생도","thai":"นักเรียนนายร้อย","type":"rank","note":"academy students"},{"source":"교관","thai":"ครูฝึกทหาร","type":"title"},{"source":"백도현","thai":"แพ็กโดฮยอน","type":"character","gender":"male"},{"source":"이하율","thai":"อีฮายุล","type":"character","gender":"male"}]'];
    const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('openrouter')) window.__bodies.push(JSON.parse(o.body)); return f(u, o); };
    await autoExtractGlossaryAfterTranslation(src, 'm', null, '', { quiet: true });
    window.fetch = f;
    const sent = window.__bodies[0]?.messages?.[0]?.content || '';
    const g = k => S.currentWs.glossary.find(x => x.korean === k);
    return {
      ctx: p.includes('Title: 헌터 아카데미') && p.includes('Synopsis: 각성자들이') && !p.includes('{story_context}') && !p.includes('{existing}'),
      known: p.includes('시요람 = ชียอรัม') && p.includes('이하율 = อีฮายุล [gender?]') && !p.includes('서울 = โซล'),
      senses: p.includes('생도 — dictionary: military cadet') && p.includes('STEP 7'),
      legacy: legacy.includes('STORY CONTEXT') && legacy.includes('Title: 헌터 아카데미') && legacy.indexOf('STORY CONTEXT') < legacy.indexOf('OUTPUT:'),
      sent: sent.includes('Title: 헌터 아카데미') && sent.includes('이하율 = อีฮายุล [gender?]'),
      cadet: g('생도')?.thai, instr: g('교관')?.thai, gender: g('이하율')?.gender, thai: g('이하율')?.thai,
      knight: fixSenseByContext('생도', 'นักเรียนนายร้อย', '제국 기사 사관학교의 생도들'), cadetEn: fixSenseByContext('Cadet', 'นักเรียนนายร้อย', 'the hunter academy'),
      other: fixSenseByContext('기사', 'อัศวิน', '던전'),
    };
  });
  ok('glossary prompt carries story context (title/synopsis), no raw placeholders', pro.ctx);
  ok('known terms in text listed with Thai + [gender?] for characters without gender', pro.known && pro.sent);
  ok('professional steps + context senses in Korean prompt', pro.senses);
  ok('old custom prompt still gets a STORY CONTEXT block', pro.legacy);
  ok('생도/교관 at hunter academy → นักเรียน/ครูฝึก (not military)', pro.cadet === 'นักเรียน' && pro.instr === 'ครูฝึก');
  ok('[gender?] re-send fills gender only, keeps Thai', pro.gender === 'male' && pro.thai === 'อีฮายุล');
  ok('real military/knight academy keeps นักเรียนนายร้อย; other words untouched', pro.knight === 'นักเรียนนายร้อย' && pro.cadetEn === 'นักเรียน' && pro.other === 'อัศวิน');

  // 3) คำแทนตัวผู้เล่า: บรรยาย/คิดในใจ = ฉัน (ค่าเริ่มต้น แม้ผู้เล่าเป็นชาย) · บทพูดสุภาพ = ผม · preset เก่าที่มีกฎ "ห้ามใช้ ฉัน กับผู้ชาย" ถูกแก้ตอนสร้าง prompt
  const nv = await ev(async () => {
    const now = Date.now();
    const oldLine = '• Male (gender:male) → 3rd: เขา/ของเขา | 1st: ผม/กู/ข้า (match register). NEVER use ฉัน/เธอ/นาง for males.';
    const w = { id: 'nv' + now, name: 'ผู้เล่า', glossary: [{ korean: '이하율', thai: 'อีฮายุล', type: 'character', gender: 'male' }],
      customStyles: [], presets: [{ id: 'old', name: 'เก่า', temperature: 0.5, systemPrompt: `แปล\n${oldLine}\n• First-person narration (나/저/我 etc.) → use the narrator's gender from the glossary; do not default blindly.\nGLOSSARY:\n{glossary}\n{context}\n{text}` }], presetId: 'old',
      chapters: [], settings: { sourceLang: 'ko', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const src = '나는 눈을 떴다. \'이게 뭐야.\' "괜찮습니다."';
    const p1 = buildTranslatePrompt({ sourceText: src, ws: S.currentWs });
    const map = [{ speaker: '이하율', gender: 'male', kind: 'sq', q: '이게 뭐야' }, { speaker: '이하율', gender: 'male', kind: 'dq', q: '괜찮습니다' }];
    const sm = speakerMapPromptBlock(map, S.currentWs);
    S.currentWs.settings.consistencyLock = true;
    const cl = buildTranslatePrompt({ sourceText: src, ws: S.currentWs });
    S.currentWs.settings.consistencyLock = false;
    renderWsSettings(); const def = document.getElementById('wsNarratorSelf').value;
    document.getElementById('wsNarratorSelf').value = 'ผม'; document.getElementById('wsEditName').value = S.currentWs.name; await saveWsSettings();
    const saved = S.currentWs.settings.narratorSelf;
    const p2 = buildTranslatePrompt({ sourceText: src, ws: S.currentWs }), sm2 = speakerMapPromptBlock(map, S.currentWs);
    S.currentWs.settings.narratorSelf = 'gender';
    const p3 = buildTranslatePrompt({ sourceText: src, ws: S.currentWs });
    return {
      block: p1.includes('NARRATOR VOICE') && p1.includes('→ "ฉัน" for the narrator, male or female alike'), oldGone: !p1.includes('NEVER use ฉัน/เธอ/นาง for males') && !p1.includes("use the narrator's gender from the glossary; do not default blindly"),
      once: p1.split('NARRATOR VOICE (').length === 2,
      smThought: sm.includes('‘…’ thought → 이하율') && /thought[^\n]*self: ฉัน/.test(sm), smSpoken: /“…”[^\n]*self: ผม/.test(sm),
      lock: cl.includes('render first-person NARRATION and inner thoughts as "ฉัน"'),
      def, saved, p2: p2.includes('→ "ผม" for the narrator'), sm2: /thought[^\n]*self: ผม/.test(sm2), p3: p3.includes('male → ผม · female → ฉัน'),
      polish: POLISH_PROMPT.includes('never change ฉัน ↔ ผม'),
    };
  });
  ok('narration/thoughts default to ฉัน even for a male narrator', nv.block && nv.once);
  ok('old saved preset: "NEVER use ฉัน for males" rule replaced at build time', nv.oldGone);
  ok('speaker map: male thought → ฉัน, male polite speech → ผม', nv.smThought && nv.smSpoken);
  ok('consistency lock auto follows narrator setting', nv.lock);
  ok('narrator setting saved/loaded (ผม / ตามเพศ)', nv.def === '' && nv.saved === 'ผม' && nv.p2 && nv.sm2 && nv.p3);
  ok('polish keeps narrator pronoun', nv.polish);

  // 4) 검 ในโลกฮันเตอร์/อนาคต = ดาบ · ยุทธภพยังเป็น กระบี่
  const sw = await ev(async () => {
    const now = Date.now();
    const src = '2187년, 던전이 열린 지 백 년. 나는 전생에 검성이라 불렸다. [스킬 \'검기 방출\'이 활성화되었습니다.]';
    const w = { id: 'sw' + now, name: '미래 헌터', glossary: [], customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'ko', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    window.__plan = ['ok:[{"source":"검성","thai":"ราชันกระบี่","type":"title"},{"source":"검기 방출","thai":"ปลดปล่อยปราณกระบี่","type":"skill"}]'];
    await autoExtractGlossaryAfterTranslation(src, 'm', null, '', { quiet: true });
    const g = k => S.currentWs.glossary.find(x => x.korean === k)?.thai;
    const ko = agGetPrompt('ko');
    return { a: g('검성'), b: g('검기 방출'), prompt: ko.includes('검성 จอมดาบ') && !ko.includes('검성 ราชันกระบี่') && ko.includes('กระบี่ ONLY in a murim'),
      murim: fixSenseByContext('검기', 'ปราณกระบี่', '화산파의 매화검수가 무림맹에 왔다'), zh: fixSenseByContext('剑气', 'ปราณกระบี่', '他拔出长剑'), other: fixSenseByContext('검은 탑', 'หอคอยดำ', '던전') };
  });
  ok('hunter/future story: 검 terms → ดาบ (not กระบี่)', sw.a === 'ราชันดาบ' && sw.b === 'ปลดปล่อยปราณดาบ' && sw.prompt);
  ok('murim and Chinese sources keep กระบี่', sw.murim === 'ปราณกระบี่' && sw.zh === 'ปราณกระบี่' && sw.other === 'หอคอยดำ');

  // 5) แนวนิยายครบชุด: 18 แนว ทุกแนวมีแนวทาง + สิ่งที่ลงคลัง + ชุดคำ · prompt สกัดคำได้ "WHAT TO LOCK" · คำอังกฤษต้องตรงทั้งคำ
  const gx = await ev(async () => {
    const types = ['character', 'title', 'rank', 'term', 'honorific', 'place', 'skill', 'item', 'clan', 'monster'];
    const valid = GENRE_PRESETS.every(g => g.id && g.name && g.desc && g.guide && g.gloss && g.terms.length >= 20 && g.terms.every(t => t.length === 5 && types.includes(t[2]) && t[0] && t[1]));
    const uniq = new Set(GENRE_PRESETS.map(g => g.id)).size === GENRE_PRESETS.length;
    const byLang = l => GENRE_PRESETS.filter(g => g.lang === l).length;
    const now = Date.now();
    const w = { id: 'gp' + now, name: 'หมาป่า', glossary: [], customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'en', genrePreset: 'en-werewolf' }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const ag = agGetPrompt('en');
    const g = getGenrePreset(S.currentWs);
    const h1 = genreTermHints(g, 'She walked to the market with her pack.', []), h2 = genreTermHints(g, 'His mark burned. The Alphas gathered.', []);
    openGenrePreset(); const opts = [...document.querySelectorAll('#gpSelect option')].map(o => o.value);
    document.getElementById('gpSelect').value = 'zh-palace'; gpRender(); const guideTxt = document.getElementById('gpGuide').textContent;
    closeModal('modal-genre-preset');
    return { valid, uniq, n: GENRE_PRESETS.length, ko: byLang('ko'), zh: byLang('zh'), en: byLang('en'),
      ag: ag.includes('GENRE (อังกฤษ · มนุษย์หมาป่า') && ag.includes('WHAT TO LOCK IN THIS GENRE') && ag.includes('Luna = ลูน่า'),
      hints: !h1.some(x => x.startsWith('Mark ')) && h1.some(x => x.startsWith('Pack ')) && h2.some(x => x.startsWith('Mark ')) && h2.some(x => x.startsWith('Alpha ')),
      ui: opts.length === GENRE_PRESETS.length && opts.includes('ko-academy') && guideTxt.includes('สิ่งที่ลงคลังศัพท์ในแนวนี้') };
  });
  ok('18 genre presets, each with guide + glossary rules + term set', gx.valid && gx.uniq && gx.n === 18 && gx.ko === 8 && gx.zh === 6 && gx.en === 4);
  ok('glossary prompt carries the genre "what to lock" rules + standard renderings', gx.ag);
  ok('English genre hints match whole words (market ≠ Mark)', gx.hints);
  ok('genre picker lists every preset and shows glossary rules', gx.ui);

  // 6) ตำแหน่งที่หมายถึงคนเดียวในเรื่องมีเพศได้ (원장 = ผู้อำนวยการหญิง) → prompt แปลบอก เธอ · AI เติมเพศให้ตำแหน่งเดิม · แก้ในหน้าคลังได้
  const tg = await ev(async () => {
    const now = Date.now();
    const w = { id: 'tg' + now, name: 'ตำแหน่ง', glossary: [{ korean: '원장', thai: 'ผู้อำนวยการ', type: 'title' }, { korean: '교관', thai: 'ครูฝึก', type: 'title' }],
      customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'ko', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const keep = sanitizeGlossaryEntry({ korean: 'a', thai: 'ก', type: 'title', gender: 'female' })?.gender, drop = sanitizeGlossaryEntry({ korean: 'b', thai: 'ข', type: 'term', gender: 'female' })?.gender;
    window.__plan = ['ok:[{"source":"원장","thai":"ผู้อำนวยการ","type":"title","gender":"female"},{"source":"교관","thai":"ครูฝึก","type":"title"}]'];
    await autoExtractGlossaryAfterTranslation('원장은 창가에 서 있었다. 그녀는 시요람을 세웠다. 교관이 경례했다.', 'm', null, '', { quiet: true });
    const g = k => S.currentWs.glossary.find(x => x.korean === k);
    const filled = g('원장')?.gender;
    const gs = buildGlossaryStr({ 원장: g('원장'), 교관: g('교관') });
    const sm = speakerMapPromptBlock([{ speaker: '원장', gender: 'female', kind: 'dq', q: '앉게' }], S.currentWs);
    editGlossaryEntry('원장'); const shown = document.getElementById('gGenderGroup').style.display !== 'none', val = document.getElementById('gGender').value;
    document.getElementById('gGender').value = 'male'; await saveGlossaryEntry();
    return { keep, drop, filled, shared: g('교관')?.gender, thai: g('원장')?.thai,
      gs: /원장 = ผู้อำนวยการ \| title held by one woman[^\n]*เธอ/.test(gs) && !/교관 =[^\n]*title held/.test(gs), sm: sm.includes('ผู้อำนวยการ = หญิง'),
      shown, val, saved: S.currentWs.glossary.find(x => x.korean === '원장')?.gender, prompt: agGetPrompt('ko').includes('For type "title": give "gender" only when the title points to ONE specific person') };
  });
  ok('title entries keep gender (other types do not)', tg.keep === 'female' && tg.drop === undefined);
  ok('auto glossary fills gender on an existing title, not on shared titles', tg.filled === 'female' && tg.shared === undefined && tg.thai === 'ผู้อำนวยการ' && tg.prompt);
  ok('translate prompt: gendered title → เธอ · speaker map lists it', tg.gs && tg.sm);
  ok('glossary editor shows + saves gender for titles', tg.shown && tg.val === 'female' && tg.saved === 'male');

  // 7) ตำแหน่งในคลังที่ยังไม่มีเพศ → ส่งเข้า prompt พร้อม [gender?] + คำสั่ง GENDER FILL · แผนที่ผู้พูดใช้เพศของตำแหน่ง (ต้องตรงตัว — "보육원 원장" คนละคน)
  const tf = await ev(async () => {
    const now = Date.now();
    const w = { id: 'tf' + now, name: 'เติมเพศ', glossary: [{ korean: '원장', thai: 'ผู้อำนวยการ', type: 'title' }],
      customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'ko', speakerMap: true }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const src = '"앉게." 원장이 말했다. 그녀는 창가에 서 있었다.\n"어서 와라." 보육원 원장이 웃었다.';
    const p = fillGlossaryPrompt(agGetPrompt('ko'), { ws: S.currentWs, text: src, lang: 'ko' });
    S.currentWs.glossary[0].gender = 'female';
    window.__plan = ['ok:{"lines":[{"q":1,"speaker":"원장","gender":"unknown"},{"q":2,"speaker":"보육원 원장","gender":"male"}],"names":[]}'];
    const map = await buildSpeakerMap(src, 'm', S.currentWs);
    const gs = buildGlossaryStr({ 원장: S.currentWs.glossary[0] });
    return { mark: p.includes('원장 = ผู้อำนวยการ [gender? — only if this title means one specific person]'), rule: p.includes('GENDER FILL — REQUIRED') && p.includes('EXCEPT entries marked [gender?]'),
      g1: map?.[0]?.gender, g2: map?.[1]?.gender, esc: gs.includes('if the text clearly means a different holder') };
  });
  ok('title without gender is marked [gender?] + GENDER FILL rule in extraction prompt', tf.mark && tf.rule);
  ok('speaker map uses the title\'s gender only for an exact match', tf.g1 === 'female' && tf.g2 === 'male');
  ok('translate prompt lets a different holder of the title keep their own gender', tf.esc);

  // 8) ไม่รู้เพศ → ห้ามเดา เขา/เธอ: เรียกชื่อ/ตำแหน่งซ้ำ หรือ ท่าน/อีกฝ่าย/คนผู้นั้น (บอกไว้ข้างคำในคลัง + กฎรวม + preset เก่า + Polish)
  const ng = await ev(async () => {
    const now = Date.now();
    const oldLine = '• Unknown gender → use เขา (3rd) / ฉัน (1st) as default until clarified.';
    const w = { id: 'ng' + now, name: 'ไม่รู้เพศ', glossary: [], customStyles: [], chapters: [],
      presets: [{ id: 'old', name: 'เก่า', temperature: 0.5, systemPrompt: `แปล\n${oldLine}\nGLOSSARY:\n{glossary}\n{context}\n{text}` }], presetId: 'old',
      settings: { sourceLang: 'ko', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const gs = buildGlossaryStr({ 원장: { korean: '원장', thai: 'ผู้อำนวยการ', type: 'title' }, 하린: { korean: '하린', thai: 'ฮาริน', type: 'character', gender: 'neutral' },
      도윤: { korean: '도윤', thai: 'โดยุน', type: 'character', gender: 'male' }, 마석: { korean: '마석', thai: 'หินเวท', type: 'item' } });
    const p = buildTranslatePrompt({ sourceText: '원장이 말했다.', ws: S.currentWs });
    return { title: gs.includes('원장 = ผู้อำนวยการ | gender unknown → never เขา/เธอ/นาง for whoever holds this title: drop the subject where Thai allows, otherwise ท่าน · อีกฝ่าย · คนผู้นั้น or "ผู้อำนวยการ" · in their own lines no ครับ/ค่ะ/ผม/ดิฉัน'),
      neutral: gs.includes('하린 = ฮาริน | gender:neutral/กลาง → never เขา/เธอ/นาง for this person'),
      male: /도윤 = [^\n]*3rd→เขา/.test(gs) && !/도윤 =[^\n]*never/.test(gs), item: !/마석 =[^\n]*never/.test(gs),
      old: !p.includes(oldLine) && p.includes('never guess. Prefer, in this order: (1) drop the subject') && (p.match(/• Unknown or unclear gender/g) || []).length === 1,
      polish: POLISH_PROMPT.includes('it was left neutral on purpose') };
  });
  ok('unknown/neutral gender → glossary line forbids เขา/เธอ and names the neutral options', ng.title && ng.neutral && ng.male && ng.item);
  ok('old saved preset "Unknown gender → เขา" replaced · Polish keeps neutral wording', ng.old && ng.polish);

  // 9) ตำแหน่งที่ต้นฉบับบอกว่ามีหลายคน → ไม่บันทึกเพศ (Gemini Lite เคยใส่ 教官 = male ทั้งที่มี "其他教官")
  const sh = await ev(async () => {
    const now = Date.now();
    const w = { id: 'sh' + now, name: 'หลายคน', glossary: [{ korean: '教官', thai: 'ครูฝึก', type: 'title' }], customStyles: [], presets: [], chapters: [], settings: { sourceLang: 'zh', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    window.__plan = ['ok:[{"source":"院长","thai":"ผู้อำนวยการ","type":"title","gender":"female"},{"source":"教官","thai":"ครูฝึก","type":"title","gender":"male"},{"source":"助教","thai":"ผู้ช่วยสอน","type":"title","gender":"male"}]'];
    await autoExtractGlossaryAfterTranslation('院长站在窗边。她是创立者之一。教官白道贤敬礼。其他教官也排成一列。助教们在门外等着。', 'm', null, '', { quiet: true });
    const g = k => S.currentWs.glossary.find(x => x.korean === k);
    return { dir: g('院长')?.gender, inst: g('教官')?.gender, ta: g('助教') ? (g('助教').gender || 'none') : 'missing',
      ko: titleLooksShared('교관', '다른 교관들도 서 있었다'), en: titleLooksShared('Instructor', 'the other instructors'), solo: titleLooksShared('원장', '원장은 창가에 서 있었다') };
  });
  ok('shared titles (其他教官 · 助教们) never get a gender; a one-person title does', sh.dir === 'female' && sh.inst === undefined && sh.ta === 'none' && sh.ko && sh.en && !sh.solo);

  // 11) Bible ของนิยาย: สแกนต้นฉบับ → เสนอ ภาษา/แนว/สไตล์/คำแทนตัว/เรื่องย่อ + Bible + ตัวละคร → ตรวจแล้วใช้ → ไหลเข้า prompt แปลและ prompt สกัดคำ
  const bb = await ev(async () => {
    const now = Date.now();
    const ko = '나는 시요람 1학년 생도였다. 원장은 창가에 서 있었다. 그녀는 시요람을 세웠다.\n"앉게, 이하율 학생." 원장이 말했다.\n[스킬 \'공간지각\'이 활성화되었습니다.]';
    const w = { id: 'bb' + now, name: 'Bible', glossary: [{ korean: '이하율', thai: 'อีฮายุล', type: 'character' }], customStyles: [], presets: [], styleSheet: { terms: 'เดิม' },
      chapters: [{ id: 'b1', title: 'บทนำ', chapterNum: 1, sourceText: ko, translation: '', status: 'pending' }], settings: { sourceLang: 'en', speakerMap: false }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const built = buildBiblePrompt(S.currentWs, S.currentWs.chapters);
    const pid = (S.currentWs.presets || []).find(x => x.id === 'seed-webtoon') ? 'seed-webtoon' : (S.currentWs.presets[0]?.id || 'seed-webtoon');
    window.__bodies = []; const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('openrouter')) window.__bodies.push(JSON.parse(o.body)); return f(u, o); };
    window.__plan = ['ok:' + JSON.stringify({ genre: 'ko-academy', preset: pid, narratorSelf: '', reasons: { genre: 'มีอะคาเดมีและสกิล', preset: 'อ่านมือถือ', narratorSelf: 'เล่าบุรุษที่ 1' },
      synopsis: 'อีฮายุลเข้าเรียนที่ชียอรัม', world: '• เกาหลียุคอนาคต มีดันเจี้ยน\n• ชียอรัม = อะคาเดมีฝึกฮันเตอร์ ไม่ใช่โรงเรียนทหาร', translit: '• ชื่อคน: ทับศัพท์', terms: '• 생도 = นักเรียน',
      narration: '• บุรุษที่ 1 ใช้ ฉัน', format: '• ข้อความระบบ […]', voices: '• ผู้อำนวยการ: ห้วน เย็นชา', glossRules: '• 원장 = ผู้อำนวยการ (หญิงคนเดียว)\n• ไม่ต้องเก็บอุปกรณ์ทั่วไป',
      characters: [{ source: '이하율', thai: 'อีฮายุล', gender: 'male', role: 'ตัวเอก' }, { source: '엘리아', thai: 'เอเลีย', gender: 'female', role: 'เพื่อน' }, { source: '나쁜이름', thai: '나쁜', gender: 'male' }],
      titles: [{ source: '원장', thai: 'ผู้อำนวยการ', gender: 'female', role: 'หัวหน้าชียอรัม' }] })];
    await scanNovelBible();
    window.fetch = f;
    const shown = document.getElementById('modal-bible').classList.contains('open');
    const sentPrompt = window.__bodies[0]?.messages?.[0]?.content || '';
    const ids = [...document.querySelectorAll('#modal-bible input[type=checkbox]')].map(x => x.id + (x.checked ? '+' : '-'));
    const peopleTxt = document.getElementById('bbPeople').textContent;
    await applyBible();
    const ws = S.currentWs, g = k => ws.glossary.find(x => x.korean === k);
    const tp = buildTranslatePrompt({ sourceText: ko, ws });
    const gp = fillGlossaryPrompt(agGetPrompt('ko'), { ws, text: ko, lang: 'ko' });
    return { built: built.lang === 'ko' && built.prompt.includes('ko-academy —') && !built.prompt.includes('zh-xianxia —') && built.prompt.includes('[KO]'), sent: sentPrompt.includes('NOVEL') || sentPrompt.includes('BIBLE'), shown, ids,
      peopleOk: peopleTxt.includes('เติมเพศ') && peopleTxt.includes('เอเลีย') && !peopleTxt.includes('나쁜이름'),
      lang: ws.settings.sourceLang, genre: ws.settings.genrePreset, preset: ws.presetId === pid, narr: ws.settings.narratorSelf, desc: ws.description,
      world: ws.styleSheet.world?.includes('อะคาเดมีฝึกฮันเตอร์'), termsKept: ws.styleSheet.terms === 'เดิม', glossRules: !!ws.styleSheet.glossRules,
      hayul: g('이하율')?.gender, elia: g('엘리아')?.gender, dir: g('원장') && g('원장').type === 'title' && g('원장').gender === 'female',
      tpWorld: tp.includes('WORLD OF THIS NOVEL') && tp.includes('อะคาเดมีฝึกฮันเตอร์'), tpNoRules: !tp.includes('หญิงคนเดียว'),
      gpWorld: gp.includes('World (from the novel bible)') && gp.includes("This novel's glossary rules") && gp.includes('หญิงคนเดียว'), gpGenre: gp.includes('GENRE (เกาหลี · อะคาเดมี') };
  });
  ok('bible scan: language detected from source, genres of that language only, review opens', bb.built && bb.sent && bb.shown);
  ok('bible review: existing field unticked, empty fields ticked, bad Thai name dropped, gender fill offered', bb.ids.includes('bb-f-terms-') && bb.ids.includes('bb-f-world+') && bb.ids.includes('bb-set-desc+') && bb.peopleOk);
  ok('bible apply: language + genre + preset + narrator + synopsis set', bb.lang === 'ko' && bb.genre === 'ko-academy' && bb.preset && (bb.narr || '') === '' && !bb.ids.some(x => x.startsWith('bb-set-narr')) && bb.desc === 'อีฮายุลเข้าเรียนที่ชียอรัม');
  ok('bible apply: fields saved, old field kept, characters/titles added with gender', bb.world && bb.termsKept && bb.glossRules && bb.hayul === 'male' && bb.elia === 'female' && bb.dir);
  ok('bible feeds prompts: world → translate + glossary · glossary rules → glossary only', bb.tpWorld && bb.tpNoRules && bb.gpWorld && bb.gpGenre);

  // 12) prompt ไม่สั่งขัดกันเอง: ลำดับความสำคัญ · ล็อกสรรพนามแยกบรรยาย/บทพูด · preset เก่าถูกแก้กฎที่ขัด · ยุทธภพใช้ ข้า ไม่ใช่ ผม
  const cf = await ev(async () => {
    const now = Date.now();
    const old = 'You translate.\n• Preserve paragraph breaks, sentence count, and pacing. Never add, omit, summarize, or reorder content.\n• Do not translate proper names unless they appear in the glossary.\n• Female (gender:female) → 3rd: เธอ/นาง/ของเธอ | 1st: ฉัน/หนู/อิฉัน. NEVER use ผม/กู for females.\n• Replace flat or repeated word choices with precise, idiomatic Thai; fix awkward word order.\nGLOSSARY:\n{glossary}\n\n{text}';
    const w = { id: 'cf' + now, name: 'ขัดกัน', glossary: [{ korean: '레온', thai: 'เลออน', type: 'character', gender: 'male' }], customStyles: [],
      presets: [{ id: 'p-old', name: 'เก่า', emoji: '📖', systemPrompt: old, temperature: 0.5 }], presetId: 'p-old', chapters: [],
      settings: { sourceLang: 'ko', genrePreset: 'ko-academy', consistencyLock: true, consistencySelfRef: 'auto' }, createdAt: now };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const src = '레온은 고개를 끄덕였다. “알겠습니다.”';
    const p = buildTranslatePrompt({ sourceText: src, glossaryStr: buildGlossaryStr({ 레온: w.glossary[0] }), ws: S.currentWs });
    const map = [{ speaker: '레온', gender: 'male', kind: 'dq', q: '알겠습니다.' }, { speaker: '레온', gender: 'male', kind: 'dq', q: '가자' }];
    const smModern = speakerMapPromptBlock(map, S.currentWs);
    S.currentWs.settings.genrePreset = 'ko-murim';
    const smMurim = speakerMapPromptBlock(map, S.currentWs), pMurim = buildTranslatePrompt({ sourceText: src, ws: S.currentWs });
    const pri = p.indexOf('WHEN TWO RULES DISAGREE');
    return { pri: pri > p.indexOf('GLOSSARY:') && pri < p.indexOf('NARRATOR VOICE'),
      oldFixed: !p.includes('sentence count, and pacing') && !p.includes('unless they appear in the glossary') && !p.includes('NEVER use ผม/กู for females') && !p.includes('flat or repeated'),
      lockScoped: p.includes('first-person NARRATION and inner thoughts as "ฉัน"') && p.includes('Spoken dialogue is not narration') && !p.includes('narration/self-reference'),
      registerByListener: p.includes('toward a given listener'),
      noJa: !p.includes('จ้ะ'),
      modern: smModern.includes('self: ผม') && smModern.includes('ฉัน/ผม by register') && !smModern.includes('ผม/ข้า'),
      murim: smMurim.includes('ขอรับ, self: ข้า') && !smMurim.includes('self: ผม') && pMurim.includes('Do not use modern ผม + ครับ here'),
      genreYields: p.includes('the glossary and the style sheet always win') };
  });
  ok('prompt priority block sits right after the glossary', cf.pri);
  ok('saved old preset: conflicting lines rewritten at runtime', cf.oldFixed);
  ok('consistency lock: narration word locked, dialogue pronouns not forced', cf.lockScoped && cf.registerByListener && cf.noJa);
  ok('speaker map self-word follows setting (modern ผม · murim ข้า)', cf.modern && cf.murim && cf.genreYields);

  // 13) แผนที่ผู้พูดในเรื่องยุคโบราณ: รู้จากหลายแหล่ง (ไม่ตั้งแนวก็รู้) · ตัวแก้เปลี่ยน ผม/ครับ → ข้า/ขอรับ เฉพาะเมื่อแน่ใจ · ชื่อในคลังไม่ถูกสะกดใหม่
  const ar = await ev(async () => {
    const now = Date.now();
    const mk = async (extra = {}, chapters = []) => { const w = { id: 'ar' + Math.random(), name: 'โบราณ', glossary: [{ korean: '화산파', thai: 'สำนักฮวาซาน', type: 'clan' }], customStyles: [], chapters, settings: { sourceLang: 'ko', ...extra }, createdAt: now }; await lsSaveWorkspace(w); await selectWorkspace(w.id); return S.currentWs; };
    const murimSrc = '청운은 포권을 취했다. “사부님께서 부르셨습니다.”', modernSrc = '민준은 고개를 숙였다. “부장님, 부르셨습니까?”';
    const r = {};
    let ws = await mk(); r.textOn = archaicSpeechInfo(ws, murimSrc).on && !archaicSpeechInfo(ws, murimSrc).sure; r.modernOff = !archaicSpeech(ws, modernSrc);
    ws = await mk({ genrePreset: 'ko-hunter' }); r.modernGenreBlocksText = !archaicSpeech(ws, murimSrc);
    ws = await mk(); ws.presetId = (ws.presets.find(p => p.id === 'seed-wuxia') || {}).id; r.preset = archaicSpeechInfo(ws).sure;
    ws = await mk({}, [{ id: 'c1', chapterNum: 1, title: '1', sourceText: 'x', translation: '“ข้าน้อยเข้าใจแล้วขอรับ” เขากล่าว “เจ้าอย่าประมาท” “ข้ารอท่านอยู่เจ้าค่ะ”\n'.repeat(5) }]); r.prev = archaicSpeechInfo(ws).sure;
    ws = await mk({}, [{ id: 'c1', chapterNum: 1, title: '1', sourceText: 'x', translation: '“ผมเข้าใจแล้วครับ” เขากล่าว “ฉันรอคุณอยู่ค่ะ” ข้างๆ มีข้าวของ\n'.repeat(5) }]); r.prevModern = !archaicSpeechInfo(ws).sure;
    ws = await mk({ narratorSelf: 'ข้า' });
    window.__plan = ['ok:{"lines":[{"q":1,"speaker":"청운","gender":"male"}],"names":[{"korean":"화산파","thai":"ฮวาซานพา","gender":"unknown"},{"korean":"청운","thai":"ชองอุน","gender":"male"}]}'];
    const map = await buildSpeakerMap('청운이 말했다. “화산파의 제자입니다.”', 'm', ws);
    const blk = speakerMapPromptBlock(map, ws);
    r.mapOld = !!map && map[0].archaic === 'sure' && blk.includes('ขอรับ, self: ข้า/ข้าน้อย') && !blk.includes('self: ผม');
    r.names = !!map && !map.names.some(n => n.korean === '화산파') && map.names.some(n => n.korean === '청운');
    r.fix = applySpeakerFixes('“ผมเป็นศิษย์ของสำนักฮวาซานครับ”', map).text === '“ข้าเป็นศิษย์ของสำนักฮวาซานขอรับ”';
    r.fixF = fixQuoteGender('ฉันรอนานแล้วนะคะ ผมยาวของท่าน', 'female', true) === 'ข้ารอนานแล้วนะเจ้าคะ ผมยาวของท่าน';
    r.noFixModern = fixQuoteGender('ผมเข้าใจแล้วครับ', 'male') === 'ผมเข้าใจแล้วครับ';
    return r;
  });
  ok('archaic register detected without a genre (source text · wuxia preset · earlier chapters), modern stays modern', ar.textOn && ar.modernOff && ar.modernGenreBlocksText && ar.preset && ar.prev && ar.prevModern);
  ok('speaker map in archaic story: ข้า + ขอรับ, auto-fix ผม/ครับ → ข้า/ขอรับ', ar.mapOld && ar.fix && ar.fixF && ar.noFixModern);
  ok('speaker map names never re-spell a glossary term', ar.names);

  // 14) แผนที่ผู้พูดอ่าน JSON เสียของโมเดลเล็กได้ · เรื่องโบราณแก้ ครับ/ค่ะ ในบทพูดแม้ไม่มีแผนที่ (เรื่องปัจจุบันไม่แตะ)
  const rg = await ev(async () => {
    const r = {};
    const bad = '```json\n{"lines":[{"q":1,"speaker":"무량천","gender":"male"},{"q":2,"speaker":"괴인","gender":"male"}],"\n "names":[{"korean":"창식","thai":"ชางชิก","gender":"male"}]}\n```';
    const p1 = _parseSpeakerMapJson(bad); r.repair = p1.arr?.length === 2 && p1.names.length === 1;
    const p2 = _parseSpeakerMapJson('{"lines":[{"q":1,"speaker":"a","gender":"male"} {"q":2,"speaker":"b","gender":"female"}], "names": [}');
    r.salvage = p2.arr?.length === 2 && p2.arr[1].gender === 'female';
    const mk = async (st) => { const w = { id: 'rg' + Math.random(), name: 'rg', glossary: [], customStyles: [], chapters: [], settings: { sourceLang: 'ko', ...st }, createdAt: Date.now() }; await lsSaveWorkspace(w); await selectWorkspace(w.id); return S.currentWs; };
    const th = 'เขาก้มหัว “ขออภัยครับพี่ใหญ่ ผมผิดไปแล้ว” นางยิ้ม “ท่านมาแล้วหรือคะ ฉันรออยู่ค่ะ” ‘ผมต้องหนี’';
    let ws = await mk({ genrePreset: 'ko-murim' });
    const a = applySpeakerFixes(th, null, ws).text;
    r.old = a.includes('“ขออภัยขอรับพี่ใหญ่ ข้าผิดไปแล้ว”') && a.includes('“ท่านมาแล้วหรือเจ้าคะ ข้ารออยู่เจ้าค่ะ”') && a.includes('‘ผมต้องหนี’');
    r.narrAuto = getNarratorSelf(ws) === 'ข้า' && buildTranslatePrompt({ sourceText: '나는 웃었다.', ws }).includes('→ "ข้า" for the narrator');
    ws = await mk({ genrePreset: 'ko-murim', narratorSelf: 'ฉัน' }); r.narrExplicit = getNarratorSelf(ws) === 'ฉัน';
    ws = await mk({ genrePreset: 'ko-modern' });
    r.modern = applySpeakerFixes(th, null, ws).text === th && getNarratorSelf(ws) === 'ฉัน';
    return r;
  });
  ok('speaker map survives broken JSON from small models', rg.repair && rg.salvage);
  ok('archaic story: dialogue register fixed even without a speaker map · modern untouched', rg.old && rg.modern);
  ok('narrator word "auto": ข้า in an archaic story, ฉัน otherwise · explicit ฉัน kept', rg.narrAuto && rg.narrExplicit);

  // 15) แผนที่ผู้พูดคุมค่าใช้จ่าย: 3 โหมด · เลือกโมเดลได้ทุกตัว + ใส่เองได้ · ประมาณราคาต่อตอน · โหมด "ระบุผู้พูดอย่างเดียว" ไม่เรียกตรวจเพศ
  const sc = await ev(async () => {
    const r = {};
    const src = '레온이 말했다. “가자.” 아리아가 웃었다. “네.”\n'.repeat(40);
    const w = { id: 'sc' + Date.now(), name: 'cost', glossary: [{ korean: '레온', thai: 'เลออน', type: 'character', gender: 'male' }], customStyles: [],
      chapters: [1, 2, 3].map(n => ({ id: 'c' + n, chapterNum: n, title: '' + n, sourceText: src, translation: n === 1 ? 'แปลแล้ว' : '', status: 'pending' })),
      settings: { sourceLang: 'ko', translateModel: 'google/gemini-3.1-flash-lite', proofreadModel: 'my/custom-model' }, createdAt: Date.now() };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const ws = S.currentWs;
    r.modes = ['full', 'map', 'off'].every(m => speakerModeOf({ settings: speakerModeSettings(m) }) === m) && speakerModeOf(ws) === 'full';
    const sel = document.createElement('select'); renderHelperModelSelect(sel, ws);
    const vals = [...sel.options].map(o => o.value);
    r.select = sel.value === 'my/custom-model' && vals.includes('same') && vals.includes('__custom__') && vals.includes('google/gemini-3.1-flash-lite') && vals.length > 10;
    const full = estimateSpeakerCost(ws, 'google/gemini-3-flash-preview');
    const mapOnly = estimateSpeakerCost({ ...ws, settings: { ...ws.settings, ...speakerModeSettings('map') } }, 'google/gemini-3-flash-preview');
    const cheap = estimateSpeakerCost(ws, 'openai/gpt-oss-120b');
    r.cost = full.perCh > mapOnly.perCh && mapOnly.perCh > cheap.perCh && full.left === 2 && Math.abs(full.total - full.perCh * 2) < 1e-12 && estimateSpeakerCost(ws, 'my/custom-model').rate === null;
    const c0 = window.__calls;
    window.__plan = ['ok:', 'ok:{"lines":[{"q":1,"speaker":"레온","gender":"male"},{"q":2,"speaker":"아리아","gender":"female"}],"names":[]}'];
    const rm = await buildSpeakerMap('레온이 말했다. “가자.” 아리아가 웃었다. “네.”', 'm', ws);
    r.retry = !!rm && rm.length === 2 && rm[1].gender === 'female' && window.__calls - c0 === 2;
    ws.settings.speakerCheck = false;
    const before = window.__calls;
    const gp = await genderProofread(src, 'เขายิ้ม '.repeat(50), 'm', ws);
    r.noCheck = window.__calls === before && gp.fixes.length === 0;
    return r;
  });
  ok('speaker map modes (full / map only / off) round-trip', sc.modes);
  ok('helper model: every provider model + custom id, current kept selected', sc.select);
  ok('cost estimate per chapter follows mode and model price', sc.cost);
  ok('"map only" mode skips the gender-check AI call', sc.noCheck);
  ok('speaker map retries once when the model answers empty', sc.retry);

  // 16) คนที่ไม่รู้เพศ: เลี่ยงแบบธรรมชาติ ไม่เดา · แผนที่สั่งชัด · ตัวแก้ตัด ครับ/ผม เฉพาะบรรทัดที่รู้ว่าใครพูดแต่ไม่รู้เพศ
  const ug = await ev(async () => {
    const r = {};
    const w = { id: 'ug' + Date.now(), name: 'ug', glossary: [{ korean: '강도윤', thai: 'คังโดยุน', type: 'character', gender: 'male' }], customStyles: [], chapters: [], settings: { sourceLang: 'ko' }, createdAt: Date.now() };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const ws = S.currentWs;
    const p = buildTranslatePrompt({ sourceText: '의뢰인이 말했다. “제 동업자입니다.”', ws });
    r.rule = p.includes('(1) drop the subject') && p.includes('never add, cut or reshape content') && p.includes('A job title or role (client, manager, guard, opponent) is not a gender');
    r.mapPrompt = SPEAKER_MAP_PROMPT.includes('A job title or role alone') && SPEAKER_MAP_PROMPT.includes('Never guess');
    const map = [{ speaker: '의뢰인', gender: 'unknown', kind: 'dq', q: '제 동업자입니다.' }, { speaker: '나 (탐정)', gender: 'male', kind: 'dq', q: '누구입니까?' }, { speaker: '?', gender: 'unknown', kind: 'dq', q: '네.' }];
    const blk = speakerMapPromptBlock(map, ws);
    r.mapLine = blk.includes('gender unknown → NO ครับ/ค่ะ/คะ, NO ผม/ดิฉัน') && !/3RD-PERSON[^\n]*나/.test(blk);
    r.level = koSpeechLevel('네, 부장님. 계약이 취소되면서…') === 'polite';
    const out = applySpeakerFixes('“หุ้นส่วนของผมครับ ผมตามหามาสามวันแล้วครับ” “ใครครับ” “ครับ”', map, ws).text;
    r.fix = out === '“หุ้นส่วนของฉัน ตามหามาสามวันแล้ว” “ใครครับ” “ครับ”';
    r.clause = _neutralizeQuote('เป็นเคสที่ผมรับผิดชอบครับ') === 'เป็นเคสที่ตัวเองรับผิดชอบ' && _neutralizeQuote('ตัดผมมาใหม่เหรอคะ') === 'ตัดผมมาใหม่เหรอ' && _neutralizeQuote('ครับ!') === 'ครับ!';
    return r;
  });
  ok('unknown gender: prompt says drop subject / neutral word / no guessing / no reshaping', ug.rule && ug.mapPrompt);
  ok('speaker map: unknown-gender line forbids ครับ/ผม · narrator not listed as เขา · ~님 = polite', ug.mapLine && ug.level);
  ok('auto-fix strips ครับ/ผม only for an identified speaker of unknown gender (known & unidentified untouched)', ug.fix && ug.clause);

  // 17) สไตล์ → Bible · เรตผู้อ่าน · ธีมหน้าอ่านตามเครื่อง · แตะคำที่ไฮไลต์แล้วแก้ย้อนหลังได้ + ย้อนกลับ
  const rd = await ev(async () => {
    const r = {};
    const mkCh = (n, t) => ({ id: 'r' + n, chapterNum: n, title: '' + n, sourceText: 'x', translation: t, status: 'done' });
    const w = { id: 'rd' + Date.now(), name: 'rd', glossary: [{ korean: '화산', thai: 'ฮวาซาน', type: 'place' }, { korean: '화산파', thai: 'สำนักฮวาซาน', type: 'clan' }], presets: [],
      customStyles: [{ id: 'st1', name: 'ของฉัน', emoji: '🖊', prompt: 'บรรยายสั้น กระชับ' }],
      chapters: [mkCh(1, 'ฮวาซานสูงมาก สำนักฮวาซานอยู่บนนั้น'), mkCh(2, 'เขาไปฮวาซานอีกครั้ง'), mkCh(3, 'ฮวาซานยังเงียบ')],
      settings: { sourceLang: 'ko', activeStyleId: 'st1' }, createdAt: Date.now() };
    await lsSaveWorkspace(w); await selectWorkspace(w.id);
    const ws = S.currentWs;
    r.migrated = ws.styleSheet?.extra === 'บรรยายสั้น กระชับ' && ws.settings.styleMerged === true && !migrateStyleToBible(ws);
    let p = buildTranslatePrompt({ sourceText: '나는 웃었다.', ws });
    r.extra = p.includes('ADDITIONAL INSTRUCTIONS FROM THE TRANSLATOR:\nบรรยายสั้น กระชับ') && !p.includes('AUDIENCE RATING');
    ws.settings.ageRating = 'all'; p = buildTranslatePrompt({ sourceText: '나는 웃었다.', ws });
    r.rating = p.includes('AUDIENCE RATING — word choice only') && p.includes('no กู/มึง') && p.includes('never cut, summarize or skip content');
    ws.settings.ageRating = '18'; r.r18 = buildTranslatePrompt({ sourceText: '나는 웃었다.', ws }).includes('do not soften');
    r.noStyleUi = !document.getElementById('activeStyleSelect') && !document.querySelector('[data-tab="styles"]');
    // ธีม: ไม่เคยเลือก (บันทึก sepia ไว้แบบเก่า) → อัตโนมัติ · เลือกเองแล้วจำ
    ws.readerSettings = { theme: 'sepia', fontSize: 19 };
    r.autoTheme = readerGetSettings().theme === 'auto' && ['dark', 'sepia'].includes(readerResolvedTheme());
    readerSetTheme('dark'); reApplyTheme();
    r.chosen = readerGetSettings().theme === 'dark' && document.getElementById('reContent').classList.contains('reader-theme-dark');
    readerSetTheme('auto'); r.backAuto = readerGetSettings().theme === 'auto';
    // แก้คำ: ตอนนี้และก่อนหน้า (ตอน 2) → ตอน 1–2 เปลี่ยน · ตอน 3 ไม่แตะ · สำนักฮวาซาน ไม่แตะ
    r.replace = replaceGlossTerm('ฮวาซานสูง สำนักฮวาซาน ฮวาซาน', 'ฮวาซาน', 'หัวซาน', ws.glossary).n === 2;
    ws.readerSettings.glossaryHl = true; reState.chapterId = 'r2'; reState.mode = 'read'; switchTab('read'); reLoadChapter('r2');
    const mark = document.querySelector('#reContent mark.re-gloss');
    mark.click();
    const pop = document.getElementById('glossPop');
    r.pop = pop && pop.style.display === 'block' && pop.textContent.includes('화산') && pop.textContent.includes('พบในตอนนี้ 1 จุด') && pop.textContent.includes('สำนักฮวาซาน');
    document.getElementById('gpThai').value = 'หัวซาน';
    document.querySelector('input[name="gpScope"][value="prev"]').checked = true;
    const cf = window.confirm; window.confirm = () => true;
    await applyGlossPop();
    window.confirm = cf;
    const t = n => ws.chapters.find(c => c.chapterNum === n).translation;
    r.applied = ws.glossary[0].thai === 'หัวซาน' && t(1) === 'หัวซานสูงมาก สำนักฮวาซานอยู่บนนั้น' && t(2) === 'เขาไปหัวซานอีกครั้ง' && t(3) === 'ฮวาซานยังเงียบ';
    await undoGlossPop();
    r.undo = ws.glossary[0].thai === 'ฮวาซาน' && t(1) === 'ฮวาซานสูงมาก สำนักฮวาซานอยู่บนนั้น' && t(2) === 'เขาไปฮวาซานอีกครั้ง';
    return r;
  });
  ok('style system merged into Bible ("extra" field, migrated once) · style tab gone', rd.migrated && rd.extra && rd.noStyleUi);
  ok('age rating: word choice only, never cuts content', rd.rating && rd.r18);
  ok('reader theme follows the device by default, manual choice remembered, also in the reading tab', rd.autoTheme && rd.chosen && rd.backAuto);
  ok('tap highlighted term → source + edit, apply to this & earlier chapters, compounds untouched, undo', rd.replace && rd.pop && rd.applied && rd.undo);

  // 18) เรื่องปัจจุบันต้องไม่ถูกมองเป็นเรื่องโบราณ: "เข้า" ไม่ใช่ "ข้า" · แนวปัจจุบันที่ตั้งไว้ชนะการอนุมาน · ตอนที่เคยถูกแก้ผิดไม่ลากต่อ
  const md = await ev(async () => {
    const r = {};
    const enter = 'ฉันเดินเข้าไปในห้อง เข้าใจแล้ว เธอเข้าเรียนที่นี่ ทุกคนเข้าแถว '.repeat(6);
    const mk = async (st, trs) => { const w = { id: 'md' + Math.random(), name: 'md', glossary: [], customStyles: [], presets: [], chapters: trs.map((t, i) => ({ id: 'm' + i, chapterNum: i + 1, title: '' + (i + 1), sourceText: 'x', translation: t })), settings: { sourceLang: 'ko', ...st }, createdAt: Date.now() }; await lsSaveWorkspace(w); await selectWorkspace(w.id); return S.currentWs; };
    let ws = await mk({}, [enter, enter, enter]);
    r.enter = !archaicSpeechInfo(ws).sure && getNarratorSelf(ws) === 'ฉัน';
    ws = await mk({ genrePreset: 'ko-modern' }, ['“ข้าน้อยเข้าใจแล้วขอรับ” “ข้ารออยู่เจ้าค่ะ”\n'.repeat(8)]);
    r.modernWins = !archaicSpeechInfo(ws, '사부님 포권').on && applySpeakerFixes('“สวัสดีค่ะ ฉันชื่อเอเลีย”', null, ws).text === '“สวัสดีค่ะ ฉันชื่อเอเลีย”';
    ws = await mk({}, ['“สวัสดีเจ้าค่ะ” “ยินดีครับ” “ข้าชื่อเอเลียเจ้าค่ะ” “ผมชื่อฮายูลครับ” '.repeat(5)]);
    r.poisoned = !archaicSpeechInfo(ws).sure;
    return r;
  });
  ok('modern story never flagged archaic ("เข้า" ≠ "ข้า", modern genre wins, a mis-fixed chapter does not spread)', md.enter && md.modernWins && md.poisoned);

  ok('no page errors', errors.length === 0); if (errors.length) console.log(errors);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
