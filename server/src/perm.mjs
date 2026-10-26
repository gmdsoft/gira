// 권한 판정.
// - 스페이스 권한(space_permissions): viewer/editor/admin. 규칙이 하나도 없으면 "전체 공개"
//   (로그인한 모든 사용자 editor) — 이관 직후의 기존 동작을 유지하기 위한 기본값.
// - 페이지 접근 제한(content_restrictions): Confluence와 같은 의미.
//   view 제한은 하위 페이지에 상속(조상 중 하나라도 막히면 못 봄), edit 제한은 해당 페이지만.
// - 사이트 관리자(users.is_admin)는 모든 검사를 통과한다.
import { query } from './db.mjs';

const ROLE_ORDER = { viewer: 1, editor: 2, admin: 3 };

// 요청 사용자 → { userId, isAdmin, groups } (비활성 사용자는 null)
export async function getAccess(userId) {
  const { rows: u } = await query(`SELECT id, is_admin FROM users WHERE id = $1 AND active`, [userId]);
  if (!u.length) return null;
  const { rows: g } = await query(`SELECT group_id FROM user_groups WHERE user_id = $1`, [userId]);
  return { userId: Number(userId), isAdmin: u[0].is_admin, groups: g.map((r) => Number(r.group_id)) };
}

function principalMatch(access, rows) {
  return rows.some((r) =>
    (r.principal_type === 'user' && Number(r.principal_id) === access.userId) ||
    (r.principal_type === 'group' && access.groups.includes(Number(r.principal_id))));
}

// 스페이스에서의 역할. null = 접근 불가
export async function spaceRole(access, spaceId) {
  if (access.isAdmin) return 'admin';
  const { rows } = await query(
    `SELECT principal_type, principal_id, role FROM space_permissions WHERE space_id = $1`, [spaceId]);
  if (!rows.length) return 'editor'; // 규칙 없음 = 전체 공개
  let best = null;
  for (const r of rows) {
    const match = r.principal_type === 'anyone' || principalMatch(access, [r]);
    if (match && (!best || ROLE_ORDER[r.role] > ROLE_ORDER[best])) best = r.role;
  }
  return best;
}

// 한 페이지에 대한 접근: { exists, view, edit, role, spaceId }
export async function contentAccess(access, contentId) {
  const { rows: chain } = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, space_id FROM content WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, c.space_id FROM content c JOIN up ON c.id = up.parent_id
     ) SELECT id, space_id FROM up`, [contentId]);
  if (!chain.length) return { exists: false, view: false, edit: false };
  const spaceId = chain[0].space_id;
  const role = await spaceRole(access, spaceId);
  if (!role) return { exists: true, view: false, edit: false, role, spaceId };
  if (role === 'admin') return { exists: true, view: true, edit: true, role, spaceId };
  const ids = chain.map((r) => r.id);
  const { rows: restr } = await query(
    `SELECT content_id, rtype, principal_type, principal_id
       FROM content_restrictions WHERE content_id = ANY($1::bigint[])`, [ids]);
  const view = viewPass(access, restr);
  const editRestr = restr.filter((r) => r.rtype === 'edit' && String(r.content_id) === String(contentId));
  const edit = view && ROLE_ORDER[role] >= ROLE_ORDER.editor &&
    (!editRestr.length || principalMatch(access, editRestr));
  return { exists: true, view, edit, role, spaceId };
}

// 조상 포함 view 제한을 전부 통과하는가 (restr: 조상 체인의 제한 행 전체)
function viewPass(access, restr) {
  const byNode = new Map();
  for (const r of restr) {
    if (r.rtype !== 'view') continue;
    const k = String(r.content_id);
    if (!byNode.has(k)) byNode.set(k, []);
    byNode.get(k).push(r);
  }
  for (const rows of byNode.values()) if (!principalMatch(access, rows)) return false;
  return true;
}

// 여러 콘텐츠 ID를 한 번에 view 필터 (검색 결과, 목록 API용). 반환: 볼 수 있는 ID의 Set(String)
export async function filterViewable(access, ids) {
  if (!ids.length) return new Set();
  if (access.isAdmin) return new Set(ids.map(String));
  const { rows: chain } = await query(
    `WITH RECURSIVE up AS (
       SELECT id AS root, id, parent_id, space_id FROM content WHERE id = ANY($1::bigint[])
       UNION ALL
       SELECT up.root, c.id, c.parent_id, c.space_id FROM content c JOIN up ON c.id = up.parent_id
     ) SELECT root, id, space_id FROM up`, [ids]);
  const allIds = [...new Set(chain.map((r) => String(r.id)))];
  const { rows: restr } = allIds.length ? await query(
    `SELECT content_id, rtype, principal_type, principal_id
       FROM content_restrictions WHERE rtype = 'view' AND content_id = ANY($1::bigint[])`, [allIds]) : { rows: [] };
  const restrByNode = new Map();
  for (const r of restr) {
    const k = String(r.content_id);
    if (!restrByNode.has(k)) restrByNode.set(k, []);
    restrByNode.get(k).push(r);
  }
  const roleBySpace = new Map();
  for (const sid of new Set(chain.map((r) => String(r.space_id)))) {
    roleBySpace.set(sid, await spaceRole(access, sid));
  }
  const chainByRoot = new Map();
  for (const r of chain) {
    const k = String(r.root);
    if (!chainByRoot.has(k)) chainByRoot.set(k, []);
    chainByRoot.get(k).push(r);
  }
  const ok = new Set();
  for (const [root, nodes] of chainByRoot) {
    const role = roleBySpace.get(String(nodes[0].space_id));
    if (!role) continue;
    if (role === 'admin') { ok.add(root); continue; }
    let pass = true;
    for (const n of nodes) {
      const rr = restrByNode.get(String(n.id));
      if (rr && !principalMatch(access, rr)) { pass = false; break; }
    }
    if (pass) ok.add(root);
  }
  return ok;
}

// 스페이스 트리 필터: 볼 수 있는 노드 ID Set을 반환. null = 전부 보임(제한 없음)
export async function visibleTreeSet(access, spaceId, role, treeRows) {
  if (access.isAdmin || role === 'admin') return null;
  const { rows: restr } = await query(
    `SELECT r.content_id, r.principal_type, r.principal_id
       FROM content_restrictions r JOIN content c ON c.id = r.content_id
      WHERE c.space_id = $1 AND r.rtype = 'view'`, [spaceId]);
  if (!restr.length) return null;
  const byNode = new Map();
  for (const r of restr) {
    const k = String(r.content_id);
    if (!byNode.has(k)) byNode.set(k, []);
    byNode.get(k).push(r);
  }
  const passNode = (n) => {
    const rr = byNode.get(String(n.id));
    return !rr || principalMatch(access, rr);
  };
  // 부모가 보여야 자식도 보인다 (view 제한 상속)
  const ids = new Set(treeRows.map((n) => String(n.id)));
  const children = new Map();
  const roots = [];
  for (const n of treeRows) {
    const pid = n.parent_id != null ? String(n.parent_id) : null;
    if (pid && ids.has(pid)) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(n);
    } else roots.push(n);
  }
  const ok = new Set();
  const stack = roots.filter(passNode);
  while (stack.length) {
    const n = stack.pop();
    ok.add(String(n.id));
    for (const k of children.get(String(n.id)) ?? []) if (passNode(k)) stack.push(k);
  }
  return ok;
}
