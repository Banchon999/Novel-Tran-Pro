// ทดสอบตัวตรวจเพศหลังแปล (genderProofread) ด้วยเคสใน proofread-cases.json — ไม่ต้องเปิดแอป/ไม่ต้องแปลใหม่ (ถูก ~$0.005/รอบ)
//   node tests/gender/run-proofread.js [รอบ=1]      GPM=<model> เปลี่ยนโมเดลตรวจ (ค่าเริ่มต้นตามแอป)
const fs = require('fs'), vm = require('vm'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..'), OUT = __dirname + '/out';
fs.mkdirSync(OUT, { recursive: true });
const ctx = { console, setTimeout, clearTimeout, S: {}, location: { origin: '' }, localStorage: { getItem: () => null },
  document: { getElementById: () => null, addEventListener() {}, querySelector: () => null }, window: { addEventListener() {} } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['app.core', 'app.providers', 'app.translate'])
  vm.runInContext(fs.readFileSync(`${ROOT}/js/${f}.js`, 'utf8').replace(/^(const|let) /gm, 'var '), ctx);
ctx.callOpenRouter = async body => {
  const f = `${OUT}/pr-${process.pid}.json`;
  fs.writeFileSync(f, JSON.stringify(body));
  const args = ['-sS', '--max-time', '300', '-X', 'POST', 'https://openrouter.ai/api/v1/chat/completions', '-H', 'Content-Type: application/json', '--data-binary', '@' + f];
  if (process.env.OPENROUTER_API_KEY) args.push('-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY);
  return JSON.parse(execFileSync('curl', args, { maxBuffer: 5e7 }));
};
const C = JSON.parse(fs.readFileSync(__dirname + '/proofread-cases.json', 'utf8'));
(async () => {
  const rounds = +(process.argv[2] || 1);
  const ws = { settings: process.env.GPM ? { proofreadModel: process.env.GPM } : {}, glossary: C.glossary };
  ctx.S.currentWs = ws;
  let pass = 0, total = 0;
  for (let r = 1; r <= rounds; r++) for (const c of C.cases) {
    const gp = await ctx.genderProofread(c.korean.join('\n\n'), c.thai.join('\n\n'), 'google/gemini-3.1-flash-lite', ws);
    const out = gp.text.split('\n').filter(x => x.trim());
    const fails = [];
    for (const e of c.expect.fix || []) { const p = out[e.para] || ''; if (!p.includes(e.want) || (e.bad && p.includes(e.bad) && !e.want.includes(e.bad))) fails.push(`ไม่ได้แก้ย่อหน้า ${e.para}: ${p}`); }
    for (const k of c.expect.keep || []) if (out[k] !== c.thai[k]) fails.push(`แก้มั่วย่อหน้า ${k}: ${out[k]}`);
    total++; if (!fails.length) pass++;
    console.log(`${fails.length ? '✗' : '✓'} [รอบ ${r}] ${c.id} — ${c.desc}${fails.map(f => '\n     ' + f).join('')}`);
  }
  console.log(`\nผ่าน ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
})();
