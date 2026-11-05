// 관리 화면 (사이트 관리자): 사용자(직급·직책·팀), 팀·파트, 그룹, 접근 요청 승인함
import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const DUTY_LABEL = { team_lead: '팀장', part_lead: '파트장', member: '파트원' };

const TAB_LABEL = { users: '사용자', teams: '팀·파트', groups: '그룹', requests: '접근 요청' };

// tabs: 표시할 탭 목록. 관리 서비스(standalone)는 조직 탭만, Gonfluence는 접근 요청만 쓴다.
export default function AdminPage({ me, navigate, tabs = ['users', 'teams', 'groups', 'requests'], standalone }) {
  const [tab, setTab] = useState(tabs[0]);
  if (!me.is_admin) return <div className="home"><h1>관리</h1><p>사이트 관리자만 접근할 수 있습니다.</p></div>;
  return (
    <div className="home home-wide admin">
      {navigate && (
        <div className="home-user muted">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>← 홈</a>
        </div>
      )}
      <h1>{standalone ? '조직 관리' : '관리'}</h1>
      {standalone && <p className="muted">사용자·팀·그룹 변경은 이 화면에서만 하며, 설치된 모든 앱(Gira/Gonfluence)에 함께 적용됩니다.</p>}
      <nav className="admin-tabs">
        {tabs.map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{TAB_LABEL[k]}</button>
        ))}
      </nav>
      {tab === 'users' && <UsersTab />}
      {tab === 'teams' && <TeamsTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'requests' && <RequestsTab />}
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [teams, setTeams] = useState([]);
  const load = useCallback(() => {
    api('/api/admin/users?q=' + encodeURIComponent(q)).then(setRows).catch((e) => alert(e.message));
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api('/api/admin/teams').then(setTeams).catch(() => {}); }, []);

  const teamName = (t) => t.parent_id ? `${teams.find((x) => x.id === t.parent_id)?.name ?? ''} / ${t.name}` : t.name;
  const save = async (id, patch) => {
    try {
      await api('/api/admin/users/' + id, { method: 'POST', json: patch });
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <section>
      <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·이메일 검색" />
      {!rows ? <p className="muted">불러오는 중…</p> : (
        <table className="admin-table">
          <thead><tr><th>이름</th><th>이메일</th><th>직급</th><th>소속</th><th>직책</th><th>활성</th><th>관리자</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>{u.display_name}</td>
                <td className="muted">{u.email}</td>
                <td>
                  <input className="rank-input" defaultValue={u.rank ?? ''} placeholder="-"
                    onBlur={(e) => { if ((u.rank ?? '') !== e.target.value.trim()) save(u.id, { rank: e.target.value.trim() }); }} />
                </td>
                <td>
                  <select value={u.team_id ?? ''} onChange={(e) => save(u.id, { teamId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">소속 없음</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{teamName(t)}</option>)}
                  </select>
                </td>
                <td>
                  <select value={u.duty ?? 'member'} onChange={(e) => save(u.id, { duty: e.target.value })}>
                    {Object.entries(DUTY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={u.active} onChange={(e) => save(u.id, { active: e.target.checked })} /></td>
                <td><input type="checkbox" checked={u.is_admin} onChange={(e) => save(u.id, { isAdmin: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TeamsTab() {
  const [teams, setTeams] = useState(null);
  const [name, setName] = useState('');
  const load = () => api('/api/admin/teams').then(setTeams).catch((e) => alert(e.message));
  useEffect(() => { load(); }, []);

  const add = async (parentId) => {
    const nm = parentId ? prompt('파트 이름') : name.trim();
    if (!nm?.trim()) return;
    try {
      await api('/api/admin/teams', { method: 'POST', json: { name: nm.trim(), parentId } });
      setName(''); load();
    } catch (e) { alert(e.message); }
  };
  const rename = async (t) => {
    const nm = prompt('새 이름', t.name);
    if (!nm?.trim() || nm.trim() === t.name) return;
    try { await api('/api/admin/teams/' + t.id, { method: 'POST', json: { name: nm.trim() } }); load(); }
    catch (e) { alert(e.message); }
  };
  const del = async (t) => {
    if (!confirm(`'${t.name}' 을(를) 삭제할까요?`)) return;
    try { await api('/api/admin/teams/' + t.id, { method: 'DELETE' }); load(); }
    catch (e) { alert(e.message); }
  };

  if (!teams) return <p className="muted">불러오는 중…</p>;
  const tops = teams.filter((t) => !t.parent_id);
  const parts = (id) => teams.filter((t) => t.parent_id === id);
  const row = (t, isPart) => (
    <li key={t.id} className={isPart ? 'team-part' : 'team-top'}>
      <span className="team-name">{t.name}</span>
      <span className="muted">{t.member_count}명</span>
      {!isPart && <button className="btn btn-xs" onClick={() => add(t.id)}>+ 파트</button>}
      <button className="btn btn-xs" onClick={() => rename(t)}>이름</button>
      <button className="btn btn-xs" onClick={() => del(t)}>삭제</button>
    </li>
  );
  return (
    <section>
      <form className="team-add" onSubmit={(e) => { e.preventDefault(); add(null); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 팀 이름" />
        <button className="btn btn-primary" type="submit">팀 추가</button>
      </form>
      <ul className="team-list">
        {tops.map((t) => [row(t, false), ...parts(t.id).map((p) => row(p, true))])}
        {!teams.length && <li className="muted">아직 팀이 없습니다. 팀을 만들고 사용자 탭에서 소속을 지정하세요.</li>}
      </ul>
    </section>
  );
}

function GroupsTab() {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState(null);
  const load = () => api('/api/admin/groups').then(setGroups).catch((e) => alert(e.message));
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await api('/api/admin/groups', { method: 'POST', json: { name: name.trim() } }); setName(''); load(); }
    catch (err) { alert(err.message); }
  };
  const setCanCreate = async (g, v) => {
    try { await api('/api/admin/groups/' + g.id, { method: 'POST', json: { canCreate: v } }); load(); }
    catch (e) { alert(e.message); }
  };
  const del = async (g) => {
    if (!confirm(`'${g.name}' 그룹을 삭제할까요? (권한 규칙도 함께 제거됩니다)`)) return;
    try { await api('/api/admin/groups/' + g.id, { method: 'DELETE' }); load(); }
    catch (e) { alert(e.message); }
  };

  if (!groups) return <p className="muted">불러오는 중…</p>;
  return (
    <section>
      <form className="team-add" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 그룹 이름 (예: PM들)" />
        <button className="btn btn-primary" type="submit">그룹 추가</button>
      </form>
      <table className="admin-table">
        <thead><tr><th>그룹</th><th>멤버</th><th title="멤버가 프로젝트/스페이스를 만들 수 있음">생성 권한</th><th /></tr></thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.id}>
              <tr>
                <td>{g.name}</td>
                <td><button className="btn btn-xs" onClick={() => setOpenId(openId === g.id ? null : g.id)}>{g.member_count}명 {openId === g.id ? '▲' : '▼'}</button></td>
                <td><input type="checkbox" checked={g.can_create} onChange={(e) => setCanCreate(g, e.target.checked)} /></td>
                <td><button className="btn btn-xs" onClick={() => del(g)}>삭제</button></td>
              </tr>
              {openId === g.id && <tr><td colSpan={4}><GroupMembers groupId={g.id} onChanged={load} /></td></tr>}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GroupMembers({ groupId, onChanged }) {
  const [members, setMembers] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const load = () => api(`/api/admin/groups/${groupId}/members`).then(setMembers).catch(() => setMembers([]));
  useEffect(() => { load(); }, [groupId]);
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/principals?q=' + encodeURIComponent(q)).then((r) => setFound(r.users)).catch(() => setFound([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (u) => {
    await api(`/api/admin/groups/${groupId}/members`, { method: 'POST', json: { userId: u.id } });
    setQ(''); load(); onChanged();
  };
  const del = async (u) => {
    await api(`/api/admin/groups/${groupId}/members/${u.id}`, { method: 'DELETE' });
    load(); onChanged();
  };

  return (
    <div className="group-members">
      {!members ? <p className="muted">불러오는 중…</p> : (
        <ul>
          {members.map((m) => (
            <li key={m.id}>{m.display_name} <span className="muted">{m.email}</span>
              <button className="btn btn-xs" onClick={() => del(m)}>빼기</button></li>
          ))}
          {!members.length && <li className="muted">멤버 없음</li>}
        </ul>
      )}
      <div className="ppicker">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="사용자 검색해서 추가" />
        {!!q && !!found.length && (
          <ul className="ppicker-list">
            {found.map((u) => (
              <li key={u.id}><button type="button" onClick={() => add(u)}>{u.name} <span className="muted">{u.email}</span></button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestsTab() {
  const [rows, setRows] = useState(null);
  const load = () => api('/api/access-requests/inbox').then(setRows).catch((e) => alert(e.message));
  useEffect(() => { load(); }, []);

  const decide = async (r, approve) => {
    try { await api(`/api/access-requests/${r.id}/decide`, { method: 'POST', json: { approve } }); load(); }
    catch (e) { alert(e.message); }
  };

  if (!rows) return <p className="muted">불러오는 중…</p>;
  if (!rows.length) return <p className="muted">대기 중인 접근 요청이 없습니다.</p>;
  return (
    <table className="admin-table">
      <thead><tr><th>요청자</th><th>스페이스</th><th>권한</th><th>사유</th><th>요청일</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.user_name} <span className="muted">{r.user_email}</span></td>
            <td>{r.space_name} <span className="muted">({r.space_key})</span></td>
            <td>{r.want === 'editor' ? '편집' : '보기'}</td>
            <td className="muted">{r.reason}</td>
            <td className="muted">{new Date(r.created_at).toLocaleDateString('ko-KR')}</td>
            <td>
              <button className="btn btn-primary btn-xs" onClick={() => decide(r, true)}>승인</button>{' '}
              <button className="btn btn-xs" onClick={() => decide(r, false)}>거절</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
