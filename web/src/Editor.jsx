import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { BubbleMenu, EditorContent, useEditor } from '@tiptap/react';
import { editExtensions } from './extensions.js';
import { slashMenu, makeSlashItems } from './slash-menu.js';
import { api, hydrateDoc } from './api.js';

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
  const timer = useRef(null);
  const dirty = useRef(false);
  const fileInput = useRef(null);
  const editorRef = useRef(null);
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
    try { localStorage.setItem('editorMode', m); } catch { /* 프라이빗 모드 등 */ }
  };

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
        return false;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) { event.preventDefault(); uploadFiles(files); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      dirty.current = true;
      setSaveState('변경됨');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveDraft(editor), 1500);
    },
  });
  editorRef.current = editor;

  useEffect(() => () => clearTimeout(timer.current), []);

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

  const close = async () => {
    clearTimeout(timer.current);
    if (editor && dirty.current) await saveDraft(editor);
    navigate(`/s/${page.spaceKey}/p/${page.id}`);
  };

  const discard = async () => {
    const neverPublished = !page.version;
    if (!confirm(neverPublished ? '이 문서를 게시하지 않고 버릴까요? (휴지통으로 이동)' : '초안을 버리고 게시된 버전으로 돌아갈까요?')) return;
    clearTimeout(timer.current);
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
      <div className="editor-top">
        <div className="editor-title">
          <strong>{title.trim() || '제목 없는 문서'}</strong>
          <span className="muted"> — v{baseVersion.current} 기준 편집 {fromDraft && '(미게시 초안 불러옴)'}</span>
        </div>
        <div className="editor-actions">
          <div className="mode-switch" title="문서 형식은 동일 — 편집 UI만 다릅니다">
            <button className={mode === 'confluence' ? 'on' : ''} onClick={() => switchMode('confluence')}>Confluence</button>
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
      {editor && mode === 'confluence' && <Toolbar editor={editor} onImage={() => fileInput.current?.click()} />}
      {editor && mode === 'notion' && (
        <>
          <div className="notion-hint muted">블록 추가는 <code>/</code> 입력 · 서식은 텍스트 선택</div>
          <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }}>
            <div className="bubble-menu">
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
          </BubbleMenu>
        </>
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

function Toolbar({ editor, onImage }) {
  const B = ({ onClick, active, children, title }) => (
    <button className={`tb ${active ? 'tb-active' : ''}`} title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}>{children}</button>
  );
  const chain = () => editor.chain().focus();
  const insertTable = () => chain().insertContent({
    type: 'table',
    content: Array.from({ length: 3 }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: 3 }, () => ({
        type: r === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1 },
        content: [{ type: 'paragraph' }],
      })),
    })),
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
      </select>
      <span className="tb-sep" />
      <B title="굵게" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><b>B</b></B>
      <B title="기울임" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><i>I</i></B>
      <B title="밑줄" active={editor.isActive('underline')} onClick={() => chain().toggleMark('underline').run()}><u>U</u></B>
      <B title="취소선" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><s>S</s></B>
      <B title="코드" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()}>{'<>'}</B>
      <span className="tb-sep" />
      <B title="글머리 목록" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>•≡</B>
      <B title="번호 목록" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>1≡</B>
      <B title="인용" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>❝</B>
      <B title="코드 블록" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()}>{ '{ }' }</B>
      <span className="tb-sep" />
      <B title="표 삽입" onClick={insertTable}>⊞ 표</B>
      <B title="이미지·파일 업로드" onClick={onImage}>🖼 이미지</B>
      <B title="정보 패널" onClick={() => insertPanel('info')}>ℹ 패널</B>
      <B title="펼치기" onClick={insertExpand}>▸ 펼치기</B>
      <B title="구분선" onClick={() => chain().setHorizontalRule().run()}>—</B>
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
          <B title="표 삭제" onClick={() => chain().deleteTable().run()}>표 삭제</B>
        </span>
      )}
    </div>
  );
}
