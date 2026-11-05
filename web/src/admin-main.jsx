// 관리 서비스 SPA 엔트리: 로그인 → 조직 관리(사용자·팀·그룹)
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import AdminPage from './Admin.jsx';
import './styles.css';

function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined=확인 중, null=로그인 필요
  useEffect(() => {
    api('/api/auth/me').then(setMe).catch(() => setMe(null));
  }, []);
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
  };

  if (me === undefined) return <div className="page-loading">불러오는 중…</div>;
  if (me === null) return <Login onLogin={setMe} />;
  return (
    <div>
      <div className="home-user muted admin-user">
        👤 {me.display_name} <button className="btn btn-xs" onClick={logout}>로그아웃</button>
      </div>
      <AdminPage me={me} tabs={['users', 'teams', 'groups']} standalone />
    </div>
  );
}

// 개발용 로그인 (Entra ID OIDC 도입 전)
function Login({ onLogin }) {
  const [users, setUsers] = useState(null);
  useEffect(() => { api('/api/auth/users').then(setUsers).catch(() => setUsers([])); }, []);
  const login = async (u) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id }),
    });
    if (!res.ok) { alert('로그인 실패'); return; }
    onLogin(await api('/api/auth/me'));
  };
  return (
    <div className="home login">
      <h1>관리 <span className="poc-badge">PoC</span></h1>
      <p className="muted">로그인할 사용자를 선택하세요. (개발용 — Entra ID 연동 시 회사 계정 로그인으로 교체됩니다)</p>
      {!users ? <p>불러오는 중…</p> : (
        <ul className="space-list login-list">
          {users.map((u) => (
            <li key={u.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); login(u); }}>
                <strong>{u.display_name}</strong> <span className="muted">{u.email ?? ''}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AdminApp />);
