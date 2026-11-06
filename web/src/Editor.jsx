import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { internalLink } from './internal-links.js';
import { editExtensions } from './extensions.js';
import { slashMenu, makeSlashItems } from './slash-menu.js';
import { mentionMenu, emojiMenu } from './suggest-menus.js';
import { api, hydrateDoc } from './api.js';
import { useEditPresence, EditingWarning } from './edit-presence.jsx';

async function send(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`${res.status}`);
    err.status = res.status;
    err.body = await res.json().catch(() => null);
    throw err;
  }
  return res.json();
}

export default function Editor({ pageId, navigate, reloadSpace }) {
  const [page, setPage] = useState(null);
  const [initialDoc, setInitialDoc] = useState(null);
  const [initialTitle, setInitialTitle] = useState(null);
  const [fromDraft, setFromDraft] = useState(false);
  const [saveState, setSaveState] = useState('');     // '', '저장 중…', '저장됨 HH:MM'
  const [publishing, setPublishing] = useState(false);
  const baseVersion = useRef(null);

  useEffect(() => {
    (async () => {
      const p = await api(`/api/content/${pageId}`);
      setPage(p);
      baseVersion.current = p.version?.version ?? 0;
      try {
        const d = await api(`/api/content/${pageId}/draft`);
        if (d.doc) {
          setInitialDoc(hydrateDoc(d.doc, pageId));
          setInitialTitle(d.title ?? p.title);
          if (d.base_version != null) baseVersion.current = d.base_version;
          setFromDraft(true);
          return;
        }
      } catch { /* 초안 없음 */ }
      setInitialTitle(p.title);
      setInitialDoc(p.version?.doc
        ? hydrateDoc(structuredClone(p.version.doc), pageId)
        : { type: 'doc', content: [{ type: 'paragraph' }] });
    })().catch(console.error);
  }, [pageId]);

  if (!page || !initialDoc) return <div className="page-loading">편집기 여는 중…</div>;
  return <EditorInner page={page} initialDoc={initialDoc} initialTitle={initialTitle ?? page.title}
    fromDraft={fromDraft} baseVersion={baseVersion} saveState={saveState} setSaveState={setSaveState}
    publishing={publishing} setPublishing={setPublishing} navigate={navigate} reloadSpace={reloadSpace} />;
}

function EditorInner({ page, initialDoc, initialTitle, fromDraft, baseVersion, saveState, setSaveState, publishing, setPublishing, navigate, reloadSpace }) {
  const [linkChoice, setLinkChoice] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const timer = useRef(null);
  const dirty = useRef(false);
  const fileInput = useRef(null);
  const editorRef = useRef(null);
  // 편집 중 신호(30초 하트비트) — 다른 편집자가 있으면 상단에 경고 (막지는 않는다)
  const editors = useEditPresence(page.id, { editing: true });
  const isUntitled = initialTitle === '제목 없는 문서';
  const [title, setTitle] = useState(isUntitled ? '' : initialTitle);
  const titleRef = useRef(title);
  titleRef.current = title;
  const titleInput = useRef(null);
  // 편집기 모드: confluence(고정 툴바) | notion(버블 메뉴 + / 명령 중심). 문서 저장 형식은 동일하다.
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('editorMode') ?? 'confluence'; } catch { return 'confluence'; }
  });
  const switchMode = (m) => {
    setMode(m);
    setBubble(null);
    try { localStorage.setItem('editorMode', m); } catch { /* 프라이빗 모드 등 */ }
  };
  // Notion 모드 버블 메뉴 위치. tippy 기반 BubbleMenu는 DOM을 React 밖으로 옮겨
  // 모드 전환 시 removeChild 충돌(화면 전체가 빈 화면)을 일으켜 직접 구현한다.
  const [bubble, setBubble] = useState(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const uploadFiles = useCallback(async (files) => {
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/content/${page.id}/attachments`, { method: 'POST', body: fd });
      if (!res.ok) { alert(`업로드 실패: ${file.name}`); continue; }
      const { filename, url } = await res.json();
      const ed = editorRef.current;
      if (!ed) continue;
      if (file.type.startsWith('image/')) {
        ed.chain().focus().insertContent({ type: 'media', attrs: { kind: 'attachment', filename, src: url } }).run();
      } else {
        ed.chain().focus().insertContent({ type: 'fileLink', attrs: { filename, href: url } }).run();
      }
    }
  }, [page.id]);

  const exts = useMemo(() => [
    ...editExtensions,
    slashMenu(makeSlashItems({ openImageDialog: () => fileInput.current?.click() })),
    mentionMenu(),
    emojiMenu(),
  ], []);

  const saveDraft = useCallback(async (editor) => {
    setSaveState('저장 중…');
    try {
      await send(`/api/content/${page.id}/draft`, 'PUT', {
        doc: editor.getJSON(), title: titleRef.current, baseVersion: baseVersion.current,
      });
      dirty.current = false;
      setSaveState(`저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      setSaveState('저장 실패');
    }
  }, [page.id]);

  const editor = useEditor({
    extensions: exts,
    content: initialDoc,
    autofocus: !isUntitled, // 새 문서는 제목 입력부터
    editorProps: {
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length) { uploadFiles(files); return true; }
        const text = event.clipboardData?.getData('text/plain')?.trim();
        const link = text && internalLink(text, window.location.href);
        if (link && !view.state.selection.$from.parent.type.spec.code) {
          // 붙여넣기는 바로 링크로 넣고(Confluence처럼), 그 옆에 '카드로 바꾸기'를 띄운다
          event.preventDefault();
          const { state } = view;
          const from = state.selection.from;
          const mark = state.schema.marks.link?.create({ href: link.href });
          view.dispatch(state.tr.replaceSelectionWith(state.schema.text(text, mark ? [mark] : []), false).setMeta('linkPaste', true));
          const to = from + text.length;
          const at = view.coordsAtPos(to);
          setLinkError('');
          setLinkChoice({ ...link, text, from, to, x: at.left, y: at.bottom });
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) { event.preventDefault(); uploadFiles(files); return true; }
        return false;
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // 붙여넣은 뒤 다른 편집을 하면 '카드로 바꾸기'는 닫는다 (위치가 달라지므로)
      if (!transaction?.getMeta('linkPaste') && !transaction?.getMeta('linkCard')) setLinkChoice(null);
      dirty.current = true;
      setSaveState('변경됨');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveDraft(editor), 1500);
    },
  });
  editorRef.current = editor;

  useEffect(() => () => clearTimeout(timer.current), []);

  // Notion 모드: 선택 영역 위에 버블 메뉴
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (modeRef.current !== 'notion') { setBubble(null); return; }
      const { from, to, empty } = editor.state.selection;
      if (empty) { setBubble(null); return; }
      try {
        const a = editor.view.coordsAtPos(from);
        const b = editor.view.coordsAtPos(to);
        setBubble({ x: (a.left + b.right) / 2, y: Math.min(a.top, b.top) });
      } catch { setBubble(null); }
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor]);

  // Confluence 단축키: Ctrl/Cmd+S 또는 Ctrl/Cmd+Enter = 게시(업데이트)
  const publishRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        publishRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const publish = async () => {
    if (!editor) return;
    setPublishing(true);
    clearTimeout(timer.current);
    try {
      if (!titleRef.current.trim()) {
        alert('제목을 입력해주세요.');
        titleInput.current?.focus();
        setPublishing(false);
        return;
      }
      const r = await send(`/api/content/${page.id}/publish`, 'POST', {
        doc: editor.getJSON(), title: titleRef.current, baseVersion: baseVersion.current,
      });
      dirty.current = false;
      reloadSpace?.(); // 제목이 바뀌었을 수 있으니 트리 갱신
      navigate(`/s/${page.spaceKey}/p/${page.id}`);
    } catch (e) {
      if (e.status === 409) {
        alert(`버전 충돌: 편집을 시작한 뒤 다른 곳에서 v${e.body?.currentVersion}이 게시되었습니다.\n초안은 보존됩니다.`);
      } else {
        alert(`게시 실패 (${e.status})`);
      }
    } finally {
      setPublishing(false);
    }
  };

  publishRef.current = publish;

  // 사이드바 등으로 편집 화면을 떠날 때: 아직 저장 안 한 변경은 초안으로 저장 (편집기가 없어지기 전에 — layout 정리 단계)
  useLayoutEffect(() => () => {
    clearTimeout(timer.current);
    const ed = editorRef.current;
    if (dirty.current && ed && !ed.isDestroyed) saveDraft(ed);
  }, [saveDraft]);

  const close = async () => {
    clearTimeout(timer.current);
    if (editor && dirty.current) await saveDraft(editor);
    navigate(`/s/${page.spaceKey}/p/${page.id}`);
  };

  const discard = async () => {
    const neverPublished = !page.version;
    if (!confirm(neverPublished ? '이 문서를 게시하지 않고 버릴까요? (휴지통으로 이동)' : '초안을 버리고 게시된 버전으로 돌아갈까요?')) return;
    clearTimeout(timer.current);
    dirty.current = false;
    await send(`/api/content/${page.id}/draft`, 'DELETE');
    if (neverPublished) {
      await send(`/api/content/${page.id}/status`, 'POST', { status: 'trashed' });
      navigate(`/s/${page.spaceKey}`);
      return;
    }
    navigate(`/s/${page.spaceKey}/p/${page.id}`);
  };

  return (
    <div className="editor">
      <div className="editor-head">
      <div className="editor-top">
        <div className="editor-title">
          <strong>{title.trim() || '제목 없는 문서'}</strong>
          <span className="muted"> — v{baseVersion.current} 기준 편집 {fromDraft && '(미게시 초안 불러옴)'}</span>
        </div>
        <div className="editor-actions">
          <div className="mode-switch" title="문서 형식은 동일 — 편집 UI만 다릅니다">
            <button className={mode === 'confluence' ? 'on' : ''} onClick={() => switchMode('confluence')}>Gonfluence</button>
            <button className={mode === 'notion' ? 'on' : ''} onClick={() => switchMode('notion')}>Notion</button>
          </div>
          <span className="save-state">{saveState}</span>
          <button className="btn" onClick={discard}>초안 버리기</button>
          <button className="btn" onClick={close}>닫기</button>
          <button className="btn btn-primary" onClick={publish} disabled={publishing}>
            {publishing ? '게시 중…' : (page.version ? '업데이트' : '게시')}
          </button>
        </div>
      </div>
      <EditingWarning editors={editors} />
      {editor && mode === 'confluence' && <Toolbar editor={editor} onImage={() => fileInput.current?.click()} />}
      {editor && mode === 'notion' && (
        <div className="notion-hint muted">블록 추가는 <code>/</code> 입력 · 서식은 텍스트 선택</div>
      )}
      </div>
      {linkChoice && <div className="link-choice" role="dialog" aria-label="붙여넣은 링크"
        style={{ left: Math.max(8, Math.min(linkChoice.x, window.innerWidth - 320)), top: linkChoice.y + 6 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setLinkChoice(null); editor?.commands.focus(); } }}>
        <button className="btn btn-primary" disabled={linkLoading} autoFocus onClick={async () => {
          setLinkLoading(true);
          const choice = linkChoice;
          try {
            const data = await api(choice.kind === 'page'
              ? `/api/content/${choice.id}` : `/api/gira/issues/${choice.id}`);
            if (choice.kind === 'issue' && !data.summary) throw new Error('이슈를 볼 수 없음');
            if (editor.isDestroyed) return;
            // 붙여넣은 링크가 그 자리에 그대로 있을 때만 카드로 바꾼다
            if (editor.state.doc.textBetween(choice.from, choice.to) !== choice.text) { setLinkChoice(null); return; }
            editor.chain().focus().command(({ tr }) => { tr.setMeta('linkCard', true); return true; })
              .insertContentAt({ from: choice.from, to: choice.to }, { type: 'linkCard', attrs: {
                href: choice.href, kind: choice.kind,
                title: choice.kind === 'page' ? data.title : `${choice.id} · ${data.summary}`,
                status: data.status || '',
              } }).run();
            setLinkChoice(null);
          } catch { setLinkError('카드를 불러올 수 없습니다 — 링크로 둡니다'); }
          finally { setLinkLoading(false); }
        }}>{linkLoading ? '불러오는 중…' : (linkChoice.kind === 'issue' ? '이슈 카드로 바꾸기' : '문서 카드로 바꾸기')}</button>
        <button className="btn" disabled={linkLoading} title="링크로 둔다 (Esc)"
          onClick={() => { setLinkChoice(null); editor?.commands.focus(); }}>링크로 두기</button>
        {linkError && <span role="alert" className="link-choice-err">{linkError}</span>}
      </div>}

      {editor && bubble && mode === 'notion' && (
        <div className="bubble-menu bubble-floating"
          style={{ left: bubble.x, top: Math.max(8, bubble.y - 44) }}
          onMouseDown={(e) => e.preventDefault() /* 편집기 포커스 유지 */}>
          <button className={editor.isActive('bold') ? 'on' : ''} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'on' : ''} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive('underline') ? 'on' : ''} onClick={() => editor.chain().focus().toggleMark('underline').run()}><u>U</u></button>
          <button className={editor.isActive('strike') ? 'on' : ''} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
          <button className={editor.isActive('code') ? 'on' : ''} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
          <button onClick={() => {
            const href = prompt('링크 URL:');
            if (href) editor.chain().focus().setMark('link', { href }).run();
          }}>🔗</button>
          <button className={editor.isActive('heading', { level: 2 }) ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        </div>
      )}
      <input ref={fileInput} type="file" multiple hidden
        onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = ''; }} />
      <div className={`page editor-body ${page.fullWidth ? 'page-full' : ''}`}>
        <input ref={titleInput} className="title-input" value={title} placeholder="제목을 입력하세요"
          autoFocus={isUntitled}
          onChange={(e) => {
            setTitle(e.target.value);
            dirty.current = true;
            setSaveState('변경됨');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => { const ed = editorRef.current; if (ed) saveDraft(ed); }, 1500);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault();
              const ed = editorRef.current;
              if (ed) { ed.commands.focus('start'); ed.view.dom.focus(); } // dom.focus()로 동기 전환
            }
          }} />
        <EditorContent editor={editor} className="doc" />
      </div>
    </div>
  );
}

// Confluence 표준 텍스트 색상 팔레트 느낌의 무난한 8색 (editor-spec.md)
const TEXT_COLORS = ['#172b4d', '#0747a6', '#008da6', '#006644', '#ff8b00', '#de350b', '#5243aa', '#97a0af'];

function Toolbar({ editor, onImage }) {
  const [palette, setPalette] = useState(false);
  const [grid, setGrid] = useState(null); // {r, c} 호버 상태 (null=닫힘)
  const B = ({ onClick, active, children, title }) => (
    <button className={`tb ${active ? 'tb-active' : ''}`} title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}>{children}</button>
  );
  const chain = () => editor.chain().focus();
  const insertTable = (rows = 3, cols = 3) => chain().insertContent({
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, () => ({
        type: r === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1 },
        content: [{ type: 'paragraph' }],
      })),
    })),
  }).run();
  const insertLayout = (n) => chain().insertContent({
    type: 'layout',
    content: [{
      type: 'layoutSection', attrs: { kind: n === 2 ? 'two_equal' : 'three_equal' },
      content: Array.from({ length: n }, () => ({ type: 'layoutColumn', content: [{ type: 'paragraph' }] })),
    }],
  }).run();
  const insertPanel = (panelType) => chain().insertContent({
    type: 'panel', attrs: { panelType, title: null, bgColor: null },
    content: [{ type: 'paragraph' }],
  }).run();
  const insertExpand = () => chain().insertContent({
    type: 'expand', attrs: { title: '제목' }, content: [{ type: 'paragraph' }],
  }).run();

  return (
    <div className="toolbar">
      <select className="tb-select"
        value={editor.isActive('heading') ? `h${editor.getAttributes('heading').level}` : 'p'}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') chain().setParagraph().run();
          else chain().setHeading({ level: Number(v[1]) }).run();
        }}>
        <option value="p">일반 텍스트</option>
        <option value="h1">제목 1</option>
        <option value="h2">제목 2</option>
        <option value="h3">제목 3</option>
        <option value="h4">제목 4</option>
        <option value="h5">제목 5</option>
        <option value="h6">제목 6</option>
      </select>
      <span className="tb-sep" />
      <B title="굵게 (Ctrl+B)" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><b>B</b></B>
      <B title="기울임 (Ctrl+I)" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><i>I</i></B>
      <B title="밑줄 (Ctrl+U)" active={editor.isActive('underline')} onClick={() => chain().toggleMark('underline').run()}><u>U</u></B>
      <B title="취소선 (Ctrl+Shift+S)" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><s>S</s></B>
      <B title="코드 (Ctrl+Shift+M)" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()}>{'<>'}</B>
      <span className="tb-color-wrap">
        <B title="텍스트 색상" active={!!editor.getAttributes('textColor').color}
          onClick={() => setPalette((v) => !v)}>
          <span className="tb-color-a" style={{ borderBottomColor: editor.getAttributes('textColor').color ?? '#172b4d' }}>A</span>
        </B>
        {palette && (
          <span className="tb-pop tb-palette" onMouseDown={(e) => e.preventDefault()}>
            <button className="tb-swatch tb-swatch-none" title="기본"
              onClick={() => { chain().unsetMark('textColor').run(); setPalette(false); }}>∅</button>
            {TEXT_COLORS.map((c) => (
              <button key={c} className="tb-swatch" style={{ background: c }} title={c}
                onClick={() => { chain().setMark('textColor', { color: c }).run(); setPalette(false); }} />
            ))}
          </span>
        )}
      </span>
      <span className="tb-sep" />
      <B title="왼쪽 정렬" active={!editor.getAttributes('paragraph').textAlign && !editor.getAttributes('heading').textAlign}
        onClick={() => chain().setTextAlign(null).run()}>⇤</B>
      <B title="가운데 정렬" active={editor.isActive({ textAlign: 'center' })}
        onClick={() => chain().setTextAlign('center').run()}>⇹</B>
      <B title="오른쪽 정렬" active={editor.isActive({ textAlign: 'right' })}
        onClick={() => chain().setTextAlign('right').run()}>⇥</B>
      <span className="tb-sep" />
      <B title="글머리 목록 (Ctrl+Shift+8)" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>•≡</B>
      <B title="번호 목록 (Ctrl+Shift+7)" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>1≡</B>
      <B title="인용 (Ctrl+Shift+9)" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>❝</B>
      <B title="코드 블록" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()}>{ '{ }' }</B>
      <span className="tb-sep" />
      <B title="작업 항목 ([] 입력)" onClick={() => chain().insertContent({
        type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }],
      }).run()}>☑</B>
      <B title="멘션 (@ 입력)" onClick={() => chain().insertContent('@').run()}>@</B>
      <B title="이미지·파일 업로드" onClick={onImage}>🖼</B>
      <B title="레이아웃 (2단)" onClick={() => insertLayout(2)}>⫴</B>
      <span className="tb-table-wrap">
        <B title="표 삽입 (크기 선택)" onClick={() => setGrid(grid ? null : { r: 3, c: 3 })}>⊞ 표</B>
        {grid && (
          <span className="tb-pop tb-grid" onMouseDown={(e) => e.preventDefault()}>
            {Array.from({ length: 6 }, (_, r) => (
              <span className="tb-grid-row" key={r}>
                {Array.from({ length: 8 }, (_, c) => (
                  <button key={c}
                    className={`tb-cell ${r < grid.r && c < grid.c ? 'on' : ''}`}
                    onMouseEnter={() => setGrid({ r: r + 1, c: c + 1 })}
                    onClick={() => { insertTable(grid.r, grid.c); setGrid(null); }} />
                ))}
              </span>
            ))}
            <span className="tb-grid-label">{grid.r} × {grid.c}</span>
          </span>
        )}
      </span>
      <B title="정보 패널" onClick={() => insertPanel('info')}>ℹ 패널</B>
      <B title="펼치기" onClick={insertExpand}>▸ 펼치기</B>
      <B title="구분선" onClick={() => chain().setHorizontalRule().run()}>—</B>
      <B title="링크 (Ctrl+K)" active={editor.isActive('link')} onClick={() => {
        const prev = editor.getAttributes('link').href ?? '';
        const url = window.prompt('링크 URL', prev);
        if (url === null) return;
        if (!url) chain().extendMarkRange('link').unsetMark('link').run();
        else chain().extendMarkRange('link').setMark('link', { href: url }).run();
      }}>🔗</B>
      <span className="tb-sep" />
      <B title="실행 취소" onClick={() => chain().undo().run()}>↶</B>
      <B title="다시 실행" onClick={() => chain().redo().run()}>↷</B>
      <span className="tb-hint muted">입력 중 <code>/</code> 로 블록 삽입</span>
      {editor.isActive('table') && (
        <span className="tb-table-ops">
          <span className="tb-sep" />
          <B title="아래에 행 추가" onClick={() => chain().addRowAfter().run()}>+행</B>
          <B title="행 삭제" onClick={() => chain().deleteRow().run()}>−행</B>
          <B title="오른쪽에 열 추가" onClick={() => chain().addColumnAfter().run()}>+열</B>
          <B title="열 삭제" onClick={() => chain().deleteColumn().run()}>−열</B>
          <B title="헤더 행 토글" onClick={() => chain().toggleHeaderRow().run()}>헤더</B>
          <B title="선택한 셀 병합" onClick={() => chain().mergeCells().run()}>셀 병합</B>
          <B title="셀 분할" onClick={() => chain().splitCell().run()}>셀 분할</B>
          <B title="표 삭제" onClick={() => chain().deleteTable().run()}>표 삭제</B>
        </span>
      )}
    </div>
  );
}
