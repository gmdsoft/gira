import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateHTML } from '@tiptap/html';
import { extensions } from './extensions.js';
import { api, hydrateDoc } from './api.js';
import Presentation from './Presentation.jsx';

export default function PageView({ pageId, navigate, reloadSpace }) {
  const [page, setPage] = useState(null);
  const [comments, setComments] = useState(null);
  const [error, setError] = useState(null);
  const [present, setPresent] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const loadComments = useCallback(() => {
    api(`/api/content/${pageId}/comments`).then(setComments).catch(() => setComments([]));
  }, [pageId]);

  useEffect(() => {
    setPage(null); setComments(null); setError(null); setPresent(false); setMoveOpen(false);
    api(`/api/content/${pageId}`)
      .then((p) => { setPage(p); document.title = `${p.title} - GMD Docs`; })
      .catch((e) => setError(String(e)));
    loadComments();
  }, [pageId, loadComments]);

  if (error) return <div className="page-error">불러오기 실패: {error}</div>;
  if (!page) return <div className="page-loading">불러오는 중…</div>;

  const setStatus = async (status, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const res = await fetch(`/api/content/${page.id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { alert('상태 변경 실패'); return; }
    reloadSpace?.();
    if (status === 'current') {
      const p = await api(`/api/content/${pageId}`);
      setPage(p);
    } else {
      navigate(`/s/${page.spaceKey}`);
    }
  };

  return (
    <article className={`page ${page.fullWidth ? 'page-full' : ''}`}>
      {page.status !== 'current' && (
        <div className="status-banner">
          이 페이지는 {page.status === 'archived' ? '보관됨' : '휴지통'} 상태입니다.
          <button className="btn" onClick={() => setStatus('current')}>복원</button>
        </div>
      )}
      <header className="page-header">
        <div className="page-title-row">
          <h1>{page.type === 'live' && <span className="live-badge">LIVE</span>}{page.title}</h1>
          <div className="page-actions">
            <button className="btn btn-primary"
              onClick={() => navigate(`/s/${page.spaceKey}/p/${page.id}/edit`)}>편집</button>
            <PageMenu page={page} navigate={navigate} reloadSpace={reloadSpace}
              onPresent={() => setPresent(true)} onMove={() => setMoveOpen(true)} setStatus={setStatus} />
          </div>
        </div>
        <div className="page-meta">
          {page.version?.author_name && <span>{page.version.author_name}</span>}
          {page.version?.created_at && <span>{new Date(page.version.created_at).toLocaleDateString('ko-KR')}</span>}
          <a className="version-link" href={`/s/${page.spaceKey}/p/${page.id}/history`}
             onClick={(e) => { e.preventDefault(); navigate(`/s/${page.spaceKey}/p/${page.id}/history`); }}>
            v{page.version?.version} · 버전 기록
          </a>
          {page.version?.source_editor === 'legacy' && <span className="legacy-badge">레거시</span>}
        </div>
        <LabelEditor page={page} onChange={(labels) => setPage({ ...page, labels })} />
      </header>
      <Doc doc={page.version?.doc} pageId={page.id} />
      {isEmptyDoc(page.version?.doc) && page.children?.length > 0 && (
        <section className="children-list">
          <h2>하위 페이지</h2>
          <ul>
            {page.children.map((ch) => (
              <li key={ch.id}>
                <a href={`/s/${page.spaceKey}/p/${ch.id}`}
                   onClick={(e) => { e.preventDefault(); navigate(`/s/${page.spaceKey}/p/${ch.id}`); }}>
                  {ch.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="comments">
        {comments?.filter((c) => c.kind === 'footer').length > 0 && <h2>댓글</h2>}
        {comments?.filter((c) => c.kind === 'footer').map((c) => (
          <Comment key={c.id} comment={c} pageId={page.id} />
        ))}
        <CommentForm pageId={page.id} onAdded={loadComments} />
      </section>
      {present && <Presentation page={page} onClose={() => setPresent(false)} />}
      {moveOpen && <MoveDialog page={page} navigate={navigate} reloadSpace={reloadSpace}
        onClose={() => setMoveOpen(false)} />}
    </article>
  );
}

// ⋯ 메뉴: 프레젠테이션, 링크 복사, 복사본, 이동, 보관, 휴지통
function PageMenu({ page, navigate, reloadSpace, onPresent, onMove, setStatus }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${page.spaceKey}/p/${page.id}`);
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 800);
    } catch { alert('클립보드 복사에 실패했습니다'); }
  };

  const makeCopy = async () => {
    setOpen(false);
    const res = await fetch(`/api/content/${page.id}/copy`, { method: 'POST' });
    if (!res.ok) { alert('복사 실패'); return; }
    const { id, spaceKey } = await res.json();
    reloadSpace?.();
    navigate(`/s/${spaceKey}/p/${id}`);
  };

  return (
    <div className="menu-wrap">
      <button className="btn" title="더 보기" onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && <>
        <div className="menu-overlay" onClick={() => setOpen(false)} />
        <div className="page-menu">
          <button onClick={() => { setOpen(false); onPresent(); }}>▶ 프레젠테이션</button>
          <button onClick={copyLink}>{copied ? '✓ 복사됨' : '🔗 링크 복사'}</button>
          <hr />
          <button onClick={() => { setOpen(false); navigate(`/s/${page.spaceKey}/p/${page.id}/history`); }}>🕘 버전 기록</button>
          <button onClick={makeCopy}>📄 복사본 만들기</button>
          <button onClick={() => { setOpen(false); onMove(); }}>→ 이동</button>
          <hr />
          <button onClick={() => { setOpen(false); setStatus('archived', `"${page.title}"${page.children?.length ? '과 하위 페이지를' : '을(를)'} 보관할까요?\n보관된 페이지는 트리와 검색에서 빠지고, 보관함에서 복원할 수 있습니다.`); }}>🗂 보관</button>
          <button className="menu-danger" onClick={() => { setOpen(false); setStatus('trashed', `"${page.title}"${page.children?.length ? '과 하위 페이지를' : '을(를)'} 휴지통으로 옮길까요?`); }}>🗑 휴지통으로 이동</button>
        </div>
      </>}
    </div>
  );
}

// 레이블 보기 + 추가/삭제
function LabelEditor({ page, onChange }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const call = async (body) => {
    const res = await fetch(`/api/content/${page.id}/labels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onChange((await res.json()).labels);
  };

  return (
    <div className="labels">
      {page.labels.map((l) => (
        <span key={l} className="label">{l}
          <button className="label-x" title="레이블 삭제" onClick={() => call({ remove: [l] })}>×</button>
        </span>
      ))}
      {adding ? (
        <input className="label-input" autoFocus value={value} placeholder="레이블 입력 후 Enter"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { setAdding(false); setValue(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) { call({ add: [value.trim()] }); setValue(''); }
            if (e.key === 'Escape') { setAdding(false); setValue(''); }
          }} />
      ) : (
        <button className="label-add" onClick={() => setAdding(true)}>+ 레이블</button>
      )}
    </div>
  );
}

// 이동 대화상자: 스페이스 선택 + 제목 검색으로 새 부모 지정
function MoveDialog({ page, navigate, reloadSpace, onClose }) {
  const [spaces, setSpaces] = useState([]);
  const [spaceKey, setSpaceKey] = useState(page.spaceKey);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(undefined); // undefined=미선택, null=스페이스 최상위, {id,title}=부모 페이지

  useEffect(() => { api('/api/spaces').then(setSpaces).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api(`/api/pages?space=${encodeURIComponent(spaceKey)}&q=${encodeURIComponent(q)}`)
        .then((rows) => setResults(rows.filter((r) => r.id !== Number(page.id))))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [spaceKey, q, page.id]);

  const move = async () => {
    const res = await fetch(`/api/content/${page.id}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target ? { parentId: target.id } : { spaceKey }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '이동 실패'); return; }
    const { spaceKey: destKey } = await res.json();
    onClose();
    reloadSpace?.();
    navigate(`/s/${destKey}/p/${page.id}`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>페이지 이동</h2>
        <p className="muted">"{page.title}" (하위 페이지 포함) 을 옮길 위치를 선택하세요.</p>
        <label className="modal-field">스페이스
          <select value={spaceKey} onChange={(e) => { setSpaceKey(e.target.value); setTarget(undefined); }}>
            {spaces.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
          </select>
        </label>
        <label className="modal-field">새 상위 페이지
          <input value={q} placeholder="제목으로 검색" onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="move-results">
          <button className={`move-row ${target === null ? 'selected' : ''}`} onClick={() => setTarget(null)}>
            📁 (스페이스 최상위)
          </button>
          {results.map((r) => (
            <button key={r.id} className={`move-row ${target?.id === r.id ? 'selected' : ''}`}
              onClick={() => setTarget(r)}>
              {r.type === 'folder' ? '📁' : '📄'} {r.title}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" disabled={target === undefined} onClick={move}>이동</button>
        </div>
      </div>
    </div>
  );
}

function CommentForm({ pageId, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/content/${pageId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) { alert('댓글 등록 실패'); return; }
      setText('');
      onAdded();
    } finally { setBusy(false); }
  };
  return (
    <div className="comment-form">
      <textarea value={text} rows={2} placeholder="댓글 추가…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
      {text.trim() && (
        <div className="comment-form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={submit}>등록</button>
          <span className="muted">Ctrl+Enter로 등록</span>
        </div>
      )}
    </div>
  );
}

function isEmptyDoc(doc) {
  if (!doc?.content?.length) return true;
  return doc.content.every((n) => n.type === 'paragraph' && !(n.content?.length));
}

function Doc({ doc, pageId }) {
  const content = useMemo(() => doc ? hydrateDoc(structuredClone(doc), pageId) : null, [doc, pageId]);
  const editor = useEditor({ extensions, content, editable: false }, [content]);
  if (!doc) return <div className="muted">본문이 없습니다.</div>;
  return <EditorContent editor={editor} className="doc" />;
}

function Comment({ comment, pageId }) {
  const html = useMemo(() => {
    if (!comment.doc) return '';
    try { return generateHTML(hydrateDoc(structuredClone(comment.doc), pageId), extensions); }
    catch { return '<em>(렌더링 불가)</em>'; }
  }, [comment, pageId]);
  return (
    <div className="comment">
      <div className="comment-meta">
        <strong>{comment.author_name ?? '(알 수 없음)'}</strong>
        {comment.created_at && <span className="muted"> · {new Date(comment.created_at).toLocaleString('ko-KR')}</span>}
      </div>
      <div className="comment-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
