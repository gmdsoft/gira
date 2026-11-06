import React, { useMemo, useState, useEffect, useRef } from 'react';
import { makeSlashItems } from './slash-menu.js';
import { createEmojiPicker } from './emoji-picker.js';
import './element-picker.css';

const frequent = ['표', '코드 블록', '정보 패널', '인용', '결정', '구분선', '펼치기', '날짜 (오늘)', '이슈'];
export function InsertMenu({ editor, onImage }) {
  const items = useMemo(() => makeSlashItems({ openImageDialog: onImage }), [onImage]);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  return <details className="tb-menu insert-menu" onToggle={e => { if (!e.currentTarget.open) { setAll(false); setQuery(''); setCategory('전체'); } }}>
    <summary className="tb" title="요소 삽입">+ 삽입 ∨</summary>
    <div className="tb-pop tb-menu-items">
      {all && <><input aria-label="요소 검색" placeholder="요소 검색" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="요소 카테고리" value={category} onChange={e => setCategory(e.target.value)}>
          {['전체', ...new Set(items.map(i => i.category))].map(c => <option key={c}>{c}</option>)}
        </select></>}
      {items.filter(i => all ? (category === '전체' || i.category === category) && `${i.label} ${i.kw}`.toLowerCase().includes(query.toLowerCase()) : frequent.includes(i.label)).map(i =>
        <button key={i.label} className="tb" onMouseDown={e => e.preventDefault()} onClick={e => {
          i.run(editor, editor.state.selection); e.currentTarget.closest('details').open = false;
        }}>{all && <small>{i.category} · </small>}{i.label}</button>)}
      {!all && <button className="tb" onClick={() => setAll(true)}>더 보기…</button>}
    </div>
  </details>;
}
export function EmojiButton({ editor }) {
  const ref = useRef(null);
  useEffect(() => {
    const picker = createEmojiPicker(item => {
      editor.chain().focus().insertContent({ type: 'emoji', attrs: { text: item[0], shortName: `:${item[1].split(' ')[0]}:` } }).run();
      ref.current.closest('details').open = false;
    });
    ref.current.append(picker);
    return () => picker.remove();
  }, [editor]);
  return <details className="tb-menu"><summary className="tb" title="이모지">🙂</summary><div className="tb-pop" ref={ref} /></details>;
}
