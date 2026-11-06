// 설명 편집기: TipTap(React) + ADF 왕복 변환
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Underline, LinkMark, PreservedMedia, PreservedMediaInline, adfToTiptap } from './adf-convert.js';

const TOOLBAR = [
  ['bold', <b key="b">B</b>], ['italic', <i key="i">I</i>], ['underline', <u key="u">U</u>],
  ['strike', <s key="s">S</s>], ['code', '</>'],
  '|', ['h2', 'H2'], ['h3', 'H3'],
  '|', ['bullet', '• 목록'], ['ordered', '1. 목록'],
  '|', ['quote', '❝ 인용'], ['codeblock', '코드'], ['hr', '―'],
  '|', ['link', '🔗 링크'], ['table', '표'],
];

function runCmd(editor, cmd) {
  const c = editor.chain().focus();
  switch (cmd) {
    case 'bold': return c.toggleBold().run();
    case 'italic': return c.toggleItalic().run();
    case 'underline': return c.toggleMark('underline').run();
    case 'strike': return c.toggleStrike().run();
    case 'code': return c.toggleCode().run();
    case 'h2': return c.toggleHeading({ level: 2 }).run();
    case 'h3': return c.toggleHeading({ level: 3 }).run();
    case 'bullet': return c.toggleBulletList().run();
    case 'ordered': return c.toggleOrderedList().run();
    case 'quote': return c.toggleBlockquote().run();
    case 'codeblock': return c.toggleCodeBlock().run();
    case 'hr': return c.setHorizontalRule().run();
    case 'link': {
      const url = prompt('링크 URL (비우면 제거)');
      if (url === null) return;
      return url.trim() ? c.toggleMark('link', { href: url.trim() }).run() : c.unsetMark('link').run();
    }
    case 'table': return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }
}

export default function DescEditor({ initialAdf, onReady }) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, LinkMark, PreservedMedia, PreservedMediaInline,
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: initialAdf ? adfToTiptap(initialAdf) : '',
  });
  useEffect(() => { if (editor) onReady?.(editor); }, [editor]);
  return (
    <>
      <div className="etoolbar">
        {TOOLBAR.map((t, i) => t === '|'
          ? <span key={i} className="sep" />
          : <button key={i} type="button" title={t[0]} onMouseDown={(e) => { e.preventDefault(); if (editor) runCmd(editor, t[0]); }}>{t[1]}</button>)}
      </div>
      <div className="editor-box adf"><EditorContent editor={editor} /></div>
    </>
  );
}
