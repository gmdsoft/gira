// 홈(추천): 접속 첫 화면 — ① 나에게 할당된 열린 이슈(프로젝트별) ② 최근 본 항목 ③ 프로젝트·보드 바로가기.
// 데이터는 /api/home (접근 가능한 프로젝트 범위만). 최근 본 항목은 브라우저에 남긴 순서(localStorage)를 서버에서 최신 상태로 채운다.
import React, { useEffect, useState } from 'react';
import { api, hashColor, Prio, dt } from './util.jsx';
import { TypeIcon, IconBoard, IconTable, IconBacklog } from './icons.jsx';

function IssueRow({ r, onIssue, showProject }) {
  return (
    <a className="home-row" href={`/browse/${r.issue_key}`} title={r.summary}
      onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); onIssue(r.issue_key); }}>
      <TypeIcon name={r.type_name} />
      <span className="home-key">{r.issue_key}</span>
      <span className="home-sum">{r.summary}</span>
      {showProject && <span className="home-proj">{r.project_name}</span>}
      <Prio p={r.priority} />
      <span className={`badge cat-${r.status_category}`}>{r.status_name ?? '?'}</span>
      <span className="home-when">{dt(r.updated_at)}</span>
    </a>
  );
}

export default function HomeView({ me, meta, recent, onIssue, onProjView, onBoard, onMine }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const recentKeys = recent.map((r) => r.key).join(',');
  useEffect(() => {
    document.title = '홈 - Gira';
    api('/api/home?recent=' + encodeURIComponent(recentKeys), { quiet: true })
      .then(setData).catch((e) => setErr(e.message));
  }, [recentKeys]);

  if (err) return <div className="home"><div className="placeholder">홈을 불러오지 못했습니다: {err}</div></div>;
  if (!data) return <div className="home"><div className="placeholder">불러오는 중…</div></div>;

  // 할당 이슈를 프로젝트별로 묶는다 (서버가 프로젝트 → 우선순위 → 최근 수정 순으로 준다)
  const groups = [];
  for (const r of data.assigned) {
    const g = groups[groups.length - 1];
    if (g?.key === r.project_key) g.rows.push(r);
    else groups.push({ key: r.project_key, name: r.project_name, total: r.project_total, rows: [r] });
  }
  const boardsOf = (pkey) => data.boards.filter((b) => b.project_key === pkey);

  return (
    <div className="home">
      <h2 className="home-title">홈</h2>
      <p className="home-hello">{me?.display_name}님, 안녕하세요.</p>

      <section className="home-sec">
        <h3>나에게 할당됨 <span className="home-count">{data.assignedTotal}</span></h3>
        {!groups.length && <div className="placeholder">할당된 열린 이슈가 없습니다.</div>}
        {groups.map((g) => (
          <div key={g.key} className="home-group">
            <div className="home-ghead">
              <span className="pavatar" style={{ background: hashColor(g.key) }}>{g.key[0]}</span>
              <a href={`/projects/${encodeURIComponent(g.key)}/list`}
                onClick={(e) => { e.preventDefault(); onProjView(g.key, 'list'); }}>{g.name}</a>
              <span className="home-dim">{g.total}건</span>
            </div>
            {g.rows.map((r) => <IssueRow key={r.issue_key} r={r} onIssue={onIssue} />)}
            {g.total > g.rows.length && (
              <button className="plain home-more" onClick={() => onMine(g.key)}>
                {g.total - g.rows.length}건 더 — 이 프로젝트에서 내 담당 이슈 모두 보기</button>
            )}
          </div>
        ))}
      </section>

      <section className="home-sec">
        <h3>최근 본 항목</h3>
        {!data.recent.length
          ? <div className="placeholder">아직 본 이슈가 없습니다.</div>
          : data.recent.map((r) => <IssueRow key={r.issue_key} r={r} onIssue={onIssue} showProject />)}
      </section>

      <section className="home-sec">
        <h3>프로젝트·보드</h3>
        <div className="home-projects">
          {meta.projects.map((p) => (
            <div key={p.key} className="home-pcard">
              <div className="home-pname">
                <span className="pavatar" style={{ background: hashColor(p.key) }}>{p.key[0]}</span>
                <a href={`/projects/${encodeURIComponent(p.key)}/list`} title={`${p.name} (${p.key})`}
                  onClick={(e) => { e.preventDefault(); onProjView(p.key, 'list'); }}>{p.name}</a>
              </div>
              <div className="home-links">
                <button className="plain" onClick={() => onProjView(p.key, 'table')}><IconTable size={14} /> 전체 목록</button>
                <button className="plain" onClick={() => onProjView(p.key, 'backlog')}><IconBacklog size={14} /> 백로그</button>
                {boardsOf(p.key).map((b) => (
                  <button key={b.id} className="plain" onClick={() => onBoard(p.key, String(b.id))} title={`${b.name} 보드`}>
                    <IconBoard size={14} /> {b.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
