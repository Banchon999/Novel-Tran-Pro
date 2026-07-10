// ═══ db.js — IndexedDB wrapper เล็กๆ (get/put/delete/list) ═══
// stores: projects, chapters (index projectId), codex (index projectId)

const DB_NAME = 'novelstudio';
const DB_VER = 1;
export const STORES = ['projects', 'chapters', 'codex'];

let _dbp = null;

export function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chapters')) {
        db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('codex')) {
        db.createObjectStore('codex', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDB();
  const t = db.transaction(name, mode);
  const result = await fn(t.objectStore(name));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const dbGet = (store, id) => withStore(store, 'readonly', s => reqP(s.get(id)));
export const dbPut = (store, obj) => withStore(store, 'readwrite', s => reqP(s.put(obj)));
export const dbDel = (store, id) => withStore(store, 'readwrite', s => reqP(s.delete(id)));
export const dbClear = (store) => withStore(store, 'readwrite', s => reqP(s.clear()));
export const dbListAll = (store) => withStore(store, 'readonly', s => reqP(s.getAll()));

export const dbListBy = (store, index, value) =>
  withStore(store, 'readonly', s => reqP(s.index(index).getAll(value)));

export const dbBulkPut = (store, objs) =>
  withStore(store, 'readwrite', s => Promise.all(objs.map(o => reqP(s.put(o)))));

export const dbBulkDel = (store, ids) =>
  withStore(store, 'readwrite', s => Promise.all(ids.map(id => reqP(s.delete(id)))));
