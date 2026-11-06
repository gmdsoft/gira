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
  ['python', 'def greet(name):\n    # 인사\n    return f"hello {name}" if name else None'],
  ['rust', 'fn main() {\n    let mut n = 42; // 값\n    println!("{}", n);\n}'],
  ['c', '#include <stdio.h>\nint main(void) { printf("%d", 42); return 0; }'],
  ['cpp', '#include <vector>\nclass A { public: virtual int f() const { return 1; } }; // c++'],
  ['csharp', 'using System;\npublic class A { public static void Main() { var s = @"path\\x"; } }'],
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
// 자동 감지
const detect = (t) => codeTokens(t, null).map((k) => t.slice(k.from, k.to));
assert.ok(detect('def f(x):\n    return x').includes('def'));
assert.ok(detect('fn main() { let mut a = 1; }').includes('mut'));
assert.ok(detect('using System;\nnamespace A { }').includes('namespace'));
assert.ok(detect('#include <vector>\nstd::vector<int> v;').includes('#include'));
assert.ok(detect('#include <stdio.h>\nint main(void) { return 0; }').includes('#include'));
assert.doesNotThrow(() => generateHTML({ type: 'doc', content: [{ type: 'codeBlock' }] }, extensions));
console.log('code-block-check: JS/Python/Rust/C/C++/C#/SQL/JSON/Bash, 자동 감지, 보기 HTML·편집 decorations, 언어·원문 왕복 통과');
