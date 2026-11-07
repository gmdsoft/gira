import WhiteboardView from './WhiteboardView.jsx';
import DatabaseView from './DatabaseView.jsx';
import { useMobile } from './mobile.js';
import CommentComposer from './comment-composer.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateHTML } from '@tiptap/html';
import { linkifyDoc } from '../../server/src/linkify.mjs'; // 댓글 속 주소 → 링크 (서버와 같은 규칙)
import { extensions } from './extensions.js';
import { api, hydrateDoc } from './api.js';
import { hydrateMacros } from './macros.js';
import Presentation from './Presentation.jsx';
import MoveDialog from './MoveDialog.jsx';
import { RestrictionsModal } from './access.jsx';
import { useEditPresence, EditingBadge } from './edit-presence.jsx';

// 본문 텍스트 노드를 이어 붙여 needle을 찾아 Range로 반환 (서식으로 쪼개진 노드도 매칭)
function findTextRange(root, needle, from = 0) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let full = '';
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: full.length });
    full += walker.currentNode.textContent;
  }
  const idx = full.indexOf(needle, from);
  if (idx < 0) return null;
  const end = idx + needle.length;
  const range = document.createRange();
  for (const { node, start } of nodes) {
    const len = node.textContent.length;
    if (idx >= start && idx < start + len) range.setStart(node, idx - start);
    if (end > start && end <= start + len) { range.setEnd(node, end - start); break; }
  }
  return range.collapsed ? null : { range, end };
}

const refLines = (ref) => ref.split('\n').map((s) => s.trim()).filter((s) => s.length >= 2);

// inline_ref의 각 줄을 차례로 찾아 하이라이트 span으로 감싼다 — 여러 문단 선택은 줄마다 하나씩,
// 전 구간이 칠해진다. 감싸면 노드가 쪼개지므로 줄마다 재탐색한다 (텍스트 오프셋은 유지됨)
function wrapRefMarks(root, ref) {
  const spans = [];
  let from = 0;
  for (const line of refLines(ref)) {
    const hit = findTextRange(root, line, from);
    if (!hit) continue;
    from = hit.end;
    const span = document.createElement('span');
    span.className = 'comment-mark';
    try {
      hit.range.surroundContents(span);
      spans.push(span);
    } catch {
      // 노드 경계에 걸치면 내용을 꺼내 span에 담아 되넣는다
      try { span.appendChild(hit.range.extractContents()); hit.range.insertNode(span); spans.push(span); } catch { /* 표시 생략 */ }
    }
  }
  return spans;
}

export default function PageView({ pageId, navigate, reloadSpace }) {
  const mobile = useMobile();
  const [page, setPage] = useState(null);
  const editors = useEditPresence(pageId); // 다른 사람이 편집 중인지 (30초마다 조회)
  const [comments, setComments] = useState(null);
  const [error, setError] = useState(null);
  const [present, setPresent] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [selPop, setSelPop] = useState(null); // {x, y, text, open} 본문 선택 → 인라인 댓글

  const loadComments = useCallback(() => {
    api(`/api/content/${pageId}/comments`).then(setComments).catch(() => setComments([]));
  }, [pageId]);

  useEffect(() => {
    setPage(null); setComments(null); setError(null); setPresent(false); setMoveOpen(false);
    api(`/api/content/${pageId}`)
      .then((p) => {
        setPage(p); document.title = `${p.title} - Gonfluence`;
        // 홈 '다시 시작하기' 카드용 최근 방문 기록 (이 브라우저에만 저장)
        try {
          const prev = JSON.parse(localStorage.getItem('gonf.recent') ?? '[]');
          const next = [{ id: p.id, title: p.title, spaceKey: p.space_key, spaceName: p.space_name, at: Date.now() },
            ...prev.filter((r) => String(r.id) !== String(p.id))].slice(0, 8);
          localStorage.setItem('gonf.recent', JSON.stringify(next));
        } catch { /* 무시 */ }
      })
      .catch((e) => setError(String(e)));
    loadComments();
  }, [pageId, loadComments]);

  // 선택 팝업(아직 안 연 상태)은 스크롤하면 숨긴다 — fixed 좌표가 본문과 어긋나 떠다니지 않도록
  useEffect(() => {
    const onScroll = () => setSelPop((p) => (p && !p.open ? null : p));
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  // 저장된 인라인 댓글을 본문에 영구 표시: 해당 텍스트를 하이라이트하고 클릭하면 댓글로 이동
  useEffect(() => {
    if (!page || !comments) return;
    const t = setTimeout(() => {
      const doc = document.querySelector('.doc');
      if (!doc) return;
      for (const c of comments.filter((x) => x.kind === 'inline' && x.inline_ref && !x.resolved)) {
        if (doc.querySelector(`[data-inline-anchor="${c.id}"]`)) continue;
        let els = [];
        try {
          const m = doc.querySelector(`.comment-mark[data-ref="${CSS.escape(c.inline_ref)}"]`);
          if (m) els = [m];
        } catch { /* 선택자 불가 문자 */ }
        if (!els.length) els = wrapRefMarks(doc, c.inline_ref);
        for (const el of els) {
          el.dataset.inlineAnchor = c.id;
          el.title = '인라인 댓글 보기';
          el.style.cursor = 'pointer';
          // mousedown에서 가로채 ProseMirror 선택 처리(분할된 텍스트 노드에서 오류)를 막는다
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const item = document.querySelector(`[data-comment-item="${c.id}"]`);
            if (!item) return;
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.classList.add('inline-flash');
            setTimeout(() => item.classList.remove('inline-flash'), 1800);
          });
        }
      }
    }, 200);
    return () => clearTimeout(t);
  }, [page, comments]);

  if (error) return <div className="page-error">불러오기 실패: {error}</div>;
  if (!page) return <div className="page-loading">불러오는 중…</div>;

  if (page.type === 'whiteboard') return <WhiteboardView key={page.id} page={page} />;
  if (page.type === 'database') return <DatabaseView key={page.id} page={page} />;

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

  const onMouseUp = () => {
    if (selPop?.open) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelPop(null); return; }
    const text = sel.toString().trim();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const inDoc = range && (range.commonAncestorContainer.parentElement ?? range.commonAncestorContainer)?.closest?.('.doc');
    if (!text || text.length < 2 || !inDoc) { setSelPop(null); return; }
    const rect = range.getBoundingClientRect();
    setSelPop({ x: rect.left + rect.width / 2, y: rect.top, text, open: false });
  };

  return (
    <article className={`page ${page.fullWidth ? 'page-full' : ''}`} onMouseUp={mobile ? undefined : onMouseUp}>
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
            {page.type === 'embed'
              ? <span className="muted" title="원본 Confluence의 스마트 링크 임베드 — 주소만 이관됨">읽기 전용 임베드</span>
              : <button className="btn btn-primary"
                  onClick={() => navigate(`/s/${page.spaceKey}/p/${page.id}/edit`)}>편집</button>}
            <PageMenu page={page} navigate={navigate} reloadSpace={reloadSpace}
              onPresent={() => setPresent(true)} onMove={() => setMoveOpen(true)}
              onRestrict={() => setRestrictOpen(true)} setStatus={setStatus} />
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
          <EditingBadge editors={editors} />
        </div>
        <LabelEditor page={page} onChange={(labels) => setPage({ ...page, labels })} />
      </header>
      <Doc page={page} navigate={navigate} />
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
      <InlineComments comments={comments} pageId={page.id} onChanged={loadComments} />
      <section className="comments">
        {comments?.filter((c) => c.kind === 'footer').length > 0 && <h2>댓글</h2>}
        {comments?.filter((c) => c.kind === 'footer').map((c) => (
          <Comment key={c.id} comment={c} pageId={page.id} />
        ))}
        {!mobile && <CommentForm pageId={page.id} onAdded={loadComments} />}
      </section>
      {!mobile && selPop && <InlineCommentPopup pop={selPop} setPop={setSelPop} pageId={page.id}
        onAdded={() => { setSelPop(null); loadComments(); }} />}
      {!mobile && present && <Presentation page={page} onClose={() => setPresent(false)} />}
      {!mobile && moveOpen && <MoveDialog page={page} navigate={navigate} reloadSpace={reloadSpace}
        onClose={() => setMoveOpen(false)} />}
      {!mobile && restrictOpen && <RestrictionsModal pageId={page.id} onClose={() => setRestrictOpen(false)} />}
    </article>
  );
}

// ⋯ 메뉴: 프레젠테이션, 링크 복사, 복사본, 이동, 보관, 휴지통
function PageMenu({ page, navigate, reloadSpace, onPresent, onMove, onRestrict, setStatus }) {
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
          <button onClick={() => { setOpen(false); onRestrict(); }}>🔒 접근 제한</button>
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
// 본문 텍스트 선택 시 뜨는 인라인 댓글 팝업
function InlineCommentPopup({ pop, setPop, pageId, onAdded }) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    const res = await fetch(`/api/content/${pageId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'inline', inlineRef: pop.text.slice(0, 300), text: text.trim() }),
    });
    if (!res.ok) { alert('댓글 등록 실패'); return; }
    onAdded();
  };
  const style = { left: Math.max(8, pop.x - (pop.open ? 160 : 40)), top: Math.max(8, pop.y - (pop.open ? 120 : 40)) };
  if (!pop.open) {
    return (
      <button className="sel-comment-btn" style={style}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={() => setPop({ ...pop, open: true })}>💬 댓글</button>
    );
  }
  return (
    <div className="sel-comment-form" style={style} onMouseUp={(e) => e.stopPropagation()}>
      <div className="sel-comment-quote">“{pop.text.slice(0, 80)}{pop.text.length > 80 ? '…' : ''}”</div>
      <textarea autoFocus rows={3} value={text} placeholder="인라인 댓글…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') setPop(null); }} />
      <div className="modal-actions">
        <button className="btn" onClick={() => setPop(null)}>취소</button>
        <button className="btn btn-primary" onClick={submit}>등록</button>
      </div>
    </div>
  );
}

// 인라인 댓글 목록: 인용 클릭 → 본문 해당 위치로 스크롤·강조
function InlineComments({ comments, pageId, onChanged }) {
  const list = comments?.filter((c) => c.kind === 'inline') ?? [];
  if (!list.length) return null;

  const locate = (c) => {
    if (!c.inline_ref) return;
    const doc = document.querySelector('.doc');
    if (!doc) return;
    let target = doc.querySelector(`[data-inline-anchor="${c.id}"]`);
    if (!target) {
      try { target = doc.querySelector(`.comment-mark[data-ref="${CSS.escape(c.inline_ref)}"]`); } catch { /* 선택자 불가 문자는 텍스트 검색으로 */ }
    }
    if (!target) {
      const line = refLines(c.inline_ref)[0];
      const hit = line && findTextRange(doc, line);
      if (hit) target = hit.range.startContainer.parentElement;
    }
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('inline-flash');
    setTimeout(() => target.classList.remove('inline-flash'), 1800);
  };

  const resolve = async (c) => {
    await fetch(`/api/comments/${c.id}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !c.resolved }),
    });
    onChanged();
  };

  return (
    <section className="comments inline-comments">
      <h2>인라인 댓글 <span className="muted">({list.length})</span></h2>
      {list.map((c) => (
        <div key={c.id} data-comment-item={c.id} className={`inline-comment-item ${c.resolved ? 'comment-resolved' : ''}`}>
          {c.inline_ref && (
            <button className="inline-quote" onClick={() => locate(c)} title="본문에서 보기">
              “{c.inline_ref.slice(0, 90)}{c.inline_ref.length > 90 ? '…' : ''}”
            </button>
          )}
          <Comment comment={c} pageId={pageId} />
          <button className="btn btn-xs" onClick={() => resolve(c)}>{c.resolved ? '다시 열기' : '해결'}</button>
          {c.resolved && <span className="status status-green">해결됨</span>}
        </div>
      ))}
    </section>
  );
}

// 댓글 입력 (Gira와 같은 공용 입력창): 글 + 파일·이미지 첨부(📎·붙여넣기·끌어 놓기).
// 파일은 문서 첨부로 올리고, 댓글 본문에 이미지(media)·파일 링크(fileLink)로 넣는다 — 보기에서 첨부 주소로 채워진다.
function CommentForm({ pageId, onAdded }) {
  const upload = async (file) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    const res = await fetch(`/api/content/${pageId}/attachments`, { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 403 ? '이 문서에 파일을 올릴 권한(편집)이 없습니다' : (body.error ?? '파일을 올리지 못했습니다'));
    return { filename: body.filename, image: (file.type || '').startsWith('image/') };
  };
  const submit = async (text, uploaded) => {
    const content = [
      ...(text ? text.split(/\n+/).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) : []),
      ...uploaded.map((u) => ({ type: 'paragraph', content: [u.image
        ? { type: 'media', attrs: { kind: 'attachment', filename: u.filename } }
        : { type: 'fileLink', attrs: { filename: u.filename } }] })),
    ];
    const res = await fetch(`/api/content/${pageId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: { type: 'doc', content } }),
    });
    if (!res.ok) throw new Error('댓글 등록 실패');
    onAdded();
  };
  return <CommentComposer className="comment-form" placeholder="댓글 추가…" submitLabel="등록" upload={upload} onSubmit={submit} />;
}

function isEmptyDoc(doc) {
  if (!doc?.content?.length) return true;
  return doc.content.every((n) => n.type === 'paragraph' && !(n.content?.length));
}

function Doc({ page, navigate }) {
  const doc = page.version?.doc;
  const content = useMemo(() => doc ? hydrateDoc(structuredClone(doc), page.id) : null, [doc, page.id]);
  const editor = useEditor({ extensions, content, editable: false }, [content]);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!editor || !content) return;
    const t = setTimeout(() => hydrateMacros(ref.current, { page, navigate }), 80);
    return () => clearTimeout(t);
  }, [editor, content, page, navigate]);
  if (!doc) return <div className="muted">본문이 없습니다.</div>;
  return <div ref={ref}><EditorContent editor={editor} className="doc" /></div>;
}

function Comment({ comment, pageId }) {
  const html = useMemo(() => {
    if (!comment.doc) return '';
    try { return generateHTML(hydrateDoc(linkifyDoc(structuredClone(comment.doc)), pageId), extensions); }
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
