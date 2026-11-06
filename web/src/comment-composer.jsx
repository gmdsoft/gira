// 댓글 입력 (Gira·Gonfluence 공용): 글 + 파일 첨부(📎 버튼·클립보드 붙여넣기·끌어 놓기).
// 파일은 upload(file)로 먼저 올리고(이슈 첨부 / 문서 첨부), 그 결과를 onSubmit(text, uploaded)에 넘긴다 —
// 본문에 어떻게 넣을지는 각 앱이 정한다 (이미지는 댓글 안에 바로 보이게).
import React, { useEffect, useRef, useState } from 'react';
import { IconPaperclip } from './jira/icons.jsx';
import './comment-composer.css';

// 클립보드 이미지는 이름이 늘 image.png라 시각을 붙여 구분한다
function namedFile(f) {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(f.name || '') && f.name) return f;
  const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  return new File([f], `붙여넣은-이미지-${stamp}-${Math.random().toString(36).slice(2, 6)}.${ext}`, { type: f.type });
}

export default function CommentComposer({ upload, initialText = '', placeholder = '댓글 추가...', submitLabel = '댓글 달기',
  autoFocus = false, mini = false, className = 'cform', onSubmit, onCancel }) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState([]); // [{ key, file, url }]
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => () => pending.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list) => {
    const files = [...(list ?? [])].filter((f) => f && f.size > 0);
    if (!files.length) return false;
    setPending((cur) => [...cur, ...files.map((f) => {
      const file = namedFile(f);
      return { key: `${Date.now()}-${Math.random()}`, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
    })]);
    return true;
  };
  const remove = (key) => setPending((cur) => {
    const hit = cur.find((p) => p.key === key);
    if (hit?.url) URL.revokeObjectURL(hit.url);
    return cur.filter((p) => p.key !== key);
  });

  const submit = async () => {
    const body = text.trim();
    if ((!body && !pending.length) || busy) return;
    setBusy(true);
    try {
      const uploaded = [];
      for (const p of pending) uploaded.push(await upload(p.file));
      await onSubmit(body, uploaded);
      pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      setPending([]); setText('');
    } catch (e) {
      alert(`댓글을 저장하지 못했습니다: ${e.message ?? e}`);
    } finally { setBusy(false); }
  };

  return (
    <div className={`${className} composer${over ? ' drop-over' : ''}`}
      onDragOver={(e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); } }}>
      <textarea autoFocus={autoFocus} placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { if (addFiles(e.clipboardData?.files)) e.preventDefault(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
      {pending.length > 0 && (
        <div className="composer-files">
          {pending.map((p) => (
            <span className="composer-file" key={p.key} title={p.file.name}>
              {p.url ? <img src={p.url} alt={p.file.name} /> : <span className="composer-fname">📎 {p.file.name}</span>}
              <button type="button" className="composer-x" title="첨부 빼기" onClick={() => remove(p.key)}>✕</button>
            </span>))}
        </div>)}
      <div className="actions">
        <input type="file" multiple ref={fileRef} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className={`composer-attach btn${mini ? ' mini' : ''}`} title="파일·이미지 첨부 (붙여넣기·끌어 놓기도 됩니다)"
          onClick={() => fileRef.current?.click()}><IconPaperclip size={16} /></button>
        <span className="composer-hint dim">이미지는 붙여넣기(Ctrl+V)·끌어 놓기 가능</span>
        {onCancel && <button type="button" className={`btn${mini ? ' mini' : ''}`} onClick={onCancel} disabled={busy}>취소</button>}
        <button type="button" className={`primary btn btn-primary${mini ? ' mini' : ''}`} onClick={submit}
          disabled={busy || (!text.trim() && !pending.length)}>{busy ? '올리는 중…' : submitLabel}</button>
      </div>
    </div>
  );
}
