// 버전 간 텍스트 diff: 블록 단위 LCS → 변경 블록은 단어 단위 LCS로 하이라이트.
// 서식 변경은 다루지 않는 텍스트 비교다 (PoC — 구조 diff는 후순위).

const BLOCK_KINDS = {
  heading: (n) => `제목${n.attrs?.level ?? 1}`,
  codeBlock: () => '코드',
  taskItem: () => '작업',
};

// doc → [{kind, text}] 블록 텍스트 목록
export function extractBlocks(doc) {
  const out = [];
  const textOf = (node) => {
    let s = '';
    const walk = (n) => {
      if (n.type === 'text') s += n.text ?? '';
      else if (n.attrs?.text) s += n.attrs.text;
      for (const c of n.content ?? []) walk(c);
    };
    walk(node);
    return s.trim();
  };
  const visit = (node) => {
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
      const t = textOf(node);
      if (t) out.push({ kind: BLOCK_KINDS[node.type]?.(node) ?? null, text: t });
      return;
    }
    for (const c of node.content ?? []) visit(c);
  };
  visit(doc);
  return out;
}

// 일반 LCS (양쪽 최대 3000 항목까지)
function lcs(a, b, eq) {
  const n = Math.min(a.length, 3000), m = Math.min(b.length, 3000);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = []; // {op:'same'|'del'|'add', i?, j?}
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { ops.push({ op: 'same', i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', i }); i++; }
    else { ops.push({ op: 'add', j }); j++; }
  }
  while (i < n) ops.push({ op: 'del', i: i++ });
  while (j < m) ops.push({ op: 'add', j: j++ });
  return ops;
}

// 단어 단위 diff → [{t, op:'same'|'del'|'add'}]
export function diffWords(oldText, newText) {
  const tok = (s) => s.split(/(\s+)/).filter((x) => x !== '');
  const a = tok(oldText), b = tok(newText);
  return lcs(a, b, (x, y) => x === y).map((o) =>
    o.op === 'same' ? { t: a[o.i], op: 'same' } : o.op === 'del' ? { t: a[o.i], op: 'del' } : { t: b[o.j], op: 'add' });
}

// 블록 diff → [{op:'same'|'del'|'add'|'mod', kind, text?, words?}]
export function diffDocs(oldDoc, newDoc) {
  const a = extractBlocks(oldDoc ?? { content: [] });
  const b = extractBlocks(newDoc ?? { content: [] });
  const ops = lcs(a, b, (x, y) => x.text === y.text);
  // 인접한 del 묶음 + add 묶음은 수정으로 보고 쌍을 지어 단어 diff
  const rows = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === 'same') { rows.push({ op: 'same', ...a[ops[k].i] }); k++; continue; }
    const dels = []; const adds = [];
    while (k < ops.length && ops[k].op !== 'same') {
      if (ops[k].op === 'del') dels.push(a[ops[k].i]); else adds.push(b[ops[k].j]);
      k++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      rows.push({ op: 'mod', kind: adds[p].kind, words: diffWords(dels[p].text, adds[p].text) });
    }
    for (let p = pairs; p < dels.length; p++) rows.push({ op: 'del', ...dels[p] });
    for (let p = pairs; p < adds.length; p++) rows.push({ op: 'add', ...adds[p] });
  }
  return rows;
}
