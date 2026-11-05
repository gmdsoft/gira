// 접근 제어 UI 공용: 대상(사용자/그룹/팀) 검색, 스페이스 권한 편집, 문서 제한 편집,
// 접근 요청 화면, 스페이스 만들기 다이얼로그
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { MigrateBody } from './migrate-ui.jsx';
import { RequestsTab } from './Admin.jsx';

export const TYPE_LABEL = { user: '사용자', group: '그룹', team: '팀', anyone: '전체' };
export const ROLE_LABEL = { viewer: '보기', editor: '편집', admin: '관리' };

// 사용자·그룹·팀 통합 검색 — 체크박스 복수 선택 후 한꺼번에 추가 → onAdd([{type,id,name}...])
// 검색어를 바꿔도 선택은 유지된다.
export function PrincipalPicker({ onAdd, exclude }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(new Map()); // 'type:id' -> item
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/principals?q=' + encodeURIComponent(q)).then(setRes).catch(() => setRes(null));
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
              <span>{i.name}</span>
              {i.email && <span className="muted">{i.email}</span>}
            </label>
          </li>
        ))}
        {!items.length && <li className="muted ppick-empty">검색 결과가 없습니다</li>}
      </ul>
      <button type="button" className="btn btn-primary ppicker-add" disabled={!sel.size}
        onClick={() => { onAdd([...sel.values()]); setSel(new Map()); }}>
        선택한 {sel.size}개 추가
      </button>
    </div>
  );
}

// 스페이스 권한 편집 (role: viewer/editor/admin, 대상: user/group/team/anyone)
export function SpacePermissionsModal({ spaceKey, onClose }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/api/spaces/${spaceKey}/permissions`)
      .then((rs) => setRows(rs.map((r) => ({ type: r.principal_type, id: Number(r.principal_id), role: r.role, name: r.name }))))
      .catch((e) => { alert(e.message); onClose(); });
  }, [spaceKey]);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/spaces/${spaceKey}/permissions`, {
        method: 'PUT',
        json: { rows: rows.map((r) => ({ principalType: r.type, principalId: r.id, role: r.role })) },
      });
      onClose(true);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal perm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>스페이스 권한 — {spaceKey}</h2>
        <p className="muted">규칙이 하나도 없으면 사이트 관리자만 접근할 수 있는 비공개 상태입니다.
          팀에 준 권한은 하위 파트 소속원에게도 적용됩니다.</p>
        {!rows ? <p className="muted">불러오는 중…</p> : (
          <PermRows rows={rows} setRows={setRows} allowAnyone roles={['viewer', 'editor', 'admin']} />
        )}
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose()}>취소</button>
          <button className="btn btn-primary" disabled={busy || !rows} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

function PermRows({ rows, setRows, allowAnyone, roles }) {
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i) => setRows(rows.filter((_, j) => j !== i));
  const add = (picked) => {
    const next = [...rows];
    for (const p of [].concat(picked)) {
      if (!next.some((r) => r.type === p.type && r.id === Number(p.id))) {
        next.push({ type: p.type, id: Number(p.id), role: 'viewer', name: p.name });
      }
    }
    setRows(next);
  };
  return (
    <>
      <div className="perm-rows">
        <table className="perm-table">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.type + r.id}>
                <td><span className={'ptag ptag-' + r.type}>{TYPE_LABEL[r.type]}</span></td>
                <td className="perm-name">{r.name}</td>
                <td>
                  <select value={r.role} onChange={(e) => upd(i, { role: e.target.value })}>
                    {roles.map((ro) => <option key={ro} value={ro}>{ROLE_LABEL[ro]}</option>)}
                  </select>
                </td>
                <td><button type="button" className="btn btn-xs" onClick={() => del(i)}>삭제</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">부여된 권한이 없습니다 (비공개)</td></tr>}
          </tbody>
        </table>
        {allowAnyone && !rows.some((r) => r.type === 'anyone') && (
          <button type="button" className="btn btn-xs" onClick={() => add({ type: 'anyone', id: 0, name: '로그인한 모든 사용자' })}>
            + 전체 공개 규칙
          </button>
        )}
      </div>
      <PrincipalPicker onAdd={add} exclude={new Set(rows.map((r) => r.type + ':' + r.id))} />
    </>
  );
}

// 문서(페이지) 접근 제한 편집: 보기 제한(하위 상속) / 편집 제한(해당 문서만)
export function RestrictionsModal({ pageId, onClose }) {
  const [data, setData] = useState(null); // {restrictions, inheritedFrom, canEdit}
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/api/content/${pageId}/restrictions`).then((d) => {
      setData(d);
      setRows(d.restrictions.map((r) => ({ rtype: r.rtype, type: r.principal_type, id: Number(r.principal_id), name: r.name })));
    }).catch((e) => { alert(e.message); onClose(); });
  }, [pageId]);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/content/${pageId}/restrictions`, {
        method: 'PUT',
        json: { restrictions: rows.map((r) => ({ rtype: r.rtype, principalType: r.type, principalId: r.id })) },
      });
      onClose(true);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const section = (rtype, title, hint) => (
    <section className="restr-sec">
      <h3>{title} <span className="muted">{hint}</span></h3>
      <ul className="restr-list">
        {rows.filter((r) => r.rtype === rtype).map((r) => (
          <li key={r.type + r.id}>
            <span className={'ptag ptag-' + r.type}>{TYPE_LABEL[r.type]}</span> {r.name}
            <button className="btn btn-xs" onClick={() => setRows(rows.filter((x) => !(x.rtype === rtype && x.type === r.type && x.id === r.id)))}>삭제</button>
          </li>
        ))}
        {!rows.some((r) => r.rtype === rtype) && <li className="muted">제한 없음 — 스페이스 권한을 따릅니다</li>}
      </ul>
      <PrincipalPicker exclude={new Set(rows.filter((r) => r.rtype === rtype).map((r) => r.type + ':' + r.id))}
        onAdd={(picked) => {
          const next = [...rows];
          for (const p of picked) {
            if (!next.some((r) => r.rtype === rtype && r.type === p.type && r.id === Number(p.id))) {
              next.push({ rtype, type: p.type, id: Number(p.id), name: p.name });
            }
          }
          setRows(next);
        }} />
    </section>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal perm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>접근 제한</h2>
        {!data ? <p className="muted">불러오는 중…</p> : <>
          {data.inheritedFrom?.length > 0 && (
            <p className="muted">상위 페이지의 보기 제한이 상속됩니다: {data.inheritedFrom.map((p) => p.title).join(', ')}</p>
          )}
          {section('view', '보기 제한', '(지정하면 이 사람들만 — 하위 페이지에 상속)')}
          {section('edit', '편집 제한', '(지정하면 이 사람들만 — 이 문서에만 적용)')}
        </>}
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose()}>취소</button>
          <button className="btn btn-primary" disabled={busy || !data} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

// 권한 없는 스페이스 → 접근 요청 화면
export function RequestAccessView({ spaceKey }) {
  const [want, setWant] = useState('viewer');
  const [reason, setReason] = useState('');
  const [mine, setMine] = useState(null);
  const [sent, setSent] = useState(false);
  const load = () => api('/api/access-requests/mine').then(setMine).catch(() => setMine([]));
  useEffect(() => { load(); }, []);
  const pending = mine?.find((r) => r.space_key === spaceKey && r.status === 'pending');
  const decided = mine?.filter((r) => r.space_key === spaceKey && r.status !== 'pending') ?? [];

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/access-requests', { method: 'POST', json: { spaceKey, want, reason } });
      setSent(true); load();
    } catch (err) { alert(err.message); }
  };

  return (
    <article className="page request-access">
      <h1>🔒 접근 권한이 필요합니다</h1>
      <p>스페이스 <strong>{spaceKey}</strong> 를 볼 수 있는 권한이 없습니다.
        관리자에게 접근을 요청할 수 있습니다.</p>
      {pending || sent ? (
        <p className="req-sent">✅ 요청을 보냈습니다. 관리자가 승인하면 접근할 수 있습니다.</p>
      ) : (
        <form className="req-form" onSubmit={submit}>
          <label>필요한 권한
            <select value={want} onChange={(e) => setWant(e.target.value)}>
              <option value="viewer">보기</option>
              <option value="editor">편집</option>
            </select>
          </label>
          <label>요청 사유
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="어떤 업무로 필요한지 적어주세요" />
          </label>
          <button className="btn btn-primary" type="submit">접근 요청 보내기</button>
        </form>
      )}
      {decided.length > 0 && (
        <p className="muted">이전 요청: {decided.map((r) =>
          `${r.status === 'approved' ? '승인됨' : '거절됨'} (${new Date(r.decided_at).toLocaleDateString('ko-KR')})`).join(', ')}</p>
      )}
    </article>
  );
}

// 내 API 키: 셀프 발급(1회 평문 표시)·회수 — 이 앱 전용 Bearer 토큰. 설정 허브의 한 탭
export function ApiKeysBody() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const load = () => api('/api/me/apikeys').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const issue = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await api('/api/me/apikeys', { method: 'POST', json: { name } });
      setIssued(r); setName(''); setCopied(false); load();
    } catch (err) { alert(err.message); }
  };
  const revoke = async (k) => {
    if (!confirm(`'${k.name}' 키를 회수할까요? 이 키를 쓰는 연동은 즉시 끊깁니다.`)) return;
    await api('/api/me/apikeys/' + k.id, { method: 'DELETE' });
    load();
  };

  return (
    <div className="hub-pane">
      <p className="muted">외부 도구에서 <code>Authorization: Bearer &lt;키&gt;</code> 로 호출합니다 (엔드포인트: /api/v1/*).
        키는 내 권한으로 동작하며 이 앱에서만 유효합니다.</p>
        {issued && (
          <div className="key-issued">
            <code>{issued.token}</code>
            <button className="btn btn-primary" onClick={async () => {
              try { await navigator.clipboard.writeText(issued.token); setCopied(true); } catch { /* 무시 */ }
            }}>{copied ? '✓ 복사됨' : '복사'}</button>
            <div className="muted">이 키는 지금만 표시됩니다 — 복사해 두세요.</div>
          </div>
        )}
        <div className="perm-rows">
          <table className="perm-table">
            <tbody>
              {(rows ?? []).map((k) => (
                <tr key={k.id} style={k.revoked_at ? { opacity: .5 } : null}>
                  <td><code>{k.prefix}…</code></td>
                  <td className="perm-name">{k.name}
                    <div className="muted">{new Date(k.created_at).toLocaleDateString('ko-KR')} 발급
                      {k.last_used_at ? ` · 마지막 사용 ${new Date(k.last_used_at).toLocaleDateString('ko-KR')}` : ' · 미사용'}</div></td>
                  <td>{k.revoked_at ? <span className="muted">회수됨</span>
                    : <button className="btn btn-xs" onClick={() => revoke(k)}>회수</button>}</td>
                </tr>
              ))}
              {rows && !rows.length && <tr><td className="muted">발급한 키가 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
        <form className="team-add" onSubmit={issue}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="키 이름 (예: CI 연동)" />
          <button className="btn btn-primary" type="submit">발급</button>
        </form>
    </div>
  );
}

// 패키지: 현재 스페이스 내보내기(.zip) + 패키지 가져오기 — 설정 허브의 한 탭
export function SpacePackageBody({ spaceKey, spaceRole, canCreate, onImported }) {
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
      const res = await fetch('/api/spaces/import', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) { alert(body.error ?? '가져오기 실패'); return; }
      setResult(body);
      onImported?.(body);
    } finally { setBusy(false); }
  };
  return (
    <div className="hub-pane">
      <h3>내보내기</h3>
      {spaceKey && spaceRole === 'admin' ? (
        <p>현재 스페이스 전체(페이지 트리·버전 이력·댓글·첨부)를 패키지로 받습니다.{' '}
          <button className="btn btn-primary" onClick={() => window.open(`/api/spaces/${spaceKey}/export`)}>
            {spaceKey} 내보내기 (.zip)
          </button>
        </p>
      ) : <p className="muted">내보내기는 스페이스 안에서, 그 스페이스의 관리자만 할 수 있습니다.</p>}
      <h3>가져오기</h3>
      {!canCreate ? <p className="muted">가져오기는 팀장·파트장 또는 지정 그룹만 할 수 있습니다.</p> : <>
        <p className="muted">Gonfluence에서 내보낸 스페이스 패키지(.zip)를 올립니다.
          같은 키의 스페이스가 이미 있으면 가져올 수 없습니다. 가져온 사람이 스페이스 관리자가 됩니다.</p>
        {result ? (
          <p><strong>{result.spaceKey}</strong> 가져오기 완료 — 페이지 {result.counts.pages}개,
            첨부 {result.counts.attachments}개</p>
        ) : (
          <form onSubmit={submit} className="team-add">
            <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="btn btn-primary" type="submit" disabled={!file || busy}>{busy ? '가져오는 중…' : '가져오기'}</button>
          </form>
        )}
      </>}
    </div>
  );
}

// 설정 허브: 톱니 메뉴의 '설정…'에서 열리는 팝업 — 좌측 탭 + 우측 내용
export function GonfSettingsHub({ me, spaceKey, spaceRole, onClose, navigate }) {
  const tabs = [
    ['keys', '내 API 키', true],
    ['pkg', '패키지 (내보내기/가져오기)', true],
    ['migrate', '원본 Confluence에서 가져오기', true],
    ['inbox', '접근 요청 승인함', !!me.is_admin],
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
          {me.is_admin && (
            <button className="hub-ext" onClick={() => window.open(`//${location.hostname}:3003/`, '_blank')}>
              조직 관리 ↗
            </button>
          )}
          <button className="hub-close" onClick={() => onClose()}>닫기</button>
        </aside>
        <section className="hub-main">
          <h2>{TITLE[tab]}{tab === 'pkg' && spaceKey ? ` — ${spaceKey}` : ''}</h2>
          {tab === 'keys' && <ApiKeysBody />}
          {tab === 'pkg' && <SpacePackageBody spaceKey={spaceKey} spaceRole={spaceRole}
            canCreate={!!me.can_create}
            onImported={(r) => { onClose(); navigate(`/s/${r.spaceKey}`); }} />}
          {tab === 'migrate' && <MigrateBody api={api} resourceLabel="스페이스" />}
          {tab === 'inbox' && <div className="hub-pane"><RequestsTab /></div>}
        </section>
      </div>
    </div>
  );
}

// 스페이스 만들기: 일반(생성 권한 필요, 이름·키·설명·접근 범위) / 개인(1개, 비공개)
// 생성자는 그 스페이스의 관리자가 된다. 접근 범위를 비워 두면 비공개(생성자와 사이트 관리자만).
export function CreateSpaceDialog({ me, onClose, onCreated }) {
  const [type, setType] = useState(me.can_create ? 'global' : 'personal');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState([]); // 접근 범위 {type, id, role, name}
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = type === 'personal'
        ? { type: 'personal', name, description }
        : { name, key, description, rows: rows.map((r) => ({ principalType: r.type, principalId: r.id, role: r.role })) };
      const sp = await api('/api/spaces', { method: 'POST', json: body });
      onCreated(sp);
    } catch (err) { alert(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={'modal modal-compact' + (type === 'global' ? ' modal-compact-wide' : '')} onClick={(e) => e.stopPropagation()}>
        <h2>스페이스 만들기</h2>
        <form className="req-form" onSubmit={submit}>
          <label>유형
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {me.can_create && <option value="global">일반 스페이스</option>}
              <option value="personal">개인 스페이스 (1개)</option>
            </select>
          </label>
          {!me.can_create && <p className="muted">일반 스페이스는 팀장·파트장 또는 지정 그룹만 만들 수 있습니다.</p>}
          <label>이름
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              placeholder={type === 'personal' ? '(비우면 "이름의 스페이스")' : '예: 개발1팀 위키'} />
          </label>
          {type === 'global' && (
            <label>키
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={20}
                placeholder="예: DEV1 (영문 대문자로 시작, 대문자·숫자 2~20자)" />
            </label>
          )}
          <label>설명
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000}
              placeholder="이 스페이스에서 다루는 내용 (선택)" />
          </label>
          {type === 'global' ? (
            <div className="space-scope">
              <div className="space-scope-title">접근 범위</div>
              <p className="muted">만든 사람은 관리자가 됩니다. 비워 두면 비공개(만든 사람과 사이트 관리자만)이고,
                팀에 준 권한은 하위 파트에도 적용됩니다.</p>
              <PermRows rows={rows} setRows={setRows} allowAnyone roles={['viewer', 'editor', 'admin']} />
            </div>
          ) : (
            <p className="muted">개인 스페이스는 비공개로 만들어집니다. 공유는 만든 뒤 스페이스 권한에서 설정하세요.</p>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={onClose}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '만드는 중…' : '만들기'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
