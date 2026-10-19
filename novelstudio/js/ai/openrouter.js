// ═══ openrouter.js — เรียก OpenRouter API: stream / retry / fallback / error ไทย ═══

import { S } from '../state.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function headers(key) {
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': location.origin,
    'X-Title': 'NovelStudio',
  };
}

async function httpError(res) {
  let msg = '';
  try {
    const err = await res.json();
    msg = err.error?.message || err.message || '';
  } catch { /* body ไม่ใช่ JSON */ }
  const s = res.status;
  if (s === 401 || s === 403) return new Error(`🔑 API Key ไม่ถูกต้องหรือหมดสิทธิ์${msg ? ` — ${msg}` : ''}`);
  if (s === 402) return new Error('💳 เครดิต OpenRouter หมด — เติมเงินก่อนใช้งาน');
  if (s === 429) {
    const retry = res.headers.get('retry-after');
    const e = new Error(`⏳ ติด Rate Limit${retry ? ` — รอ ${retry} วิ` : ''} แล้วลองใหม่`);
    e.retryable = true;
    return e;
  }
  if (s >= 500) {
    const e = new Error(`⚠ เซิร์ฟเวอร์มีปัญหา (HTTP ${s})`);
    e.retryable = true;
    return e;
  }
  return new Error(`HTTP ${s}${msg ? ` — ${msg}` : ''}`);
}

function networkError() {
  const e = new Error('🌐 เชื่อมต่อไม่ได้ — เช็คอินเทอร์เน็ตแล้วลองใหม่');
  e.retryable = true;
  return e;
}

// ── ยิงหนึ่งครั้ง (stream หรือไม่ก็ได้) ──
async function callOnce({ model, messages, temperature, maxTokens, stream, onChunk, signal }) {
  const key = S.settings.apiKey;
  if (!key) throw new Error('ยังไม่ได้ตั้ง OpenRouter API Key — ไปที่ ⚙ ตั้งค่า');

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
    usage: { include: true }, // ให้ OpenRouter ส่ง token + cost กลับมา
  };

  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: headers(key), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) throw await httpError(res);

  if (!stream) {
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: data.usage || null,
      model: data.model || model,
    };
  }

  // ── SSE stream (รูปแบบ OpenAI) ──
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', fullText = '', usage = null, streamed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue; // ข้าม comment/keep-alive
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') { reader.cancel().catch(() => {}); return { text: fullText, usage, model, streamed }; }
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }
        if (evt.error) throw new Error(evt.error.message || 'stream error');
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; streamed = true; onChunk?.(delta); }
        if (evt.usage) usage = evt.usage;
      }
    }
  } catch (e) {
    // มีข้อความ stream ออกไปแล้ว → ห้าม retry (จะได้ข้อความซ้ำ)
    if (streamed) e.streamedPartial = true;
    throw e;
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text: fullText, usage, model, streamed };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── ตัวเรียกหลัก: retry 2 ครั้งเมื่อ error ชั่วคราว → สลับ fallback model → โยน error ──
// คืน { text, usage, model, usedFallback }
export async function aiCall({ messages, temperature = 0.7, maxTokens = 2500, stream = false, onChunk, signal, onStatus }) {
  const primary = S.settings.model?.trim();
  const fallback = S.settings.fallbackModel?.trim();
  if (!primary) throw new Error('ยังไม่ได้เลือกโมเดล — ไปที่ ⚙ ตั้งค่า');

  const models = [primary];
  if (fallback && fallback !== primary) models.push(fallback);

  let lastErr = null;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const attempts = mi === 0 ? 3 : 1; // primary: ยิง 1 + retry 2 | fallback: ยิงครั้งเดียว
    for (let a = 0; a < attempts; a++) {
      try {
        if (a > 0) onStatus?.(`ลองใหม่ครั้งที่ ${a}…`);
        if (mi > 0) onStatus?.(`สลับไปโมเดลสำรอง ${model}…`);
        const r = await callOnce({ model, messages, temperature, maxTokens, stream, onChunk, signal });
        return { ...r, usedFallback: mi > 0 };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        // stream ที่มีข้อความออกมาแล้ว → retry ไม่ได้ (จะได้ข้อความซ้ำ) โยนเลย
        if (stream && e.streamedPartial) throw e;
        if (!e.retryable) break; // error ถาวร (key ผิด/เครดิตหมด) → ข้ามไป fallback เลย
        if (a < attempts - 1) await sleep(1200 * (a + 1));
      }
    }
  }
  throw lastErr || new Error('เรียก AI ไม่สำเร็จ');
}

// ── สรุปค่าใช้จ่ายเป็นข้อความ ──
export function usageText(usage, usedFallback, model) {
  if (!usage) return '';
  const inT = usage.prompt_tokens || 0;
  const outT = usage.completion_tokens || 0;
  const cost = usage.cost;
  const parts = [`in ${inT.toLocaleString()} / out ${outT.toLocaleString()} tok`];
  if (typeof cost === 'number') parts.unshift(`~$${cost.toFixed(5)}`);
  if (usedFallback) parts.push(`(โมเดลสำรอง${model ? `: ${model}` : ''})`);
  return parts.join(' · ');
}
