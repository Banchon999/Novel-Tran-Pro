// GET /api/models — โมเดลที่ Premium ใช้ได้ (แอดมินแก้ในหน้า admin) · รูปแบบเดียวกับ OpenAI /models
const { supabaseConfigured, restSelect, sendJson, sendError } = require('./_lib/common');

module.exports = async (req, res) => {
  if (!supabaseConfigured()) return sendError(res, 503, 'ระบบบัญชียังไม่ได้ตั้งค่า');
  try {
    const rows = await restSelect('app_config?id=eq.1&select=premium_models,default_model');
    const cfg = rows[0] || { premium_models: [], default_model: '' };
    const data = (cfg.premium_models || []).map(m => ({ id: m.id, name: m.name || m.id }));
    sendJson(res, 200, { data, default_model: cfg.default_model }, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
  } catch (e) {
    sendError(res, 502, 'โหลดรายการโมเดล Premium ไม่สำเร็จ');
  }
};
