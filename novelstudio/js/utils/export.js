// ═══ export.js — Export/Import JSON (ทั้งแอพ หรือรายโปรเจกต์) ═══

import { dbListAll, dbListBy, dbBulkPut, dbClear, dbGet, STORES } from '../db.js';
import { S, saveSettings, now } from '../state.js';

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ── Export ทั้งแอพ ──
export async function exportAll() {
  const data = {
    app: 'novelstudio',
    kind: 'full',
    version: 1,
    exportedAt: now(),
    projects: await dbListAll('projects'),
    chapters: await dbListAll('chapters'),
    codex: await dbListAll('codex'),
    settings: { ...S.settings, apiKey: '' }, // ไม่ export API key
  };
  downloadJson(data, `novelstudio-backup-${stamp()}.json`);
  S.settings.lastBackupAt = now();
  saveSettings();
}

// ── Export รายโปรเจกต์ ──
export async function exportProject(projectId) {
  const project = await dbGet('projects', projectId);
  if (!project) throw new Error('ไม่พบโปรเจกต์');
  const data = {
    app: 'novelstudio',
    kind: 'project',
    version: 1,
    exportedAt: now(),
    projects: [project],
    chapters: await dbListBy('chapters', 'projectId', projectId),
    codex: await dbListBy('codex', 'projectId', projectId),
  };
  const safe = project.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'project';
  downloadJson(data, `novelstudio-${safe}-${stamp()}.json`);
}

// ── Import ──
// mode: 'merge' = ทับเฉพาะ record ที่ id ชนกัน | 'replace' = ล้างทั้งหมดก่อน (เฉพาะ backup ทั้งแอพ)
export async function importData(json, mode = 'merge') {
  if (!json || json.app !== 'novelstudio' || !Array.isArray(json.projects)) {
    throw new Error('ไฟล์ไม่ใช่ backup ของ NovelStudio');
  }
  if (mode === 'replace') {
    for (const s of STORES) await dbClear(s);
  }
  await dbBulkPut('projects', json.projects || []);
  await dbBulkPut('chapters', json.chapters || []);
  await dbBulkPut('codex', json.codex || []);
  if (mode === 'replace' && json.settings) {
    const keepKey = S.settings.apiKey; // เก็บ API key ของเครื่องนี้ไว้
    S.settings = { ...S.settings, ...json.settings, apiKey: keepKey || json.settings.apiKey || '' };
    saveSettings();
  }
  return {
    projects: (json.projects || []).length,
    chapters: (json.chapters || []).length,
    codex: (json.codex || []).length,
  };
}

export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => {
        try { resolve(JSON.parse(r.result)); }
        catch { reject(new Error('อ่านไฟล์ไม่ได้ — ไม่ใช่ JSON ที่ถูกต้อง')); }
      };
      r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
      r.readAsText(f);
    };
    inp.click();
  });
}

// export เนื้อหาเป็น .txt (ทั้งเรื่อง) — ของแถมสำหรับเอาไปลงเว็บ
export async function exportProjectTxt(projectId) {
  const project = await dbGet('projects', projectId);
  if (!project) throw new Error('ไม่พบโปรเจกต์');
  const chapters = (await dbListBy('chapters', 'projectId', projectId))
    .sort((a, b) => (a.number || 0) - (b.number || 0));
  const text = [
    project.title,
    project.synopsis ? `\n${project.synopsis}\n` : '',
    ...chapters.map(c => `\n\n═══ ตอนที่ ${c.number}: ${c.title || ''} ═══\n\n${c.content || ''}`),
  ].join('');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = project.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'novel';
  a.download = `${safe}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
