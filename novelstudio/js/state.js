// ═══ state.js — global state + event bus (pub/sub) + settings ═══

import { dbGet, dbPut, dbListAll, dbListBy } from './db.js';

const SETTINGS_KEY = 'ns_settings';

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'anthropic/claude-sonnet-4.5',
  fallbackModel: 'google/gemini-2.5-flash',
  theme: 'dark',
  lastProjectId: '',
  lastChapterByProject: {},   // { projectId: chapterId }
  maxContextChars: 8000,      // budget ชั้น WORLD CONTEXT + STORY MEMORY
  memoryDepth: 5,             // แนบสรุปกี่ตอนล่าสุด
  editorFontSize: 18,
  genrePrompts: {},           // override system prompt ต่อแนวเรื่อง
  lastBackupAt: 0,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ── global state ──
export const S = {
  route: 'projects',          // projects | write | codex | timeline | settings
  allProjects: [],
  project: null,
  chapters: [],               // ของโปรเจกต์ปัจจุบัน เรียงตาม number
  codex: [],                  // ของโปรเจกต์ปัจจุบัน
  chapterId: null,
  settings: loadSettings(),
};

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings));
}

// ── event bus ──
const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}

export function emit(evt, data) {
  (listeners.get(evt) || []).forEach(fn => {
    try { fn(data); } catch (e) { console.error(`[bus:${evt}]`, e); }
  });
}

// ── helpers ──
export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function now() { return Date.now(); }

const sortByNumber = (a, b) => (a.number || 0) - (b.number || 0);

// ── data access (โหลดเข้า state + แจ้ง event) ──
export async function refreshProjects() {
  S.allProjects = (await dbListAll('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  emit('projects-changed');
  return S.allProjects;
}

export async function openProject(id) {
  const p = await dbGet('projects', id);
  if (!p) return null;
  if (!S.allProjects.some(x => x.id === id)) await refreshProjects();
  S.project = p;
  S.chapters = (await dbListBy('chapters', 'projectId', id)).sort(sortByNumber);
  S.codex = (await dbListBy('codex', 'projectId', id)).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  S.settings.lastProjectId = id;
  S.chapterId = S.settings.lastChapterByProject[id] || null;
  if (S.chapterId && !S.chapters.find(c => c.id === S.chapterId)) S.chapterId = null;
  if (!S.chapterId && S.chapters.length) S.chapterId = S.chapters[S.chapters.length - 1].id;
  saveSettings();
  emit('project-open', p);
  return p;
}

export function closeProject() {
  S.project = null;
  S.chapters = [];
  S.codex = [];
  S.chapterId = null;
}

export async function refreshChapters() {
  if (!S.project) return;
  S.chapters = (await dbListBy('chapters', 'projectId', S.project.id)).sort(sortByNumber);
  emit('chapters-changed');
}

export async function refreshCodex() {
  if (!S.project) return;
  S.codex = (await dbListBy('codex', 'projectId', S.project.id)).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  emit('codex-changed');
}

export function currentChapter() {
  return S.chapters.find(c => c.id === S.chapterId) || null;
}

export async function selectChapter(id) {
  S.chapterId = id;
  if (S.project) {
    S.settings.lastChapterByProject[S.project.id] = id;
    saveSettings();
  }
  emit('chapter-selected', id);
}

export async function saveChapter(ch) {
  ch.updatedAt = now();
  await dbPut('chapters', ch);
  const i = S.chapters.findIndex(c => c.id === ch.id);
  if (i >= 0) S.chapters[i] = ch; else { S.chapters.push(ch); S.chapters.sort(sortByNumber); }
  return ch;
}

export async function saveProject(p) {
  p.updatedAt = now();
  await dbPut('projects', p);
  if (S.project?.id === p.id) S.project = p;
  return p;
}

export async function saveCodexEntry(e) {
  e.updatedAt = now();
  await dbPut('codex', e);
  await refreshCodex();
  return e;
}
