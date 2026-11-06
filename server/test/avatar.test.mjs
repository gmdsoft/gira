import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageInfo, resolveAvatar } from '../src/avatar.mjs';

test('아바타 우선순위: 등록 이미지 → Entra 사진 → 기본(이니셜)', () => {
  const registered = { id: 7, avatar_key: 'abc', avatar_external_url: 'https://example.test/photo.jpg' };
  assert.equal(resolveAvatar(registered), '/api/avatar/7?v=abc');
  assert.equal(resolveAvatar({ id: 7, avatar_key: null, avatar_external_url: 'https://example.test/photo.jpg' }),
    'https://example.test/photo.jpg');
  assert.equal(resolveAvatar({ id: 7, avatar_key: null, avatar_external_url: null }), null);
  assert.equal(resolveAvatar(null), null);
});

test('이미지 헤더에서 PNG·JPEG 크기를 읽고 정사각형 여부를 판별할 수 있다', () => {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f6d0000000049454e44ae426082',
    'hex');
  assert.deepEqual(imageInfo(png), { mime: 'image/png', width: 1, height: 1 });

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
  assert.deepEqual(imageInfo(jpeg), { mime: 'image/jpeg', width: 64, height: 64 });
  assert.equal(imageInfo(Buffer.from('not an image')), null);
});
