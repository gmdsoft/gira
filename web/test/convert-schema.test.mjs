// GIRA-75: 변환 결과가 편집기 스키마 규칙을 지키는지 (목록·표 안 이미지, 목록 첫 블록, 빈 목록·표, 마크 중복)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { extensions } from '../src/extensions.js';
import { convertStorage } from '../../scripts/convert-storage.mjs';

const schema = getSchema(extensions);
const valid = (xhtml) => { const { doc } = convertStorage(xhtml); schema.nodeFromJSON(doc).check(); return doc; };
const img = '<ac:image><ri:attachment ri:filename="a.png" /></ac:image>';

test('목록 항목·표 칸·레이아웃 열 바로 아래 이미지는 문단으로 감싼다', () => {
  const doc = valid(`<ul><li>${img}</li><li><p>글</p>${img}</li></ul><table><tbody><tr><td>${img}<p>x</p></td></tr></tbody></table>`
    + `<ac:layout><ac:layout-section ac:type="single"><ac:layout-cell>${img}<p>y</p></ac:layout-cell></ac:layout-section></ac:layout>`);
  assert.equal(doc.content[0].content[0].content[0].type, 'paragraph');
  assert.equal(doc.content[0].content[0].content[0].content[0].type, 'media');
});

test('문단 없이 시작하는 목록 항목 앞에 빈 문단, 빈 목록·빈 표는 버린다', () => {
  const doc = valid('<ul><li><ul><li><p>안쪽</p></li></ul></li><li><ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[x]]></ac:plain-text-body></ac:structured-macro></li></ul><ol></ol><table><tbody></tbody></table><p>끝</p>');
  assert.equal(doc.content.length, 2); // 목록 + 끝 문단
  assert.equal(doc.content[0].content[0].content[0].type, 'paragraph');
});

test('겹친 같은 마크는 안쪽만, 코드 마크는 단독', () => {
  const doc = valid('<p><strong>a<strong>b</strong></strong><span style="color: red"><span style="color: blue">c</span></span><code><strong>d</strong></code></p>');
  const texts = doc.content[0].content;
  assert.deepEqual(texts.find((t) => t.text === 'c').marks, [{ type: 'textColor', attrs: { color: 'blue' } }]);
  assert.deepEqual(texts.find((t) => t.text === 'd').marks.map((m) => m.type), ['code']);
});
