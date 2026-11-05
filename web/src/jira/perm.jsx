// 프로젝트 접근 제어 UI: 권한 편집(관리자), 접근 요청 승인함, 접근 요청 게이트
import React, { useEffect, useState } from 'react';
import { api } from './util.jsx';

const TYPE_LABEL = { user: '사용자', group: '그룹', team: '팀', anyone: '전체' };
const ROLE_LABEL = { viewer: '보기', editor: '편집', admin: '관리' };

function PrincipalPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/principals?q=' + encodeURIComponent(q), { quiet: true }).then(setRes).catch(() => setRes(null));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const items = res ? [...(res.teams ?? []), ...(res.groups ?? []), ...(res.users ?? [])] : [];
  return (
    <div className="ppicker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="사용자·그룹·팀 검색해서 추가" />
      {!!items.length && (
        <ul className="ppicker-list">
          {items.slice(0, 10).map((i) => (
            <li key={i.type + i.id}>
              <button type="button" onClick={() => { onPick(i); setQ(''); }}>
                <span className={'ptag ptag-' + i.type}>{TYPE_LABEL[i.type]}</span> {i.name}
                {i.email && <span className="muted2"> {i.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 프로젝트 권한 편집 (프로젝트 관리자·사이트 관리자)
export function ProjectPermissionsModal({ project, onClose }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/api/projects/${encodeURIComponent(project)}/permissions`)
      .then((rs) => setRows(rs.map((r) => ({ type: r.principal_type, id: Number(r.principal_id), role: r.role, name: r.name }))))
      .catch(() => onClose());
  }, [project]);

  const add = (p) => {
    if (rows.some((r) => r.type === p.type && r.id === Number(p.id))) return;
    setRows([...rows, { type: p.type, id: Number(p.id), role: 'viewer', name: p.name }]);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/permissions`, {
        method: 'PUT', json: { rows: rows.map((r) => ({ principalType: r.type, principalId: r.id, role: r.role })) },
      });
      onClose(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="modal perm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>프로젝트 권한 — {project}</h2>
        <p className="muted2">규칙이 하나도 없으면 사이트 관리자만 접근할 수 있는 비공개 상태입니다.
          팀에 준 권한은 하위 파트 소속원에게도 적용됩니다.</p>
        {!rows ? <p className="muted2">불러오는 중…</p> : <>
          <table className="perm-table">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.type + r.id}>
                  <td><span className={'ptag ptag-' + r.type}>{TYPE_LABEL[r.type]}</span></td>
                  <td className="perm-name">{r.name}</td>
                  <td>
                    <select value={r.role} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><button className="plain linklike" onClick={() => setRows(rows.filter((_, j) => j !== i))}>삭제</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="muted2">부여된 권한이 없습니다 (비공개)</td></tr>}
            </tbody>
          </table>
          <div className="perm-add">
            <PrincipalPicker onPick={add} />
            {!rows.some((r) => r.type === 'anyone') && (
              <button className="plain linklike" onClick={() => add({ type: 'anyone', id: 0, name: '로그인한 모든 사용자' })}>
                + 전체 공개 규칙 추가
              </button>
            )}
          </div>
        </>}
        <div className="modal-actions">
          <button className="plain" onClick={() => onClose()}>취소</button>
          <button className="primary" disabled={busy || !rows} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

// 접근 요청 승인함 (내가 관리자인 프로젝트)
export function InboxModal({ onClose, onDecided }) {
  const [rows, setRows] = useState(null);
  const load = () => api('/api/access-requests/inbox').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const decide = async (r, approve) => {
    await api(`/api/access-requests/${r.id}/decide`, { method: 'POST', json: { approve } });
    load(); onDecided?.();
  };
  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="modal perm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>접근 요청 승인함</h2>
        {!rows ? <p className="muted2">불러오는 중…</p> :
          !rows.length ? <p className="muted2">대기 중인 요청이 없습니다.</p> : (
            <table className="perm-table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.user_name}</strong><div className="muted2">{r.user_email}</div></td>
                    <td>{r.project_key} · {r.want === 'editor' ? '편집' : '보기'}
                      {r.reason && <div className="muted2">{r.reason}</div>}</td>
                    <td className="perm-decide">
                      <button className="primary" onClick={() => decide(r, true)}>승인</button>
                      <button className="plain" onClick={() => decide(r, false)}>거절</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <div className="modal-actions"><button className="plain" onClick={() => onClose()}>닫기</button></div>
      </div>
    </div>
  );
}

// 접근 가능한 프로젝트가 없는 사용자용 게이트: 프로젝트 키로 접근 요청
export function AccessGate({ me, onLogout }) {
  const [key, setKey] = useState('');
  const [want, setWant] = useState('viewer');
  const [reason, setReason] = useState('');
  const [mine, setMine] = useState(null);
  const load = () => api('/api/access-requests/mine', { quiet: true }).then(setMine).catch(() => setMine([]));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    await api('/api/access-requests', {
      method: 'POST', json: { projectKey: key.trim().toUpperCase(), want, reason },
    });
    setKey(''); setReason(''); load();
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h2>🔒 접근 가능한 프로젝트가 없습니다</h2>
        <p className="muted2">{me?.display_name}님, 아직 부여된 프로젝트 권한이 없습니다.
          프로젝트 키를 입력해 관리자에게 접근을 요청하세요.</p>
        <form className="gate-form" onSubmit={submit}>
          <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="프로젝트 키 (예: NEXT)" />
          <select value={want} onChange={(e) => setWant(e.target.value)}>
            <option value="viewer">보기</option>
            <option value="editor">편집</option>
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="요청 사유" />
          <button className="primary" type="submit">요청</button>
        </form>
        {mine && mine.length > 0 && (
          <ul className="gate-reqs">
            {mine.map((r) => (
              <li key={r.id}>
                {r.project_key} · {r.want === 'editor' ? '편집' : '보기'} —{' '}
                {r.status === 'pending' ? '대기 중' : r.status === 'approved' ? '승인됨 (새로고침하세요)' : '거절됨'}
              </li>
            ))}
          </ul>
        )}
        <button className="plain linklike" onClick={onLogout}>로그아웃</button>
      </div>
    </div>
  );
}
