import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const TYPE_ICON = { folder: '📁', whiteboard: '🖊️', database: '🗄️', embed: '🔗', live: '⚡' };

// 페이지 이동 대화상자: 실제 스페이스 트리에서 새 상위 문서를 고른다.
// 자기 자신과 그 하위 트리는 선택 불가(순환 방지) 표시.
export default function MoveDialog({ page, navigate, reloadSpace, onClose }) {
  const [spaces, setSpaces] = useState([]);
  const [spaceKey, setSpaceKey] = useState(page.spaceKey);
  const [tree, setTree] = useState(null);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState(undefined); // undefined=미선택, null=최상위, {id,title}
  const [openSet, setOpenSet] = useState(() => new Set());

  useEffect(() => { api('/api/spaces').then(setSpaces).catch(() => {}); }, []);
  useEffect(() => {
    setTree(null); setTarget(undefined); setQ('');
    api(`/api/spaces/${spaceKey}`)
      .then((s) => {
        setTree(s.tree);
        setOpenSet(new Set(s.tree.filter((r) => r.parent_id == null).map((r) => String(r.id))));
      })
      .catch(() => setTree([]));
  }, [spaceKey]);

  const { roots, childrenMap, excluded, currentParent } = useMemo(() => {
    const map = new Map();
    const ids = new Set((tree ?? []).map((n) => String(n.id)));
    const roots = [];
    for (const n of tree ?? []) {
      const pid = n.parent_id != null ? String(n.parent_id) : null;
      if (pid && ids.has(pid)) {
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid).push(n);
      } else roots.push(n);
    }
    const excluded = new Set();
    if (spaceKey === page.spaceKey) {
      const mark = (id) => { excluded.add(id); for (const ch of map.get(id) ?? []) mark(String(ch.id)); };
      mark(String(page.id));
    }
    const me = (tree ?? []).find((n) => String(n.id) === String(page.id));
    return { roots, childrenMap: map, excluded, currentParent: me?.parent_id != null ? String(me.parent_id) : null };
  }, [tree, page.id, spaceKey, page.spaceKey]);

  const move = async () => {
    const res = await fetch(`/api/content/${page.id}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target ? { parentId: target.id } : { spaceKey }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '이동 실패'); return; }
    const { spaceKey: destKey } = await res.json();
    onClose();
    reloadSpace?.();
    navigate(`/s/${destKey}/p/${page.id}`);
  };

  const pick = (node) => setTarget({ id: node.id, title: node.title });
  const toggle = (id) => setOpenSet((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const Row = ({ node, depth }) => {
    const id = String(node.id);
    const kids = childrenMap.get(id) ?? [];
    const disabled = excluded.has(id);
    const isParentNow = currentParent === id;
    return (
      <div>
        <div className={`move-tree-row ${target?.id === node.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
             style={{ paddingLeft: depth * 18 + 6 }}>
          {kids.length > 0
            ? <button className="tree-toggle" onClick={() => toggle(id)}>{openSet.has(id) ? '▾' : '▸'}</button>
            : <span className="tree-toggle" />}
          <button className="move-tree-label" disabled={disabled} onClick={() => pick(node)}>
            <span className="tree-icon">{TYPE_ICON[node.type] ?? '📄'}</span>{node.title}
            {disabled && <span className="muted"> (이동할 문서{excluded.size > 1 ? ' 포함' : ''})</span>}
            {isParentNow && <span className="status status-grey">현재 위치</span>}
          </button>
        </div>
        {openSet.has(id) && kids.map((k) => <Row key={k.id} node={k} depth={depth + 1} />)}
      </div>
    );
  };

  const query = q.trim().toLowerCase();
  const matches = query
    ? (tree ?? []).filter((n) => n.title.toLowerCase().includes(query) && !excluded.has(String(n.id))).slice(0, 30)
    : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-move" onClick={(e) => e.stopPropagation()}>
        <h2>페이지 이동</h2>
        <p className="muted">"{page.title}" (하위 포함) 을 둘 위치를 선택하세요.</p>
        <div className="move-controls">
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)}>
            {spaces.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
          </select>
          <input value={q} placeholder="제목으로 찾기" onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="move-results">
          <button className={`move-tree-row move-root ${target === null ? 'selected' : ''}`}
            onClick={() => setTarget(null)}>🏠 (스페이스 최상위)</button>
          {!tree && <p className="muted move-loading">트리 불러오는 중…</p>}
          {matches
            ? matches.map((n) => (
                <button key={n.id} className={`move-tree-row ${target?.id === n.id ? 'selected' : ''}`}
                  style={{ paddingLeft: 24 }} onClick={() => pick(n)}>
                  <span className="tree-icon">{TYPE_ICON[n.type] ?? '📄'}</span>{n.title}
                </button>
              ))
            : roots.map((n) => <Row key={n.id} node={n} depth={0} />)}
          {matches && !matches.length && <p className="muted move-loading">일치하는 문서가 없습니다.</p>}
        </div>
        <div className="modal-actions">
          <span className="muted move-picked">
            {target === undefined ? '위치를 선택하세요' : target === null ? '→ 스페이스 최상위' : `→ ${target.title}`}
          </span>
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" disabled={target === undefined} onClick={move}>이동</button>
        </div>
      </div>
    </div>
  );
}
