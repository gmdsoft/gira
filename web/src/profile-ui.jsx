// 개인 설정 › 프로필 (GIRA-20): 프로필 이미지 등록·변경·삭제.
// 선택한 이미지는 가운데를 정사각형으로 잘라 256×256 JPEG로 줄여 올린다 (서버도 형식·크기를 검사).
import React, { useRef, useState } from 'react';
import { Avatar, resetAvatarCache } from './avatar.jsx';

const SIZE = 256;

function squareJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      if (!s) { reject(new Error('이미지를 읽을 수 없습니다')); return; }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      canvas.getContext('2d').drawImage(
        img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIZE, SIZE);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 변환할 수 없습니다'))),
        'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다')); };
    img.src = url;
  });
}

async function send(method, body) {
  const res = await fetch('/api/me/avatar', { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '프로필 이미지를 저장하지 못했습니다');
  return data;
}

export function ProfileBody({ me, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file) => {
    if (!file) return;
    setError('');
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError('PNG 또는 JPEG 이미지만 등록할 수 있습니다');
      return;
    }
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const body = new FormData();
      body.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      await send('POST', body);
      resetAvatarCache();
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    if (!confirm('프로필 이미지를 삭제하고 기본 표시로 돌아갈까요?')) return;
    setError('');
    setBusy(true);
    try {
      await send('DELETE');
      resetAvatarCache();
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-pane">
      <div className="profile-row">
        <Avatar name={me?.display_name} user={me} className="profile-avatar" />
        <div>
          <div className="profile-name">{me?.display_name}</div>
          <div className="muted">Gira·Gonfluence에 함께 표시되는 프로필 이미지입니다.</div>
          <div className="profile-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
              {me?.avatar_key ? '이미지 변경' : '이미지 등록'}
            </button>
            {me?.avatar_key && <button className="btn" disabled={busy} onClick={remove}>삭제</button>}
          </div>
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg" hidden
        onChange={(e) => upload(e.target.files?.[0])} />
      <p className="muted">가운데를 정사각형으로 잘라 256×256으로 줄여 저장합니다 (PNG·JPEG).
        등록한 이미지가 없으면 Entra 계정 사진, 그것도 없으면 이니셜로 표시합니다.</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
