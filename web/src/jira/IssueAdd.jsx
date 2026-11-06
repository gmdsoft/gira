// 이슈 상세 '+' (GIRA-23): Jira처럼 메뉴 → 하위 작업 인라인 만들기(⇧C)·업무 항목 연결(⇧K)·첨부 파일 추가·웹 링크 추가
import React, { useEffect, useRef, useState } from 'react';
import { api } from './util.jsx';
import { TypeIcon, IconPlus } from './icons.jsx';

// 연결 종류별 표시 문구: [이 이슈가 상대에게(outward), 상대가 이 이슈에게(inward)]. 목록에 없으면 이름 그대로(양방향 같음)
export const LINK_PHRASES = {
  'Blocks': ['차단함', '차단됨'],
  '중복 이슈': ['중복함', '중복됨'],
  'Duplicate': ['중복함', '중복됨'],
  'Cloners': ['복제함', '복제됨'],
  '관련 이슈': ['관련 이슈', '관련 이슈'],
};
export const linkPhrase = (type, outward) => (LINK_PHRASES[type] ? LINK_PHRASES[type][outward ? 0 : 1] : type);

// 바깥을 누르면 닫히는 작은 메뉴
export function AddMenu({ items, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span className="add-menu" ref={ref}>
      <button className={`iconbtn${open ? ' on' : ''}`} title="추가" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}><IconPlus size={17} /></button>
      {open && (
        <div className="add-menu-pop" role="menu">
          {items.map((group, gi) => (
            <div className="add-menu-group" key={gi}>
              {group.map((it) => (
                <button key={it.key} role="menuitem" type="button" onClick={() => { setOpen(false); onPick(it.key); }}>
                  <span className="add-menu-ico">{it.icon}</span><span className="add-menu-label">{it.label}</span>
                  {it.shortcut && <kbd>{it.shortcut}</kbd>}
                </button>))}
            </div>))}
        </div>)}
    </span>
  );
}

// 하위 작업 인라인 만들기: Enter로 만들고 줄은 열린 채 다음 입력, Esc·취소로 닫는다
export function SubtaskInline({ issue, types, onCreated, onCancel }) {
  const [summary, setSummary] = useState('');
  const [typeId, setTypeId] = useState(() => String(types[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = async () => {
    const s = summary.trim();
    if (!s || busy) return;
    setBusy(true); setErr('');
    try {
      await api('/api/issues', { method: 'POST', quiet: true, json: {
        projectKey: issue.issue_key.split('-')[0], typeId, summary: s, parentKey: issue.issue_key } });
      setSummary(''); onCreated();
      setTimeout(() => input.current?.focus(), 0);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const typeName = types.find((t) => String(t.id) === typeId)?.name;
  return (
    <div className="inline-add">
      <div className="inline-add-row">
        <input ref={input} value={summary} disabled={busy} placeholder={`이 ${typeName ?? '하위 작업'}의 이름 지정`}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') onCancel(); }} />
        <span className="inline-type"><TypeIcon name={typeName} />
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="유형">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></span>
        <button type="button" className="inline-enter" title="만들기 (Enter)" disabled={busy || !summary.trim()} onClick={submit}>↵</button>
      </div>
      <div className="inline-add-foot">{err && <span className="inline-err">{err}</span>}<button type="button" className="plain" onClick={onCancel}>취소</button></div>
    </div>
  );
}

// 업무 항목 연결: 관계 종류(방향 포함) + 이슈 검색 → 연결
export function LinkInline({ issueKey, onDone, onCancel }) {
  const [types, setTypes] = useState([]);
  const [rel, setRel] = useState('');           // "<종류>|out" 또는 "<종류>|in"
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef(null);
  useEffect(() => {
    api('/api/link-types').then((ts) => { setTypes(ts); setRel(`${ts.includes('관련 이슈') ? '관련 이슈' : ts[0]}|out`); }).catch(() => {});
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!q.trim() || pick?.issue_key === q.trim()) { setFound([]); return undefined; }
    const t = setTimeout(() => api(`/api/issue-search?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.filter((x) => x.issue_key !== issueKey))).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  // 방향이 다른 종류는 두 가지로, 같은 종류(관련 이슈 등)는 하나로
  const options = types.flatMap((t) => (LINK_PHRASES[t] && LINK_PHRASES[t][0] !== LINK_PHRASES[t][1]
    ? [[`${t}|out`, linkPhrase(t, true)], [`${t}|in`, linkPhrase(t, false)]] : [[`${t}|out`, linkPhrase(t, true)]]));
  const submit = async () => {
    const key = (pick?.issue_key ?? q).trim().toUpperCase();
    if (!key || !rel || busy) return;
    const [linkType, dir] = rel.split('|');
    setBusy(true); setErr('');
    try {
      await api(`/api/issue/${encodeURIComponent(issueKey)}/links`, { method: 'POST', quiet: true,
        json: { otherKey: key, linkType, direction: dir === 'in' ? 'inward' : 'outward' } });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="inline-add">
      <div className="inline-add-row">
        <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="연결 종류">
          {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <span className="inline-search">
          <input ref={input} value={q} disabled={busy} placeholder="이슈 키 또는 요약으로 찾기"
            onChange={(e) => { setQ(e.target.value); setPick(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (found[0] && !pick) { setPick(found[0]); setQ(found[0].issue_key); } else submit(); } if (e.key === 'Escape') onCancel(); }} />
          {found.length > 0 && (
            <div className="inline-results">{found.map((f) => (
              <button type="button" key={f.issue_key} onClick={() => { setPick(f); setQ(f.issue_key); setFound([]); }}>
                <TypeIcon name={f.type_name} /> <b>{f.issue_key}</b> <span>{f.summary}</span></button>))}
            </div>)}
        </span>
        <button type="button" className="primary" disabled={busy || !q.trim()} onClick={submit}>연결</button>
      </div>
      <div className="inline-add-foot">{err && <span className="inline-err">{err}</span>}<button type="button" className="plain" onClick={onCancel}>취소</button></div>
    </div>
  );
}

// 웹 링크 추가: URL + 표시 이름
export function WebLinkInline({ issueKey, onDone, onCancel }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      await api(`/api/issue/${encodeURIComponent(issueKey)}/weblinks`, { method: 'POST', quiet: true, json: { url: url.trim(), title: title.trim() } });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const keys = (e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') onCancel(); };
  return (
    <div className="inline-add">
      <div className="inline-add-row">
        <input ref={input} value={url} disabled={busy} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onKeyDown={keys} />
        <input value={title} disabled={busy} placeholder="표시 이름 (선택)" onChange={(e) => setTitle(e.target.value)} onKeyDown={keys} />
        <button type="button" className="primary" disabled={busy || !url.trim()} onClick={submit}>추가</button>
      </div>
      <div className="inline-add-foot">{err && <span className="inline-err">{err}</span>}<button type="button" className="plain" onClick={onCancel}>취소</button></div>
    </div>
  );
}
