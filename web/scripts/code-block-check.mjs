import assert from 'node:assert/strict';
import { generateHTML, generateJSON } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { extensions } from '../src/extensions.js';
import { HighlightedCodeBlock, codeTokens } from '../src/code-block.js';

const schema = getSchema(extensions);
const samples = [
  ['js', 'const answer = "<script>"; // comment'],
  ['sql', "SELECT * FROM users WHERE id = 42 AND name = 'Kim';"],
  ['json', '{"enabled": true, "count": 42}'],
  ['bash', '#!/bin/bash\nexport NAME="Kim"\necho $NAME'],
];
for (const [language, text] of [...samples, ...samples.map(([, text]) => [null, text])]) {
  const doc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] }] };
  const html = generateHTML(doc, extensions);
  assert.match(html, /class="hljs-/);
  assert.ok(!html.includes('<script>'));
  const restored = generateJSON(html, extensions).content[0];
  assert.equal(restored.attrs.language, language);
  assert.equal(restored.content.map((n) => n.text).join(''), text);
  const [plugin] = HighlightedCodeBlock.config.addProseMirrorPlugins.call({});
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc), plugins: [plugin] });
  const decorations = plugin.props.decorations(state).find();
  assert.equal(decorations.length, codeTokens(text, language).length);
  assert.ok(decorations.length > 0);
  for (const decoration of decorations) {
    assert.match(decoration.type.attrs.class, /^hljs-/);
  }
}
assert.deepEqual(codeTokens('const x = 42', 'unknown-imported-language'), []);
assert.deepEqual(codeTokens('const x = 42', 'plaintext'), []);
assert.doesNotThrow(() => generateHTML({ type: 'doc', content: [{ type: 'codeBlock' }] }, extensions));
console.log('code-block-check: JS/SQL/JSON/Bash, 자동 감지, 보기 HTML·편집 decorations, 언어·원문 왕복 통과');
