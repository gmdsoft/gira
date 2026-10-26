import React, { useEffect, useState } from 'react';
import { api } from './api.js';

export default function SearchView({ navigate }) {
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [space, setSpace] = useState(params.get('space') ?? '');
  const [spaces, setSpaces] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api('/api/spaces').then(setSpaces).catch(() => {}); }, []);

  const run = async (query, spaceKey) => {
    if (!query.trim()) return;
    setError(null);
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(query)}${spaceKey ? `&space=${encodeURIComponent(spaceKey)}` : ''}`);
      setResult(r);
      history.replaceState(null, '', `/search?q=${encodeURIComponent(query)}${spaceKey ? `&space=${spaceKey}` : ''}`);
    } catch (e) {
      setError('검색 엔진에 연결할 수 없습니다.');
    }
  };

  useEffect(() => { if (q.trim()) run(q, space); }, []);

  return (
    <div className="search-page">
      <h1>검색</h1>
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); run(q, space); }}>
        <input autoFocus className="search-input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="검색어 (한국어 형태소 분석 지원)" />
        <select className="tb-select" value={space} onChange={(e) => { setSpace(e.target.value); run(q, e.target.value); }}>
          <option value="">모든 스페이스</option>
          {spaces.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">검색</button>
      </form>
      {error && <p className="page-error">{error}</p>}
      {result && (
        <>
          <p className="muted">{result.total}건</p>
          {result.hits.map((h) => (
            <div key={h.id} className="search-result">
              <a href={`/s/${h.spaceKey}/p/${h.id}`}
                 onClick={(e) => { e.preventDefault(); navigate(`/s/${h.spaceKey}/p/${h.id}`); }}
                 dangerouslySetInnerHTML={{ __html: h.titleHtml ?? escapeHtml(h.title) }} />
              <span className="search-space">{h.spaceKey}{h.type !== 'page' ? ` · ${h.type}` : ''}</span>
              {h.excerpts.map((ex, i) => (
                <p key={i} className="search-excerpt" dangerouslySetInnerHTML={{ __html: ex }} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
