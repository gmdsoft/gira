// AI 도움말(GIRA-15)·AI 검색(GIRA-17) 화면 — Gira·Gonfluence 공용
//  AiHelpPanel: 상단 ?에서 여는 오른쪽 패널. 지금 화면(주소·제목)을 함께 보내 그 화면 기준으로 답을 받는다.
//  AiSearchBar: Gira 필터 줄 'AI' — 자연어 → JQL (해석·가정 표시, JQL은 그대로 고쳐 쓸 수 있다)
//  AiGuideBody: 설정 › AI 도움말 지침 (사이트 관리자)
import React, { useEffect, useRef, useState } from 'react';
import './ai-ui.css';

async function req(path, opts = {}) {
  const res = await fetch(path, opts.json
    ? { ...opts, body: JSON.stringify(opts.json), headers: { 'content-type': 'application/json' } }
    : opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `오류 (${res.status})`);
  return body;
}

// 아주 작은 마크다운: 줄바꿈, **굵게**, `코드`, 번호·글머리 목록 줄
function Answer({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => (
    p.startsWith('**') ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b>
      : p.startsWith('`') ? <code key={`${k}-${i}`}>{p.slice(1, -1)}</code> : p));
  // 빈 줄이 여러 개 이어지면 작은 간격 하나로
  const lines = text.replace(/\n{2,}/g, '\n\n').trim().split('\n');
  return <div className="ai-answer">{lines.map((line, i) => (
    line.trim() ? <p key={i} className={/^\s*([-*]|\d+\.)\s/.test(line) ? 'li' : ''}>{inline(line, i)}</p>
      : <div key={i} className="ai-gap" />))}</div>;
}

const SUGGEST = {
  Gira: ['보드에서 카드를 다른 상태로 옮기려면?', '내가 담당한 열린 이슈만 보려면?', '처리 완료되면 Teams로 알림 받으려면?'],
  Gonfluence: ['문서를 다른 폴더로 옮기려면?', '목차를 넣으려면?', 'Gira 이슈를 문서에 카드로 넣으려면?'],
};

export function AiHelpPanel({ appName, view, onClose }) {
  const [items, setItems] = useState([]); // [{ q, a, err }]
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [items, busy]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ(''); setBusy(true);
    try {
      const r = await req('/api/ai/help', { method: 'POST', json: {
        question, history: items.filter((x) => x.a).slice(-4),
        screen: { path: location.pathname + location.search, title: document.title, view },
      } });
      setItems((cur) => [...cur, { q: question, a: r.answer }]);
    } catch (e) { setItems((cur) => [...cur, { q: question, err: e.message }]); }
    finally { setBusy(false); }
  };

  return (
    <aside className="ai-panel" role="dialog" aria-label="AI 도움말">
      <div className="ai-head"><b>도움말</b><span className="ai-tag">AI</span>
        <button type="button" className="ai-x" onClick={onClose} title="닫기 (Esc)">✕</button></div>
      <div className="ai-list" ref={listRef}>
        {items.length === 0 && (
          <div className="ai-intro">
            <p>{appName} 사용법을 물어보세요. 지금 보고 있는 화면을 기준으로 답합니다.</p>
            <p className="ai-dim">문서·이슈 내용은 AI에 보내지 않습니다. {appName === 'Gira' ? '이슈를 조건으로 찾으려면 목록의 ‘AI’ 검색을 쓰세요.' : ''}</p>
            {SUGGEST[appName]?.map((s) => <button type="button" key={s} className="ai-sugg" onClick={() => ask(s)}>{s}</button>)}
          </div>)}
        {items.map((it, i) => (
          <div key={i} className="ai-turn">
            <div className="ai-q">{it.q}</div>
            {it.a ? <Answer text={it.a} /> : <div className="ai-err">{it.err}</div>}
          </div>))}
        {busy && <div className="ai-turn"><div className="ai-dim">답을 만드는 중…</div></div>}
      </div>
      <form className="ai-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea value={q} rows={2} placeholder="예: 이 화면에서 필터를 저장하려면?" autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} />
        <button type="submit" className="primary btn btn-primary" disabled={busy || !q.trim()}>묻기</button>
      </form>
    </aside>
  );
}

// Gira 필터 줄: 자연어 → JQL. onApply(jql)로 목록에 적용한다
export function AiSearchBar({ project, onApply, onClose }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null); // { jql, explanation, assumptions, answerable } | { error }
  const run = async (e) => {
    e?.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setRes(null);
    try {
      const r = await req('/api/ai/jql', { method: 'POST', json: { project, question } });
      setRes(r);
      if (r.answerable && r.jql) onApply(r.jql);
    } catch (err) { setRes({ error: err.message }); } finally { setBusy(false); }
  };
  return (
    <div className="ai-search">
      <form onSubmit={run} className="ai-search-row">
        <span className="ai-tag">AI</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="자연어로 찾기 — 예: 2026년에 완료한 이슈, 중복·닫음 제외" />
        <button type="submit" className="primary" disabled={busy || !q.trim()}>{busy ? '찾는 중…' : '찾기'}</button>
        <button type="button" className="ai-x" title="닫기" onClick={onClose}>✕</button>
      </form>
      {res?.error && <div className="ai-err">{res.error}</div>}
      {res && !res.error && (
        <div className="ai-result">
          <div>{res.answerable ? res.explanation : `검색 조건으로 바꿀 수 없는 질문입니다 — ${res.explanation} (사용법은 상단 ?)`}</div>
          {res.assumptions?.length > 0 && <ul>{res.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          {res.jql && <div className="ai-dim">적용한 JQL은 아래 JQL 입력칸에 있습니다 — 고쳐서 다시 '적용'하거나 '현재 필터 저장'할 수 있습니다.</div>}
        </div>)}
    </div>
  );
}

// 설정 › AI 도움말 지침 (사이트 관리자): 도움말이 참고하는 사용 안내. 비우고 저장하면 기본값으로
export function AiGuideBody() {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { req('/api/ai/help/guide').then((r) => { setD(r); setText(r.text); }).catch((e) => setMsg(e.message)); }, []);
  const save = async (value) => {
    setMsg('');
    try { const r = await req('/api/ai/help/guide', { method: 'PUT', json: { text: value } }); setD((x) => ({ ...x, custom: r.custom })); setMsg('저장했습니다 — 다음 질문부터 반영됩니다'); }
    catch (e) { setMsg(e.message); }
  };
  if (!d) return <div className="ai-dim">{msg || '불러오는 중…'}</div>;
  return (
    <div className="ai-guide">
      <p className="ai-dim">AI 도움말이 답할 때 참고하는 사용 안내입니다 (Gira·Gonfluence 공통). 새 기능이 생기면 여기에 적어 주세요.
        {d.custom ? ' 지금은 고친 판을 씁니다.' : ' 지금은 기본 안내를 씁니다.'}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="ai-guide-acts">
        <button type="button" className="primary btn btn-primary" onClick={() => save(text)}>저장</button>
        <button type="button" className="btn" onClick={() => { setText(d.base); save(d.base); }}>기본값으로</button>
        {msg && <span className="ai-dim">{msg}</span>}
      </div>
    </div>
  );
}
