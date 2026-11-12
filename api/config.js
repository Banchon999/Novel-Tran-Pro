// GET /api/config — ค่าที่หน้าเว็บต้องใช้ (ค่าสาธารณะเท่านั้น: anon key เปิดเผยได้ สิทธิ์คุมด้วย RLS)
const { env, sendJson } = require('./_lib/common');

module.exports = (req, res) => {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  sendJson(res, 200, {
    accounts: !!(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
    googleClientId: env('GOOGLE_CLIENT_ID'),
    premiumAI: !!env('OPENROUTER_API_KEY'),
  }, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
};
