// ─── ReadRealm Auto Poster integration ───
// Embeds the ReadRealm Auto Poster (readrealm.html) as a tab and bridges the
// current workspace's translated chapters into it via postMessage — so finished
// translations can be posted to readrealm.co without any export/import step.
//
// The poster runs inside a same-origin iframe to keep its globals/CSS fully
// isolated from NovelTrans (both use names like `chapters`, `log`, `.tab`, etc.).

const RR = (function () {
  let listenerBound = false;

  function frameWindow() {
    const f = document.getElementById('rrFrame');
    return f ? f.contentWindow : null;
  }

  // Collect the current workspace's chapters in a poster-friendly shape.
  function collectChapters() {
    const list = (S.currentWs?.chapters || []).slice()
      .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
    return list.map(ch => ({
      title: ch.title || '',
      content: ch.translation || '',
      chapterNum: ch.chapterNum ?? null,
      status: ch.status || (ch.translation ? 'translated' : 'pending'),
    }));
  }

  function sendChapters() {
    const w = frameWindow();
    if (!w) return;
    w.postMessage({
      type: 'NT_CHAPTERS',
      wsName: S.currentWs?.name || '-',
      chapters: collectChapters(),
    }, '*');
  }

  function bindListener() {
    if (listenerBound) return;
    listenerBound = true;
    window.addEventListener('message', e => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      // Poster announces it is ready, or explicitly requests a refresh.
      if (d.type === 'RR_READY' || d.type === 'RR_REQUEST_CHAPTERS') {
        sendChapters();
      }
    });
  }

  // Called by switchTab() → renderCurrentTab() each time the tab is shown.
  function render() {
    const host = document.getElementById('tab-readrealm');
    if (!host) return;
    bindListener();
    if (!document.getElementById('rrFrame')) {
      host.innerHTML =
        '<iframe id="rrFrame" src="readrealm.html" title="ReadRealm Auto Poster" ' +
        'style="width:100%;height:calc(100vh - 120px);min-height:600px;border:0;' +
        'border-radius:12px;background:#0a0a0f"></iframe>';
    } else {
      // Already mounted — just push the latest chapters (workspace may have changed).
      sendChapters();
    }
  }

  return { render, sendChapters };
})();
