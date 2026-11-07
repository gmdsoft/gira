import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { extensions, editExtensions } from './extensions.js';
import { api } from './api.js';

function TemplateBody({ template, onSave }) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editor = useEditor({ extensions: editExtensions, content: template.doc, editable: !template.builtin });
  return <section>
    <label>템플릿 이름 <input value={name} disabled={template.builtin} onChange={(e) => setName(e.target.value)} /></label>
    <p>{template.description}</p>
    <EditorContent editor={editor} className="page-body" />
    {!template.builtin && <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={async () => {
      setBusy(true); setError('');
      try { await onSave({ name, doc: editor.getJSON() }); } catch (e) { setError(e.message); }
      finally { setBusy(false); }
    }}>저장</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
export function TemplatesBody({ spaceKey }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const base = `/api/spaces/${encodeURIComponent(spaceKey)}/templates`;
  const load = () => api(base).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [spaceKey]);
  return <div>
    <button className="btn" onClick={async () => {
      try {
        const t = await api(base, { method: 'POST', json: { name: '새 템플릿', doc: { type: 'doc', content: [{ type: 'paragraph' }] } } });
        setSelected(t); load();
      } catch (e) { setError(e.message); }
    }}>템플릿 추가</button>
    {error && <p role="alert">{error}</p>}
    <ul>{rows.map((t) => <li key={t.id}>
      <button className="btn" onClick={() => setSelected(t)}>{t.name}{t.builtin ? ' (기본)' : ''}</button>
      {!t.builtin && <button className="btn" onClick={async () => {
        if (!confirm(`“${t.name}” 템플릿을 삭제할까요?`)) return;
        try { await api(`${base}/${t.id}`, { method: 'DELETE' }); setSelected(null); load(); }
        catch (e) { setError(e.message); }
      }}>삭제</button>}
    </li>)}</ul>
    {selected && <TemplateBody key={selected.id} template={selected} onSave={async (body) => {
      const t = await api(`${base}/${selected.id}`, { method: 'PATCH', json: body }); setSelected(t); load();
    }} />}
  </div>;
}

export function TemplatePicker({ spaceKey, parentId, navigate, onClose }) {
  const [rows, setRows] = useState([]);
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/spaces/${encodeURIComponent(spaceKey)}/templates`;
  useEffect(() => { api(base).then((r) => { setRows(r); setId(String(r[0]?.id ?? '')); }).catch((e) => setError(e.message)); }, [base]);
  const t = rows.find((r) => String(r.id) === id);
  const preview = useEditor({ extensions, editable: false, content: { type: 'doc', content: [] } });
  useEffect(() => { if (preview && t) preview.commands.setContent(t.doc); }, [preview, t]);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" style={{ maxHeight: '85vh', overflow: 'auto', width: 760 }} onClick={(e) => e.stopPropagation()}>
    <h2>템플릿으로 만들기</h2>
    <select value={id} onChange={(e) => setId(e.target.value)}>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
    <p><input aria-label="문서 제목" placeholder="제목 (비우면 템플릿 이름)" value={title} onChange={(e) => setTitle(e.target.value)} /></p>
    <EditorContent editor={preview} className="page-body" />
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-primary" disabled={!id || busy} onClick={async () => {
      setBusy(true);
      try { const r = await api(`${base}/${id}/create`, { method: 'POST', json: { parentId, title } }); onClose(); navigate(`/s/${encodeURIComponent(spaceKey)}/p/${r.id}/edit`); }
      catch (e) { setError(e.message); setBusy(false); }
    }}>만들기</button> <button className="btn" onClick={onClose}>닫기</button>
  </div></div>;
}
