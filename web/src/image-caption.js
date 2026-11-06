import { Node } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

export const MediaCaption = Node.create({
  name: 'mediaCaption', priority: 1100, inline: true,
  content: '(text | mention | emoji | pageLink | spaceLink | fileLink)*',
  marks: 'bold italic underline textColor link',
  parseHTML: () => [{ tag: 'span.media-caption' }],
  renderHTML: () => ['span', { class: 'media-caption' }, 0],
  addKeyboardShortcuts() {
    return { Enter: () => {
      const { state, view } = this.editor;
      const { $from } = state.selection;
      if ($from.parent.type.name !== this.name) return false;
      // Leave both inline caption and image, then split the surrounding paragraph.
      const end = $from.after($from.depth - 1);
      const tr = state.tr.setSelection(TextSelection.create(state.doc, end));
      tr.split(end);
      tr.setSelection(TextSelection.create(tr.doc, end + 2));
      view.dispatch(tr.setMeta('leaveMediaCaption', true));
      return true;
    } };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction(tr, state) {
      const before = state.selection.$from;
      if (!tr.docChanged || tr.getMeta('leaveMediaCaption') || before.parent.type.name !== 'mediaCaption') return true;
      // Formatting commands must not turn the image's surrounding paragraph into
      // a heading/list or change its alignment while the caption is being edited.
      const after = tr.selection.$from;
      if (after.parent.type.name !== 'mediaCaption') return true;
      if (before.depth !== after.depth) return false;
      for (let d = 1; d < before.depth - 1; d++) {
        if (!before.node(d).sameMarkup(after.node(d))) return false;
      }
      return true;
    } })];
  },
});
