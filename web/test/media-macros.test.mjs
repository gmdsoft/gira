import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaTag, chartData } from '../../shared/media-macros.mjs';
import { convertStorage } from '../../scripts/convert-storage.mjs';

test('미디어 확장자별 태그와 미지원 파일', () => {
  for (const ext of ['mp4', 'WEBM', 'mov', 'avi']) assert.equal(mediaTag(`demo.${ext}`), 'video');
  for (const ext of ['mp3', 'wav', 'm4a']) assert.equal(mediaTag(`demo.${ext}`), 'audio');
  assert.equal(mediaTag('demo.PNG'), 'img');
  assert.equal(mediaTag('demo.zip'), null);
});
test('표 첫 열 분류, 여러 계열, 음수와 빈칸·비숫자 처리', () => {
  assert.deepEqual(chartData([['분류', '진행', '완료'], ['가', '2', '-1'], ['나', '', '오류']]), {
    series: ['진행', '완료'], categories: [{ label: '가', values: [2, -1] }, { label: '나', values: [null, null] }],
  });
  assert.equal(chartData([['분류', '값'], ['가', '없음']]), null);
  assert.equal(chartData([]), null);
});
test('PlantUML·위키 원문을 공백과 긴 코드까지 그대로 보존', () => {
  for (const name of ['plantuml', 'unmigrated-wiki-markup']) {
    const source = '  @startuml\nAlice -> Bob: <hello> & test\n' + 'a'.repeat(4100) + '\n@enduml  ';
    const { doc } = convertStorage(`<ac:structured-macro ac:name="${name}"><ac:plain-text-body><![CDATA[${source}]]></ac:plain-text-body></ac:structured-macro>`);
    assert.equal(doc.content[0].attrs.params.__body, source);
  }
});
test('표 앱과 chart의 rich body 표 보존', () => {
  for (const name of ['table-filter', 'pivot-table', 'chart']) {
    const { doc, stats } = convertStorage(`<ac:structured-macro ac:name="${name}"><ac:rich-text-body><table><tr><th>분류</th><th>값</th></tr><tr><td>가</td><td>2</td></tr></table></ac:rich-text-body></ac:structured-macro>`);
    assert.equal(doc.content[0].content[0].type, 'table');
    assert.deepEqual(stats.unsupportedMacros, {});
  }
});

test('chart와 표 앱 직렬화 시 표는 숨겨지지 않는다', async () => {
  const { generateHTML } = await import('@tiptap/html');
  const { extensions } = await import('../src/extensions.js');
  for (const name of ['chart', 'table-filter', 'pivot-table']) {
    const { doc } = convertStorage(`<ac:structured-macro ac:name="${name}"><ac:rich-text-body><table><tr><th>분류</th><th>값</th></tr><tr><td>합성</td><td>3</td></tr></table></ac:rich-text-body></ac:structured-macro>`);
    const html = generateHTML(doc, extensions);
    assert.match(html, /<table/);
    assert.match(html, /합성/);
    assert.doesNotMatch(html, /display:\s*none/);
  }
});
