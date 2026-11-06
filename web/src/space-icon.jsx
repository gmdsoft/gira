// 스페이스 대표 아이콘: 이미지가 있으면 정사각형으로 표시하고, 없으면 기존 색상 상자 + 첫 글자를 유지한다.
import React, { useEffect, useState } from 'react';

export const SPACE_COLORS = ['#0052cc', '#00875a', '#ff8b00', '#de350b', '#5243aa', '#00a3bf', '#403294', '#e56910'];
export const spaceColor = (s) => SPACE_COLORS[[...String(s ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % SPACE_COLORS.length];

export const SPACE_ICON_MAX = 1024 * 1024;
export const SPACE_ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function validateSpaceIcon(file) {
  if (!file) return null;
  if (!SPACE_ICON_TYPES.includes(file.type)) return 'PNG·JPG·WebP 이미지만 올릴 수 있습니다';
  if (file.size > SPACE_ICON_MAX) return '이미지는 1MB 이하만 올릴 수 있습니다';
  return null;
}

export const spaceIconUrl = (space) => (space?.icon_key
  ? `/api/spaces/${encodeURIComponent(space.key)}/icon?v=${encodeURIComponent(space.icon_key)}`
  : null);

export function SpaceAvatar({ space, className = '', size }) {
  const url = spaceIconUrl(space);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const showImage = url && !failed;
  const style = {
    ...(showImage ? {} : { background: spaceColor(space?.key) }),
    ...(size ? { width: size, height: size } : {}),
  };
  return (
    <span className={('space-avatar ' + className).trim()} style={style}>
      {showImage
        ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
        : ((space?.name ?? '?').trim()[0] || '?')}
    </span>
  );
}

export async function uploadSpaceIcon(spaceKey, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/icon`, { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? '이미지를 등록하지 못했습니다');
  return body;
}

export async function deleteSpaceIcon(spaceKey) {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/icon`, { method: 'DELETE' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? '이미지를 지우지 못했습니다');
  return body;
}
