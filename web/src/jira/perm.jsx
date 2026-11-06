// 프로젝트 접근 제어 UI: 설정 허브(API 키·패키지·셀프 이관·권한·승인함) + 접근 요청 게이트
import React, { useEffect, useState } from 'react';
import { api } from './util.jsx';
import { MigrateBody } from '../migrate-ui.jsx';
import { NotifyRulesBody } from '../notify-ui.jsx';
import { ProfileBody } from '../profile-ui.jsx';

const TYPE_LABEL = { user: '사용자', group: '그룹', team: '팀', anyone: '전체' };
const ROLE_LABEL = { viewer: '보기', editor: '편집', admin: '관리' };

// 복수 선택 추가: 검색 결과에 체크박스를 두고, 선택을 모아 한꺼번에 추가한다.
// (검색어를 바꿔도 선택은 유지된다)
function PrincipalPicker({ onAdd, exclude }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(new Map()); // 'type:id' -> item
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/principals?q=' + encodeURIComponent(q), { quiet: true }).then(setRes).catch(() => setRes(null));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const [tab, setTab] = useState('team'); // team | part | group | user
  const keyOf = (i) => i.type + ':' + i.id;
  const byTab = {
    team: (res?.teams ?? []).filter((t) => !t.part),
    part: (res?.teams ?? []).filter((t) => t.part),
    group: res?.groups ?? [],
    user: res?.users ?? [],
  };
  const items = (byTab[tab] ?? []).filter((i) => !exclude?.has(keyOf(i)));
  const toggle = (i) => {
    const m = new Map(sel);
    if (m.has(keyOf(i))) m.delete(keyOf(i)); else m.set(keyOf(i), i);
    setSel(m);
  };
  return (
    <div className="ppicker">
      <div className="ppicker-tabs">
        {[['team', '팀'], ['part', '파트'], ['group', '그룹'], ['user', '사용자']].map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색" />
      <ul className="ppicker-list static">
        {items.map((i) => (
          <li key={keyOf(i)}>
            <label>
              <input type="checkbox" checked={sel.has(keyOf(i))} onChange={() => toggle(i)} />
              <span className={'ptag ptag-' + i.type}>{TYPE_LABEL[i.type]}</span>
              <span className="ppick-name">{i.name}</span>
              {i.email && <span className="muted2">{i.email}</span>}
            </label>
          </li>
        ))}
        {!items.length && <li className="muted2 ppick-empty">검색 결과가 없습니다</li>}
      </ul>
      <button type="button" className="primary ppicker-add" disabled={!sel.size}
        onClick={() => { onAdd([...sel.values()]); setSel(new Map()); }}>
        선택한 {sel.size}개 추가
      </button>
    </div>
  );
}

// 프로젝트 권한 편집 (프로젝트 관리자·사이트 관리자) — 설정 허브의 한 탭
export function PermissionsBody({ project }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setRows(null); setSaved(false);
    api(`/api/projects/${encodeURIComponent(project)}/permissions`)
      .then((rs) => setRows(rs.map((r) => ({ type: r.principal_type, id: Number(r.principal_id), role: r.role, name: r.name }))))
      .catch(() => setRows([]));
  }, [project]);

  const add = (picked) => {
    const next = [...rows];
    for (const p of [].concat(picked)) {
      if (!next.some((r) => r.type === p.type && r.id === Number(p.id))) {
        next.push({ type: p.type, id: Number(p.id), role: 'viewer', name: p.name });
      }
    }
    setRows(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/permissions`, {
        method: 'PUT', json: { rows: rows.map((r) => ({ principalType: r.type, principalId: r.id, role: r.role })) },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  };

  return (
    <div className="hub-pane">
      <p className="muted2">규칙이 하나도 없으면 사이트 관리자만 접근할 수 있는 비공개 상태입니다.
        팀에 준 권한은 하위 파트 소속원에게도 적용됩니다.</p>
      {!rows ? <p className="muted2">불러오는 중…</p> : <div className="perm-body">
        <div className="perm-rows">
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
            {!rows.some((r) => r.type === 'anyone') && (
              <button className="plain linklike" onClick={() => add({ type: 'anyone', id: 0, name: '로그인한 모든 사용자' })}>
                + 전체 공개 규칙 추가
              </button>
            )}
          </div>
          <PrincipalPicker onAdd={add} exclude={new Set(rows.map((r) => r.type + ':' + r.id))} />
        </div>}
      <div className="modal-actions">
        {saved && <span className="muted2">✓ 저장됨</span>}
        <button className="primary" disabled={busy || !rows} onClick={save}>저장</button>
      </div>
    </div>
  );
}

// 접근 요청 승인함 (내가 관리자인 프로젝트) — 설정 허브의 한 탭
export function InboxBody({ onDecided }) {
  const [rows, setRows] = useState(null);
  const load = () => api('/api/access-requests/inbox').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const decide = async (r, approve) => {
    await api(`/api/access-requests/${r.id}/decide`, { method: 'POST', json: { approve } });
    load(); onDecided?.();
  };
  return (
    <div className="hub-pane">
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
    </div>
  );
}

// 내 API 키: 셀프 발급(1회 평문 표시)·회수 — 이 앱 전용 Bearer 토큰. 설정 허브의 한 탭
export function ApiKeysBody() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState(null); // {token}
  const [copied, setCopied] = useState(false);
  const load = () => api('/api/me/apikeys').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const issue = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await api('/api/me/apikeys', { method: 'POST', json: { name } });
    setIssued(r); setName(''); setCopied(false); load();
  };
  const revoke = async (k) => {
    if (!confirm(`'${k.name}' 키를 회수할까요? 이 키를 쓰는 연동은 즉시 끊깁니다.`)) return;
    await api('/api/me/apikeys/' + k.id, { method: 'DELETE' });
    load();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.token); setCopied(true); } catch { /* 무시 */ }
  };

  return (
    <div className="hub-pane">
      <p className="muted2">외부 도구에서 <code>Authorization: Bearer &lt;키&gt;</code> 로 호출합니다 (엔드포인트: /api/v1/* — docs/api-v1.md).
        키는 내 권한으로 동작하며 이 앱에서만 유효합니다.</p>
        {issued && (
          <div className="key-issued">
            <code>{issued.token}</code>
            <button className="primary" onClick={copy}>{copied ? '✓ 복사됨' : '복사'}</button>
            <div className="muted2">이 키는 지금만 표시됩니다 — 복사해 두세요.</div>
          </div>
        )}
        <div className="perm-body">
          <div className="perm-rows">
            <table className="perm-table">
              <tbody>
                {(rows ?? []).map((k) => (
                  <tr key={k.id} style={k.revoked_at ? { opacity: .5 } : null}>
                    <td><code>{k.prefix}…</code></td>
                    <td className="perm-name">{k.name}
                      <div className="muted2">{new Date(k.created_at).toLocaleDateString('ko-KR')} 발급
                        {k.last_used_at ? ` · 마지막 사용 ${new Date(k.last_used_at).toLocaleDateString('ko-KR')}` : ' · 미사용'}</div></td>
                    <td>{k.revoked_at ? <span className="muted2">회수됨</span>
                      : <button className="plain linklike" onClick={() => revoke(k)}>회수</button>}</td>
                  </tr>
                ))}
                {rows && !rows.length && <tr><td className="muted2">발급한 키가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
          <form className="key-form" onSubmit={issue}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="키 이름 (예: CI 연동)" />
            <button className="primary" type="submit">발급</button>
          </form>
        </div>
    </div>
  );
}

// 패키지: 현재 프로젝트 내보내기(.zip) + 패키지 가져오기 — 설정 허브의 한 탭
export function PackageBody({ project, projectRole, canCreate, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/projects/import', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) { alert(body.error ?? '가져오기 실패'); return; }
      setResult(body);
      onImported?.();
    } finally { setBusy(false); }
  };
  return (
    <div className="hub-pane">
      <h3>내보내기</h3>
      {projectRole === 'admin' ? (
        <p>현재 프로젝트 전체(이슈·댓글·첨부·스프린트·보드·기록)를 패키지로 받습니다.{' '}
          <button className="primary" onClick={() => window.open(`/api/projects/${encodeURIComponent(project)}/export`)}>
            {project} 내보내기 (.zip)
          </button>
        </p>
      ) : <p className="muted2">내보내기는 프로젝트 관리자만 할 수 있습니다.</p>}
      <h3>가져오기</h3>
      {!canCreate ? <p className="muted2">가져오기는 팀장·파트장 또는 지정 그룹만 할 수 있습니다.</p> : <>
        <p className="muted2">Gira에서 내보낸 프로젝트 패키지(.zip)를 올립니다.
          같은 키의 프로젝트가 이미 있으면 가져올 수 없습니다. 가져온 사람이 프로젝트 관리자가 됩니다.</p>
        {result ? (
          <p><strong>{result.projectKey}</strong> 가져오기 완료 — 이슈 {result.counts.issues}개,
            댓글 {result.counts.comments}개, 첨부 {result.counts.attachments}개</p>
        ) : (
          <form onSubmit={submit} className="key-form">
            <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="primary" type="submit" disabled={!file || busy}>{busy ? '가져오는 중…' : '가져오기'}</button>
          </form>
        )}
      </>}
    </div>
  );
}

// 설정 허브: 톱니 메뉴의 '설정…'에서 열리는 팝업 — 좌측 탭 + 우측 내용
export function SettingsHub({ me, meta, project, onClose, onChanged, onMeChanged }) {
  const proj = meta.projects.find((p) => p.key === project);
  const tabs = [
    ['profile', '프로필', true],
    ['keys', '내 API 키', true],
    ['pkg', '패키지 (내보내기/가져오기)', true],
    ['migrate', '원본 Jira에서 가져오기', !!me?.can_create],
    ['perm', '프로젝트 권한', proj?.role === 'admin'],
    ['notify', '프로젝트 알림', proj?.role === 'admin'],
    ['inbox', '접근 요청 승인함', meta.projects.some((p) => p.role === 'admin')],
  ].filter((t) => t[2]);
  const [tab, setTab] = useState(tabs[0][0]);
  const TITLE = Object.fromEntries(tabs.map(([k, n]) => [k, n]));
  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="settings-hub" onClick={(e) => e.stopPropagation()}>
        <aside className="hub-side">
          <div className="hub-title">설정</div>
          {tabs.map(([k, name]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name}</button>
          ))}
          {me?.is_admin && (
            <button className="hub-ext" onClick={() => window.open(`//${location.hostname}:3003/`, '_blank')}>
              조직 관리 ↗
            </button>
          )}
          <button className="hub-close" onClick={() => onClose()}>닫기</button>
        </aside>
        <section className="hub-main">
          <h2>{TITLE[tab]}{tab === 'perm' || tab === 'notify' ? ` — ${project}` : ''}</h2>
          {tab === 'profile' && <ProfileBody me={me} onChanged={onMeChanged ?? onChanged} />}
          {tab === 'keys' && <ApiKeysBody />}
          {tab === 'pkg' && <PackageBody project={project} projectRole={proj?.role}
            canCreate={!!me?.can_create} onImported={onChanged} />}
          {tab === 'migrate' && <MigrateBody api={api} resourceLabel="프로젝트"
            btn="plain linklike" btnPrimary="primary" onDone={onChanged} />}
          {tab === 'perm' && <PermissionsBody project={project} />}
          {tab === 'notify' && <NotifyRulesBody key={project} resourceKey={project} resourceLabel="프로젝트" />}
          {tab === 'inbox' && <InboxBody />}
        </section>
      </div>
    </div>
  );
}

// 접근 가능한 프로젝트가 없는 사용자용 게이트: 프로젝트 키로 접근 요청
export function AccessGate({ me, onLogout, onCreate }) {
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
        {onCreate && <button className="primary" onClick={onCreate}>프로젝트 만들기</button>}
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


export function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = (items) => setRows((prev) => {
    const next = [...prev];
    for (const p of items) if (!next.some((r) => r.type === p.type && r.id === Number(p.id))) {
      next.push({ ...p, id: Number(p.id), role: 'viewer' });
    }
    return next;
  });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    let created;
    try {
      created = await api('/api/projects', { method: 'POST', quiet: true, json: {
        name, key, description,
        rows: rows.map((r) => ({ principalType: r.type, principalId: r.id, role: r.role })),
      } });
    } catch (err) { setError(err.message); setBusy(false); return; }
    onCreated(created);
  };
  return <div className="overlay on"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
    <h2 id="new-project-title">프로젝트 만들기</h2>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="project-create-fields">
        <label>이름<input type="text" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>키<input type="text" required pattern="[A-Z][A-Z0-9]{1,19}" maxLength={20} value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())} />
          <span className="muted2">영문 대문자로 시작하는 대문자·숫자 2~20자</span></label>
        <label>설명<textarea maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <h3>접근 범위</h3>
        <p className="muted2">생성자는 프로젝트 관리자가 됩니다. 팀 권한은 하위 파트에도 적용됩니다.</p>
        {rows.map((r, i) => <div className="project-create-grant" key={r.type + ':' + r.id}>
          <span>{r.name}</span>
          <select aria-label={r.name + ' 접근 등급'} value={r.role} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}>
            {Object.entries(ROLE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>삭제</button>
        </div>)}
        {!rows.some((r) => r.type === 'anyone') && <button type="button" onClick={() => add([{ type: 'anyone', id: 0, name: '전사 공개' }])}>+ 전사 공개</button>}
        <PrincipalPicker onAdd={add} exclude={new Set(rows.map((r) => r.type + ':' + r.id))} />
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onClose}>취소</button>
        <button className="primary" disabled={busy} type="submit">{busy ? '만드는 중…' : '프로젝트 만들기'}</button>
      </div>
    </form>
  </section></div>;
}
