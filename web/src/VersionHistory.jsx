import DatabaseView from './DatabaseView.jsx';
import React, { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { extensions } from './extensions.js';
import { api, hydrateDoc } from './api.js';
import { hydrateMacros } from './macros.js';
import { diffDocs } from './diff.js';

export default function VersionHistory({ pageId, spaceKey, navigate }) {
  const [page, setPage] = useState(null);
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [mode, setMode] = useState('single'); // single | side | diff

  useEffect(() => {
    api(`/api/content/${pageId}`).then((p) => { setPage(p); setSelected(p.version?.version); });
    api(`/api/content/${pageId}/versions`).then(setVersions);
  }, [pageId]);

  useEffect(() => {
    if (!selected) return;
    api(`/api/content/${pageId}/versions/${selected}`).then(setSelectedDoc).catch(() => setSelectedDoc(null));
  }, [pageId, selected]);

  if (!page || !versions) return <div className="page-loading">불러오는 중…</div>;
  const current = page.version?.version;

  const restore = async () => {
    if (!confirm(`v${selected} 내용을 새 버전으로 복원할까요?`)) return;
    const res = await fetch(`/api/content/${pageId}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: selected }),
    });
    if (!res.ok) { alert('복원 실패'); return; }
    navigate(`/s/${spaceKey}/p/${pageId}`);
  };

  return (
    <div className="history">
      <div className="history-main">
        <div className="history-head">
          <h1>{page.title} <span className="muted">— 버전 기록</span></h1>
          <div className="editor-actions">
            {page.type !== 'database' && selected !== current && (
              <select className="mode-select" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="single">선택 버전 보기</option>
                <option value="side">현재와 나란히 비교</option>
                <option value="diff">변경 내용 (텍스트)</option>
              </select>
            )}
            {page.type !== 'database' && selected !== current && <button className="btn btn-primary" onClick={restore}>v{selected} 복원</button>}
            <button className="btn" onClick={() => navigate(`/s/${spaceKey}/p/${pageId}`)}>닫기</button>
          </div>
        </div>
        {mode === 'diff' && selected !== current ? (
          <DiffView oldDoc={selectedDoc?.doc} newDoc={page.version?.doc} oldV={selected} newV={current} />
        ) : (
          <div className={`history-body ${mode === 'side' && selected !== current ? 'history-compare' : ''}`}>
            <div className="history-pane">
              <div className="pane-label">v{selected}{selected === current && ' (현재)'}
                {selectedDoc && <span className="muted"> · {selectedDoc.author_name ?? ''} {selectedDoc.created_at ? new Date(selectedDoc.created_at).toLocaleString('ko-KR') : ''}</span>}
              </div>
              {page.type === 'database' && selectedDoc?.data ? <DatabaseView key={selected} page={{...page,canEdit:false,data:selectedDoc.data}} /> : selectedDoc?.doc
                ? <RenderDoc doc={selectedDoc.doc} pageId={pageId} page={page} navigate={navigate} />
                : <p className="muted">이 버전의 본문이 없습니다.</p>}
            </div>
            {mode === 'side' && page.type !== 'database' && selected !== current && (
              <div className="history-pane">
                <div className="pane-label">v{current} (현재)</div>
                {page.version?.doc && <RenderDoc doc={page.version.doc} pageId={pageId} page={page} navigate={navigate} />}
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="history-list">
        <h2>버전 ({versions.length})</h2>
        {versions.map((v) => (
          <button key={v.version}
            className={`version-row ${v.version === selected ? 'current' : ''}`}
            onClick={() => setSelected(v.version)}>
            <strong>v{v.version}</strong>
            {v.version === current && <span className="status status-green">현재</span>}
            {v.migrated && <span className="legacy-badge">이관</span>}
            <div className="muted">
              {v.author_name ?? '(알 수 없음)'}<br />
              {v.created_at ? new Date(v.created_at).toLocaleString('ko-KR') : ''}
              {v.message && <><br />“{v.message}”</>}
            </div>
          </button>
        ))}
      </aside>
    </div>
  );
}

// 텍스트 변경 내용 보기: 블록 단위 diff + 변경 블록은 단어 하이라이트
function DiffView({ oldDoc, newDoc, oldV, newV }) {
  const rows = React.useMemo(() => diffDocs(oldDoc, newDoc), [oldDoc, newDoc]);
  const changed = rows.filter((r) => r.op !== 'same').length;
  // 긴 무변경 구간은 접는다 (변경 블록 앞뒤 1블록만 남김)
  const visible = [];
  rows.forEach((r, idx) => {
    const nearChange = r.op !== 'same'
      || (idx > 0 && rows[idx - 1].op !== 'same')
      || (idx < rows.length - 1 && rows[idx + 1].op !== 'same');
    if (nearChange) visible.push({ ...r, key: idx });
    else if (visible[visible.length - 1]?.op !== 'skip') visible.push({ op: 'skip', key: idx });
  });
  return (
    <div className="diff-view">
      <p className="muted">v{oldV} → v{newV}: 변경 블록 {changed}개 (텍스트 기준, 서식 변경은 표시되지 않음)</p>
      {changed === 0 && <p className="muted">텍스트 변경이 없습니다.</p>}
      {visible.map((r) => {
        if (r.op === 'skip') return <div key={r.key} className="diff-skip">⋯</div>;
        return (
          <div key={r.key} className={`diff-line diff-${r.op}`}>
            {r.kind && <span className="diff-kind">{r.kind}</span>}
            {r.op === 'mod'
              ? r.words.map((w, i) =>
                  w.op === 'same' ? <span key={i}>{w.t}</span>
                  : w.op === 'del' ? <del key={i}>{w.t}</del>
                  : <ins key={i}>{w.t}</ins>)
              : r.text}
          </div>
        );
      })}
    </div>
  );
}

function RenderDoc({ doc, pageId, page, navigate }) {
  const content = React.useMemo(() => hydrateDoc(structuredClone(doc), pageId), [doc, pageId]);
  const editor = useEditor({ extensions, content, editable: false }, [content]);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!editor || !page) return;
    const t = setTimeout(() => hydrateMacros(ref.current, { page, navigate }), 80);
    return () => clearTimeout(t);
  }, [editor, content, page, navigate]);
  return <div ref={ref}><EditorContent editor={editor} className="doc" /></div>;
}
