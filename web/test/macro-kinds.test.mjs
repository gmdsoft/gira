// GIRA-48: 내보내기 앱 표시 숨김, 감싼 본문만, 옮길 수 없는 앱 안내, 문단 안 앱 블록 글자 새어 나옴 방지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertStorage } from '../../scripts/convert-storage.mjs';

const find = (doc, pred, out = []) => { if (pred(doc)) out.push(doc); for (const c of doc.content ?? []) find(c, pred, out); return out; };
const ext = (type, key, extra = '') => `<ac:adf-extension><ac:adf-node type="${type}"><ac:adf-attribute key="extension-key">app/env/static/${key}</ac:adf-attribute><ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute>${extra}</ac:adf-node></ac:adf-extension>`;

test('scroll-pagebreak 매크로와 ADF 확장은 숨김으로 센다', () => {
  const { doc, stats } = convertStorage(`<p>a</p><ac:structured-macro ac:name="scroll-pagebreak" /><p>b</p>${ext('extension', 'scroll-pagebreak')}`);
  assert.deepEqual(stats.unsupportedMacros, {});
  assert.deepEqual(stats.dynamicMacros, {});
  assert.equal(stats.hiddenMacros['scroll-pagebreak'], 1);
  assert.equal(stats.hiddenMacros['adf-ext:scroll-pagebreak'], 1);
  assert.equal(find(doc, (n) => n.type === 'cfMacro').length, 2); // 모델에는 보존
});

test('scroll-content-block·bodied 확장은 본문을 유지하고 미지원으로 세지 않는다', () => {
  const { doc, stats } = convertStorage(`<ac:structured-macro ac:name="scroll-content-block"><ac:rich-text-body><p>본문1</p></ac:rich-text-body></ac:structured-macro>`
    + `<ac:adf-extension><ac:adf-node type="bodied-extension"><ac:adf-attribute key="extension-key">x/y/static/scroll-ignore</ac:adf-attribute><ac:adf-content><p>본문2</p></ac:adf-content></ac:adf-node></ac:adf-extension>`);
  assert.deepEqual(stats.unsupportedMacros, {});
  assert.deepEqual(stats.dynamicMacros, {});
  const texts = find(doc, (n) => n.type === 'text').map((n) => n.text);
  assert.ok(texts.includes('본문1') && texts.includes('본문2'));
});

test('문단 안 스마트 버튼은 인라인 안내 노드가 되고 속성 글자가 새지 않는다', () => {
  const smart = `<ac:adf-extension><ac:adf-node type="inline-extension"><ac:adf-attribute key="extension-key">smart-button</ac:adf-attribute><ac:adf-attribute key="extension-type">com.atlassian.automation.smart-button</ac:adf-attribute><ac:adf-attribute key="parameters"><ac:adf-parameter key="smart-button-name">검토를 위해 보내기</ac:adf-parameter></ac:adf-attribute></ac:adf-node><ac:adf-fallback><ac:adf-node type="inline-extension"><ac:adf-attribute key="extension-key">smart-button</ac:adf-attribute></ac:adf-node></ac:adf-fallback></ac:adf-extension>`;
  const { doc, stats } = convertStorage(`<p>앞 ${smart} 뒤</p>`);
  const texts = find(doc, (n) => n.type === 'text').map((n) => n.text).join('');
  assert.equal(texts, '앞  뒤');
  const inl = find(doc, (n) => n.type === 'cfMacroInline');
  assert.equal(inl.length, 1);
  assert.equal(inl[0].attrs.name, 'adf-ext:smart-button');
  assert.equal(stats.noticeMacros['adf-ext:smart-button'], 1);
  assert.deepEqual(stats.unsupportedMacros, {});
});

test('프로젝트 링커는 안내로 센다', () => {
  const { stats } = convertStorage(`<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="extension-type">com.atlassian.confluence.project-linker</ac:adf-attribute><ac:adf-attribute key="extension-key">project-linker</ac:adf-attribute></ac:adf-node></ac:adf-extension>`);
  assert.equal(stats.noticeMacros['adf-ext:project-linker'], 1);
  assert.deepEqual(stats.unsupportedMacros, {});
});

test('옮길 수 없는 앱 매크로는 안내로 세고 투표 선택지를 보존한다 (GIRA-57)', () => {
  const { doc, stats } = convertStorage('<ac:structured-macro ac:name="vote"><ac:parameter ac:name="title">말풍선 고르기</ac:parameter><ac:plain-text-body><![CDATA[A안\nB안]]></ac:plain-text-body></ac:structured-macro>'
    + '<ac:structured-macro ac:name="TEST_RESULTS_ADVANCED"><ac:parameter ac:name="reportKey">TEST_RESULTS_ADVANCED</ac:parameter></ac:structured-macro><ac:structured-macro ac:name="calendar" />');
  assert.deepEqual(stats.unsupportedMacros, {});
  assert.deepEqual(stats.dynamicMacros, {});
  assert.equal(Object.keys(stats.noticeMacros).length, 3);
  const vote = find(doc, (n) => n.type === 'cfMacro' && n.attrs.name === 'vote')[0];
  assert.equal(vote.attrs.params.__body, 'A안\nB안');
});
