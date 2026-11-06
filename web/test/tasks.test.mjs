import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { generateHTML, generateJSON } from '@tiptap/html';
import { extensions } from '../src/extensions.js';
import { TaskItem } from '../src/task-item.js';
import { datePresentation } from '../src/date-presentation.js';
import { convertStorage } from '../../scripts/convert-storage.mjs';
const schema = getSchema(extensions);
const p = text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const item = (text, checked = false, nested = []) => schema.nodes.taskItem.create({ checked }, [p(text), ...nested]);
const list = items => schema.nodes.taskList.create(null, items);
function harness(items, target) {
  const doc = schema.nodes.doc.create(null, list(items));
  let pos;
  doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === target) pos = at + 1; });
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  const run = cmd => cmd(state, tr => { state = state.apply(tr); state.doc.check(); });
  const editor = { get state() { return state; }, isActive: type => { const $p = state.selection.$from; for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === type) return true; return false; }, commands: {
    splitListItem: (type, attrs) => run(splitListItem(schema.nodes[type], attrs)),
    liftListItem: type => run(liftListItem(schema.nodes[type])),
  } };
  return { editor, keys: TaskItem.config.addKeyboardShortcuts.call({ editor }), run };
}
test('Enter creates an unchecked task and empty Enter exits one level at a time', () => {
  let h = harness([item('완료', true)], '완료');
  h.run((state, dispatch) => { dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.selection.from + 2))); return true; });
  assert.equal(h.keys.Enter(), true);
  assert.equal(h.editor.state.doc.firstChild.child(1).attrs.checked, false);
  h = harness([item('상위', false, [list([item('')])])], '');
  assert.equal(h.keys.Enter(), true);
  assert.equal(h.editor.state.doc.firstChild.childCount, 2);
  assert.equal(h.keys.Enter(), true);
  assert.equal(h.editor.state.doc.lastChild.type.name, 'paragraph');
});
test('Backspace at task start preserves previous content and creates a paragraph, including nested tasks', () => {
  for (const items of [[item('앞'), item('대상')], [item('앞', false, [list([item('대상')])])]]) {
    const h = harness(items, '대상');
    assert.equal(h.keys.Backspace(), true);
    assert.equal(h.editor.state.doc.firstChild.textContent, '앞');
    assert.equal(h.editor.state.doc.child(1).type.name, 'paragraph');
    assert.equal(h.editor.state.doc.child(1).textContent, '대상');
  }
});
test('Tab nesting preserves checked state and imported tasks share checkbox rendering', () => {
  const h = harness([item('앞'), item('대상', true)], '대상');
  assert.equal(h.run(sinkListItem(schema.nodes.taskItem)), true);
  assert.equal(h.editor.state.doc.firstChild.firstChild.lastChild.firstChild.attrs.checked, true);
  const { doc } = convertStorage('<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>완료</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>진행</ac:task-body></ac:task></ac:task-list>');
  const html = generateHTML(doc, extensions);
  assert.match(html, /aria-label="작업을 완료로 표시"/);
  const parsed = generateJSON(html, extensions);
  assert.equal(parsed.content[0].content[0].attrs.checked, true);
  assert.equal(parsed.content[0].content[1].attrs.checked, false);
});
test('date presentation preserves ISO date while flagging today and past dates', () => {
  const now = new Date(2026, 10, 6);
  assert.match(datePresentation('2026-11-06', now).class, /date-today/);
  assert.match(datePresentation('2026-11-03', now).class, /date-past/);
  assert.equal(datePresentation('2026-11-07', now).class, 'date-lozenge');
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'date', attrs: { date: '2026-11-03' } }] }] };
  assert.equal(generateJSON(generateHTML(doc, extensions), extensions).content[0].content[0].attrs.date, '2026-11-03');
});
