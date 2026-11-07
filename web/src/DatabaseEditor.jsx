import React, { useEffect, useState } from 'react';
import { list } from './database-model.mjs';
import { uid } from './database-io.mjs';
export const fieldTypes = { t:'텍스트', n:'숫자', d:'날짜', s:'선택/다중 선택', u:'사용자', h:'링크', ji:'Jira 이슈', pl:'문서 링크' };
export const newId = uid; // http에서도 동작 (crypto.randomUUID는 보안 연결에서만)
export function CellEditor({ field, value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [input, setInput] = useState(() => list(value).map(v => v?.u ?? v?.k ?? '').join(', '));
  useEffect(() => {
    if (!['u','pl'].includes(field.type) || !query) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(field.type === 'u' ? `/api/principals?q=${encodeURIComponent(query)}` : `/api/pages?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!r.ok) throw new Error('검색 실패');
        const v = await r.json(); setResults(field.type === 'u' ? v.users.filter(u => u.accountId) : v);
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, field.type]);
  if (['i','jid'].includes(field.type)) return <small>읽기 전용</small>;
  if (field.type === 's') return <select aria-label={field.name} multiple value={list(value)} onChange={e => onChange([...e.target.selectedOptions].map(o => o.value))}>{field.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
  if (['u','pl'].includes(field.type)) return <div>{list(value).map((v,i) => <button key={i} onClick={() => onChange(list(value).filter((_,n) => n !== i))}>{v.d ?? v.title ?? v.c} ×</button>)}<input aria-label={`${field.name} 검색`} value={query} placeholder="검색하여 추가" onChange={e => setQuery(e.target.value)} />{results.map(r => <button key={r.id} onClick={() => { onChange([...list(value), field.type === 'u' ? {a:r.accountId,d:r.name} : {c:String(r.id),title:r.title}]); setQuery(''); }}>{r.name ?? r.title}</button>)}{error}</div>;
  if (['h','ji'].includes(field.type)) return <div><input aria-label={field.name} value={input} placeholder={field.type === 'h' ? 'https://… (쉼표로 구분)' : 'GIRA-1, GIRA-2'} onChange={e => {
    setInput(e.target.value);
    const values = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
    if (values.some(v => field.type === 'h' ? !/^https?:\/\//.test(v) : !/^[A-Z][A-Z0-9_]*-\d+$/.test(v))) { setError('입력 형식을 확인하세요'); return; }
    if (field.type === 'h' && values.some(v => { try { new URL(v); return false; } catch { return true; } })) { setError('올바른 URL을 입력하세요'); return; }
    setError(''); onChange(values.map(v => field.type === 'h' ? {u:v} : {k:v}));
  }} />{error && <small role="alert">{error}</small>}</div>;
  return <input aria-label={field.name} type={field.type === 'n' ? 'number' : field.type === 'd' ? 'date' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : field.type === 'n' ? Number(e.target.value) : e.target.value)} />;
}
export function DatabaseTools({ data, view, change, setTab }) {
  const updateView = patch => change(d => Object.assign(d.views.find(v => v.id === view.id), patch));
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const selected = data.fields.find(f => f.id === filterField);
  return <div className="database-tools">
    <button onClick={() => change(d => d.rows.push({id:newId(), cells:{}}))}>행 추가</button>
    <button onClick={() => { const name = prompt('필드 이름'); if (name?.trim()) change(d => d.fields.push({id:newId(),name:name.trim(),type:'t',options:[]})); }}>필드 추가</button>
    <label>보드 그룹 <select value={view.groupBy ?? ''} onChange={e => updateView({groupBy:e.target.value || null})}><option value="">없음</option>{data.fields.filter(f => f.type === 's').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <label>정렬 <select value={view.sort?.[0]?.field ?? ''} onChange={e => updateView({sort:e.target.value ? [{field:e.target.value,ascending:true}] : []})}><option value="">없음</option>{data.fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <button onClick={() => updateView({sort:(view.sort ?? []).map(s => ({...s,ascending:!s.ascending}))})}>정렬 방향 {view.sort?.[0]?.ascending === false ? '↓' : '↑'}</button>
    <label>필터 <select value={filterField} onChange={e => setFilterField(e.target.value)}><option value="">필드 선택</option>{data.fields.filter(f => ['t','s','d'].includes(f.type)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    {selected?.type === 's' ? <select aria-label="필터 선택 값" value={filterValue} onChange={e => setFilterValue(e.target.value)}><option value="">값 선택</option>{selected.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select> : <input aria-label="필터 값" type={selected?.type === 'd' ? 'date' : 'text'} value={filterValue} onChange={e => setFilterValue(e.target.value)} />}
    {selected?.type === 'd' && <input aria-label="종료 날짜" type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />}
    <button disabled={!selected} onClick={() => updateView({filter:{f:filterField,t:selected.type === 'd' ? 'range' : selected.type === 's' ? 'eq' : 'c',v:selected.type === 'd' ? [filterValue,filterEnd] : selected.type === 's' ? [filterValue] : filterValue}})}>필터 적용</button>
    <button onClick={() => updateView({filter:null})}>필터 해제</button>
    <details><summary>필드 관리</summary>{data.fields.map(f => <div key={f.id}>
      <input aria-label="필드 이름" value={f.name} disabled={['i','jid'].includes(f.type)} onChange={e => change(d => { d.fields.find(x => x.id === f.id).name = e.target.value; })} />
      <select aria-label="필드 형식" disabled={['i','jid'].includes(f.type)} value={f.type} onChange={e => { if (!confirm('형식을 바꾸면 이 필드의 값이 비워집니다. 계속할까요?')) return; change(d => { Object.assign(d.fields.find(x => x.id === f.id), {type:e.target.value,options:[]}); d.rows.forEach(r => delete r.cells[f.id]); d.views.forEach(v => { if (v.groupBy === f.id) v.groupBy = null; if (v.calculations) delete v.calculations[f.id]; }); }); }}>{Object.entries({...fieldTypes,i:'파일 (읽기 전용)',jid:'Jira 필드 (읽기 전용)'}).map(([k,v]) => <option key={k} value={k} disabled={['i','jid'].includes(k)}>{v}</option>)}</select>
      <label><input type="checkbox" checked={view.hiddenFields.includes(f.id)} onChange={e => updateView({hiddenFields:e.target.checked ? [...view.hiddenFields,f.id] : view.hiddenFields.filter(id => id !== f.id)})} />숨김</label>
      <button disabled={data.fields.length === 1} onClick={() => { if (!confirm('필드와 모든 셀 값을 삭제할까요?')) return; change(d => { d.fields = d.fields.filter(x => x.id !== f.id); d.rows.forEach(r => delete r.cells[f.id]); d.views.forEach(v => { v.hiddenFields = v.hiddenFields.filter(id => id !== f.id); v.sort = (v.sort ?? []).filter(s => s.field !== f.id); v.filter = null; if (v.groupBy === f.id) v.groupBy = null; if (v.coverField === f.id) v.coverField = null; if (v.calculations) delete v.calculations[f.id]; }); }); }}>필드 삭제</button>
      {f.type === 's' && <div>{f.options.map(o => <span key={o.id}><input aria-label="선택지 이름" value={o.label} onChange={e => change(d => { d.fields.find(x => x.id === f.id).options.find(x => x.id === o.id).label = e.target.value; })} /><select aria-label="선택지 색" value={o.color ?? 'grey'} onChange={e => change(d => { d.fields.find(x => x.id === f.id).options.find(x => x.id === o.id).color = e.target.value; })}>{['grey','red','blue','green','teal','purple','magenta','yellow','orange','lime'].map(c => <option key={c}>{c}</option>)}</select></span>)}<button onClick={() => { const label = prompt('선택지 이름'); if (label) change(d => d.fields.find(x => x.id === f.id).options.push({id:newId(),label,color:'grey'})); }}>선택지 추가</button></div>}
    </div>)}</details>
  </div>;
}
