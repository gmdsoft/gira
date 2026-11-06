import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHTML } from '@tiptap/html';
import { extensions } from '../src/extensions.js';
import { validateMermaid } from '../src/mermaid-view.js';

const examples = [
  'flowchart TD\n A[첫 줄<br/>다음 줄]:::phase --> B[동작]:::action\n classDef phase fill:#acf,rx:20,ry:20\n classDef action fill:#fff,stroke:#333',
  'sequenceDiagram\n Alice->>Bob: Hello',
  'gantt\n title 일정\n dateFormat YYYY-MM-DD\n section 개발\n 작업 :2026-11-01, 3d',
  'classDiagram\n Animal <|-- Duck\n Animal : +int age',
  'stateDiagram-v2\n [*] --> Ready\n Ready --> [*]',
];
test('다섯 다이어그램 원문, 스타일과 줄바꿈을 보존한다', () => {
  for (const text of examples) {
    assert.equal(validateMermaid(text), text);
    const html = generateHTML({ type: 'doc', content: [{ type: 'mermaid', attrs: { size: 'small', caption: '설명', image: 'data:image/png;base64,AAAA' }, content: [{ type: 'text', text }] }] }, extensions);
    assert.match(html, /mermaid-src/);
    assert.match(html, /data-size="small"/);
    assert.match(html, /data-mermaid-caption="설명"/);
    assert.match(html, /data-mermaid-image=/);
    assert.ok(!html.includes('<br/>'));
  }
});
test('20,000자 제한, 설정 덮어쓰기와 클릭 동작 차단', () => {
  assert.doesNotThrow(() => validateMermaid('a'.repeat(20_000)));
  assert.throws(() => validateMermaid('a'.repeat(20_001)), /20,000/);
  for (const text of ['%%{init: {securityLevel: "loose"}}%%\nflowchart TD', '---\nconfig:\n---\nflowchart TD', 'flowchart TD\n click A callback', 'flowchart TD\n click A "https://example.org"']) {
    assert.throws(() => validateMermaid(text), /사용할 수 없습니다/);
  }
});
test('코드가 없는 PNG 원본은 이미지로 표시한다', () => {
  const html = generateHTML({ type: 'doc', content: [{ type: 'mermaid', attrs: { image: 'data:image/png;base64,AAAA', caption: '원본' } }] }, extensions);
  assert.match(html, /<img/);
  assert.match(html, /<figcaption>원본/);
  assert.ok(!html.includes('mermaid-src'));
});

test('편집기 여섯 예시의 코드가 게시 HTML에 보존된다', async () => {
  const { mermaidExamples } = await import('../src/mermaid-editor.js');
  assert.equal(mermaidExamples.length, 6);
  for (const [, text] of mermaidExamples) {
    assert.equal(validateMermaid(text), text);
    const html = generateHTML({ type: 'doc', content: [{ type: 'mermaid', content: [{ type: 'text', text }] }] }, extensions);
    assert.match(html, /mermaid-src/);
    assert.ok(html.includes(text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
  }
});

test('공유 삽입 메뉴에서 Mermaid 검색 키워드와 삽입 노드를 제공한다', async () => {
  const { makeSlashItems } = await import('../src/slash-menu.js');
  const item = makeSlashItems({}).find(item => item.label === 'Mermaid 다이어그램');
  for (const keyword of ['mermaid', '다이어그램', '흐름도']) assert.ok(`${item.label} ${item.kw}`.includes(keyword));
  let inserted;
  const chain = { focus() { return this; }, deleteRange() { return this; }, insertContent(value) { inserted = value; return this; }, run() { return true; } };
  item.run({ chain: () => chain }, { from: 1, to: 9 });
  assert.deepEqual(inserted, { type: 'mermaid' });
});
