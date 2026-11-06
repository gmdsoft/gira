// Gira·Gonfluence 공용 아바타 컴포넌트 (GIRA-20).
// 표시 우선순위는 서버(server/src/avatar.mjs resolveAvatar)가 정한다:
// 직접 등록 이미지 → 외부(Entra) 사진 → 기본 이니셜(URL 없음).
import React, { useEffect, useState } from 'react';

const PALETTE = ['#0052cc', '#00875a', '#ff8b00', '#de350b', '#5243aa', '#00a3bf', '#403294', '#e56910', '#216e4e', '#943d73'];
const hashColor = (s) => PALETTE[[...String(s ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

let cache = null;   // Map<display_name, avatar_url|null>
let pending = null; // Promise<Map>

function load() {
  if (!pending) {
    pending = fetch('/api/avatars', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { cache = new Map(rows.map((u) => [u.name, u.avatar_url])); return cache; })
      .catch(() => { cache = new Map(); return cache; });
  }
  return pending;
}

// 프로필 이미지를 바꾼 뒤 호출 — 아바타 목록을 다시 읽는다 (같은 이름의 다른 사용자 표시도 갱신).
export function resetAvatarCache() {
  cache = null;
  pending = null;
  window.dispatchEvent(new Event('gira-avatar'));
}

export function Avatar({ name, user, className, title }) {
  const label = name ?? user?.display_name ?? '';
  const [src, setSrc] = useState(() => (user ? user.avatar_url ?? null : cache?.get(label) ?? null));

  useEffect(() => {
    if (user) { setSrc(user.avatar_url ?? null); return undefined; }
    let alive = true;
    const apply = () => {
      if (cache) { setSrc(cache.get(label) ?? null); return; }
      load().then((m) => { if (alive) setSrc(m.get(label) ?? null); });
    };
    apply();
    window.addEventListener('gira-avatar', apply);
    return () => { alive = false; window.removeEventListener('gira-avatar', apply); };
  }, [label, user?.avatar_url]);

  if (!label && !src) return null;
  return (
    <span className={'av' + (className ? ' ' + className : '')} title={title ?? label}
      style={src ? undefined : { background: hashColor(label) }}>
      {src ? <img src={src} alt="" onError={() => setSrc(null)} /> : (String(label).trim()[0] ?? '?')}
    </span>
  );
}
