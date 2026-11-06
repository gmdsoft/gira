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

// 개발용 로그인 (Entra ID OIDC 도입 전): 관리자가 허용한 계정만, 이메일 주소 입력으로
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const login = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '로그인 실패'); return; }
    onLogin(await api('/api/auth/me'));
  };
  return (
    <div className="home login">
      <h1>관리 <span className="poc-badge">Alpha</span></h1>
      <p className="muted">회사 이메일 주소를 입력하세요. 관리자가 허용한 계정만 로그인할 수 있습니다.</p>
      <form className="search-form" onSubmit={login}>
        <input className="search-input" type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" />
        <button className="btn btn-primary" type="submit">로그인</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AdminApp />);
