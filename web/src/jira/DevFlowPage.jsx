// 개발참여 자동 처리 현황 (새 탭 /dev-flow) — 관리자·GIRA 프로젝트 관리자·기본 담당자 전용
// 이슈 단계별 목록, 테스트 서버, 감시기 상태, 최근 실행 기록(감시기 요약 줄). 15초마다 새로 고친다.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './util.jsx';

const GROUPS = [
  ['attention', '확인 필요', '처리 실패나 머지 충돌 — 확인 후 agent-failed / merge-conflict 레이블을 지우면 다시 진행합니다.'],
  ['running', '처리 중', '처리 에이전트가 지금 작업하고 있습니다.'],
  ['queued', '다음 처리 대상', '감시기가 다음 실행 때 처리합니다.'],
  ['review', '보고자 검토 중', '테스트 서버가 떠 있고 보고자의 확인을 기다립니다.'],
  ['waitingApproval', '승인 대기', '기본 담당자가 needs-approval 레이블을 지우면 시작합니다.'],
  ['waitingInfo', '답변 대기', '보고자가 이슈 댓글로 답하면 이어서 처리합니다.'],
  ['merged', '최근 머지됨', 'develop에 머지된 이슈 (최근 10건) — 운영 반영은 관리자가 합니다.'],
];

const ago = (s) => {
  if (!s) return '';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
};

function State({ ok, children, warn }) {
  return <span className={`df-state ${ok ? 'ok' : warn ? 'warn' : 'off'}`}>{children}</span>;
}

function IssueRow({ it }) {
  return (
    <tr>
      <td className="df-key"><a href={`/browse/${encodeURIComponent(it.key)}`} target="_blank" rel="noreferrer">{it.key}</a></td>
      <td>
        <div className="df-sum">{it.summary}</div>
        <div className="muted2 df-meta">
          {it.status}{it.assignee ? ` · 담당 ${it.assignee}` : ''}{it.reporter ? ` · 보고 ${it.reporter}` : ''}
          {it.actionLabel ? ` · ${it.actionLabel}` : ''}{it.reason ? ` · ${it.reason}` : ''}
        </div>
      </td>
      <td className="df-servers">
        {it.testServer?.map((s) => (
          <a key={s.port} href={s.url} target="_blank" rel="noreferrer" className={s.alive ? '' : 'df-dead'} title={s.alive ? '' : '꺼져 있음'}>
            {s.app} :{s.port}{s.alive ? '' : ' (꺼짐)'}
          </a>
        ))}
      </td>
      <td className="muted2 df-when">{ago(it.updatedAt)}</td>
    </tr>
  );
}

export default function DevFlowPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => {
    api('/api/dev-flow/status', { quiet: true }).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.body?.error ?? e.message));
  }, []);
  useEffect(() => {
    document.title = '자동 처리 현황 — Gira';
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (err && !data) return <div className="df-page"><h1>자동 처리 현황</h1><p className="muted2">{err}</p></div>;
  if (!data) return <div className="df-page"><h1>자동 처리 현황</h1><p className="muted2">불러오는 중…</p></div>;
  const { watcher, groups, testServers, log } = data;
  const total = GROUPS.reduce((n, [k]) => n + (k === 'merged' ? 0 : groups[k].length), 0);

  return (
    <div className="df-page">
      <div className="df-head">
        <h1>자동 처리 현황</h1>
        <span className="muted2">개발참여 이슈 · {ago(data.now)} 갱신 (15초마다)</span>
        <span className="df-sp" />
        <button className="plain" onClick={load}>새로 고침</button>
      </div>

      <section className="df-card df-status">
        <div><span className="muted2">즉시 실행(Gira 서버)</span><State ok={watcher.enabled}>{watcher.enabled ? '켜짐' : '꺼짐 (DEV_FLOW)'}</State></div>
        <div><span className="muted2">5분 안전망(cron)</span><State ok={watcher.cron} warn={!watcher.cron}>{watcher.cron ? '등록됨' : '미등록'}</State></div>
        <div><span className="muted2">감시기</span><State ok={watcher.running} warn={false}>{watcher.running ? '실행 중' : '대기'}</State></div>
        <div><span className="muted2">진행 중인 이슈</span><b>{total}건</b></div>
        <div><span className="muted2">테스트 서버</span><b>{testServers.reduce((n, s) => n + s.apps.filter((a) => a.alive).length, 0)}개</b></div>
      </section>

      {GROUPS.map(([k, title, help]) => groups[k].length > 0 && (
        <section key={k} className={`df-card df-group df-${k}`}>
          <h2>{title} <span className="df-count">{groups[k].length}</span></h2>
          <p className="muted2 df-help">{help}</p>
          <table className="perm-table df-table"><tbody>{groups[k].map((it) => <IssueRow key={it.key} it={it} />)}</tbody></table>
        </section>
      ))}
      {total === 0 && !groups.merged.length && <section className="df-card"><p className="muted2">진행 중인 개발참여 이슈가 없습니다.</p></section>}

      <section className="df-card">
        <h2>최근 실행 기록</h2>
        <p className="muted2 df-help">감시기 요약 줄만 보여 줍니다. 처리 에이전트의 전체 출력은 서버 로그(logs/dev-flow/)에 있습니다.</p>
        {log.length === 0 ? <p className="muted2">기록이 없습니다.</p> : (
          <table className="perm-table df-table df-log"><tbody>
            {log.map((l, i) => (
              <tr key={i}>
                <td className="muted2 df-when" title={new Date(l.at).toLocaleString()}>{new Date(l.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="df-key">{l.key && <a href={`/browse/${encodeURIComponent(l.key)}`} target="_blank" rel="noreferrer">{l.key}</a>}</td>
                <td>{l.text}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
    </div>
  );
}
