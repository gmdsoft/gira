import { HIDDEN_CUSTOM_FIELDS, HIDDEN_CUSTOM_TYPES } from './jira-custom-fields.mjs';
// JQL 부분집합 파서: 토크나이저 + 재귀 하강 → 파라미터 바인딩 SQL WHERE.
// 필드·연산자는 화이트리스트 매핑이며 값은 전부 $n 파라미터로만 들어간다 (SQL 주입 불가).
// 지원: = != ~ > >= < <=, IN / NOT IN, IS [NOT] EMPTY(=EMPTY/NULL), AND/OR/NOT, 괄호,
//       ORDER BY <필드> [ASC|DESC], currentUser(), openSprints(), 상대 날짜(-7d, -4w, -12h, -30m)

export class JqlError extends Error {
  constructor(msg, pos) { super(msg); this.pos = pos; }
}

// ---------- 토크나이저 ----------
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const pos = i;
    if (c === '(' || c === ')' || c === ',') { toks.push({ type: c, value: c, pos }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== c) { out += src[j]; j++; }
      if (j >= src.length) throw new JqlError('닫히지 않은 따옴표', pos);
      toks.push({ type: 'str', value: out, pos }); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '!=' || two === '>=' || two === '<=') { toks.push({ type: 'op', value: two, pos }); i += 2; continue; }
    if ('=~><'.includes(c)) { toks.push({ type: 'op', value: c, pos }); i++; continue; }
    let j = i, out = '';
    while (j < src.length && !/[\s(),=~><!"']/.test(src[j])) { out += src[j]; j++; }
    if (!out) throw new JqlError(`이해할 수 없는 문자 '${c}'`, pos);
    toks.push({ type: 'word', value: out, pos }); i = j;
  }
  toks.push({ type: 'eof', value: '', pos: src.length });
  return toks;
}

// ---------- 필드 정의 ----------
// kind: text(이름 비교) | search(요약+설명) | user | sprint | array(text[]) | date | key | parent
const FIELDS = {
  project: { kind: 'text', col: 'pr.key', label: 'project' },
  key: { kind: 'key', label: 'key' },
  issuekey: { kind: 'key', label: 'key' },
  summary: { kind: 'text', col: 'i.summary', like: true, label: 'summary' },
  text: { kind: 'search', label: 'text' },
  status: { kind: 'text', col: 's.name', label: 'status' },
  statuscategory: { kind: 'text', col: 's.category', label: 'statusCategory' }, // new|indeterminate|done
  type: { kind: 'text', col: 't.name', label: 'type' },
  issuetype: { kind: 'text', col: 't.name', label: 'type' },
  assignee: { kind: 'user', col: 'u.display_name', id: 'i.assignee_id', label: 'assignee' },
  reporter: { kind: 'user', col: 'ur.display_name', id: 'i.reporter_id', label: 'reporter' },
  priority: { kind: 'text', col: 'i.priority', label: 'priority' },
  resolution: { kind: 'text', col: 'i.resolution', label: 'resolution' },
  sprint: { kind: 'sprint', label: 'sprint' },
  labels: { kind: 'array', col: 'i.labels', label: 'labels' },
  label: { kind: 'array', col: 'i.labels', label: 'labels' },
  fixversion: { kind: 'array', col: 'i.fix_versions', label: 'fixVersion' },
  component: { kind: 'array', col: 'i.components', label: 'component' },
  parent: { kind: 'parent', label: 'parent' },
  created: { kind: 'date', col: 'i.created_at', label: 'created' },
  createddate: { kind: 'date', col: 'i.created_at', label: 'created' },
  updated: { kind: 'date', col: 'i.updated_at', label: 'updated' },
  updateddate: { kind: 'date', col: 'i.updated_at', label: 'updated' },
  resolved: { kind: 'date', col: 'i.resolved_at', label: 'resolved' },
};

// ORDER BY에서 쓸 수 있는 필드 → /api/issues sort 키
const ORDER_FIELDS = {
  key: 'key', issuekey: 'key', summary: 'summary', type: 'type', issuetype: 'type',
  assignee: 'assignee', reporter: 'reporter', priority: 'priority', status: 'status',
  resolution: 'resolution', created: 'created', createddate: 'created',
  updated: 'updated', updateddate: 'updated',
  rank: 'rank',
};

const REL_MS = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };

// ---------- 파서 ----------
class Parser {
  constructor(src, { p, userId, customFields = null }) {
    this.toks = tokenize(src);
    this.i = 0;
    this.p = p;           // 값 → $n 자리표시자 (호출자 params 배열에 push)
    this.userId = userId; // currentUser()
    // 사용자 정의 필드 목록 [{id, name, schema_type}] — 주면 필드 id를 미리 풀어 SQL에 바로 넣는다(빠름). 없으면 jira_fields를 행마다 조회
    this.customFields = customFields;
  }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isKw(t, kw) { return t.type === 'word' && t.value.toLowerCase() === kw; }
  fail(t, msg) { throw new JqlError(msg, t.pos); }

  parse() {
    // ORDER BY만 있는 쿼리 허용 (기본 모드 전환 시 정렬만 잔여 조건으로 남는 경우)
    const where = this.isKw(this.peek(), 'order') ? 'TRUE' : this.orExpr();
    let order = null;
    if (this.isKw(this.peek(), 'order')) {
      this.next();
      const by = this.next();
      if (!this.isKw(by, 'by')) this.fail(by, "ORDER 다음에는 BY가 와야 합니다");
      const f = this.next();
      if (f.type !== 'word') this.fail(f, 'ORDER BY 필드가 필요합니다');
      const key = ORDER_FIELDS[f.value.toLowerCase()];
      if (!key) this.fail(f, `정렬할 수 없는 필드 '${f.value}' (가능: ${[...new Set(Object.values(ORDER_FIELDS))].join(', ')})`);
      let desc = false;
      if (this.isKw(this.peek(), 'asc')) this.next();
      else if (this.isKw(this.peek(), 'desc')) { this.next(); desc = true; }
      order = (desc ? '-' : '') + key;
    }
    const end = this.peek();
    if (end.type !== 'eof') this.fail(end, `쿼리가 끝나야 할 자리에 '${end.value}'가 있습니다`);
    return { where, order };
  }

  orExpr() {
    let sql = this.andExpr();
    while (this.isKw(this.peek(), 'or')) { this.next(); sql = `(${sql} OR ${this.andExpr()})`; }
    return sql;
  }
  andExpr() {
    let sql = this.notExpr();
    while (this.isKw(this.peek(), 'and')) { this.next(); sql = `(${sql} AND ${this.notExpr()})`; }
    return sql;
  }
  notExpr() {
    if (this.isKw(this.peek(), 'not')) { this.next(); return `(NOT ${this.notExpr()})`; }
    if (this.peek().type === '(') {
      this.next();
      const sql = this.orExpr();
      const close = this.next();
      if (close.type !== ')') this.fail(close, "')'가 필요합니다");
      return sql;
    }
    return this.condition();
  }

  condition() {
    const ft = this.next();
    if (!['word', 'str'].includes(ft.type)) this.fail(ft, '필드 이름이 필요합니다');
    const customId = ft.value.match(/^cf\[(\d+)\]$/i)?.[1];
    if (HIDDEN_CUSTOM_FIELDS.includes(customId ? `customfield_${customId}` : ft.value)) this.fail(ft, '내부 필드는 검색할 수 없습니다');
    const field = FIELDS[ft.value.toLowerCase()] ?? ((customId || ft.type === 'str' || /^customfield_\d+$/.test(ft.value)) ? { kind: 'custom', label: ft.value, id: customId ? `customfield_${customId}` : /^customfield_\d+$/.test(ft.value) ? ft.value : null } : null);
    if (!field) this.fail(ft, `알 수 없는 필드 '${ft.value}' (가능: ${[...new Set(Object.values(FIELDS).map((f) => f.label))].join(', ')})`);

    const t = this.next();
    // IS [NOT] EMPTY
    if (this.isKw(t, 'is')) {
      let neg = false;
      if (this.isKw(this.peek(), 'not')) { this.next(); neg = true; }
      const e = this.next();
      if (!this.isKw(e, 'empty') && !this.isKw(e, 'null')) this.fail(e, 'IS 다음에는 EMPTY가 와야 합니다');
      const empty = this.emptySql(field, ft);
      return neg ? `(NOT ${empty})` : empty;
    }
    // [NOT] IN (...)
    if (this.isKw(t, 'in') || (this.isKw(t, 'not') && this.isKw(this.peek(), 'in'))) {
      const neg = this.isKw(t, 'not');
      if (neg) this.next();
      // IN (a, b, ...) 또는 IN openSprints() 같은 함수 단일 값
      const vals = this.peek().type === '(' ? this.valueList(field, ft) : [this.value(field, ft)];
      const ors = vals.map((v) => this.eqSql(field, ft, v)).join(' OR ');
      return neg ? this.negSql(field, ft, ors) : `(${ors})`;
    }
    if (t.type !== 'op') this.fail(t, `'${ft.value}' 다음에는 연산자(=, !=, ~, >, <, IN, IS)가 와야 합니다`);
    const v = this.value(field, ft);
    switch (t.value) {
      case '=': return this.eqSql(field, ft, v);
      case '!=': return this.negSql(field, ft, this.eqSql(field, ft, v));
      case '~': {
        if (field.kind === 'search') return this.searchSql(v);
        if (field.kind === 'custom') {
          if (v.empty || v.fn) this.fail(ft, '검색어가 필요합니다');
          return this.customSql(field, ft, `EXISTS (SELECT 1 FROM unnest(jira_custom_search(i.fields_raw -> cf.id)) x WHERE x ILIKE ${this.p('%' + v.value + '%')})`);
        }
        if (field.kind !== 'text') this.fail(ft, `'~'는 텍스트 필드에만 쓸 수 있습니다 (${field.label})`);
        return `${field.col} ILIKE ${this.p('%' + v.value + '%')}`;
      }
      case '>': case '>=': case '<': case '<=': {
        if (field.kind === 'date') return `${field.col} ${t.value} ${this.p(this.dateValue(v, ft))}`;
        if (field.kind === 'key') return `(split_part(i.issue_key, '-', 2))::bigint ${t.value} ${this.p(this.keyNum(v, ft))}`;
        this.fail(ft, `'${t.value}'는 날짜·키 필드에만 쓸 수 있습니다 (${field.label})`);
      }
      default: this.fail(t, `지원하지 않는 연산자 '${t.value}'`);
    }
  }

  // 값 하나: 문자열/단어/함수. EMPTY 단어는 {empty:true}
  value(field, ft) {
    const t = this.next();
    if (t.type === 'str') return { value: t.value };
    if (t.type !== 'word') this.fail(t, '값이 필요합니다 (문자열은 따옴표로 묶을 수 있습니다)');
    if (this.peek().type === '(') { // 함수
      this.next();
      const close = this.next();
      if (close.type !== ')') this.fail(close, "함수 호출은 '()'로 닫아야 합니다");
      const fn = t.value.toLowerCase();
      if (fn === 'currentuser') return { fn: 'currentUser' };
      if (fn === 'opensprints') return { fn: 'openSprints' };
      if (fn === 'activesprints') return { fn: 'activeSprints' };
      if (fn === 'unreleasedversions') return { fn: 'unreleasedVersions' };
      if (fn === 'releasedversions') return { fn: 'releasedVersions' };
      this.fail(t, `알 수 없는 함수 '${t.value}()' (가능: currentUser(), openSprints(), activeSprints(), unreleasedVersions(), releasedVersions())`);
    }
    if (['empty', 'null'].includes(t.value.toLowerCase())) return { empty: true };
    return { value: t.value };
  }
  valueList(field, ft) {
    const open = this.next();
    if (open.type !== '(') this.fail(open, "IN 다음에는 '('가 필요합니다");
    const vals = [];
    for (;;) {
      vals.push(this.value(field, ft));
      const t = this.next();
      if (t.type === ')') break;
      if (t.type !== ',') this.fail(t, "',' 또는 ')'가 필요합니다");
    }
    return vals;
  }

  // != / NOT IN: Jira 의미론대로 EMPTY(미지정)인 이슈는 결과에서 제외한다
  negSql(field, ft, ors) {
    const canEmpty = ['text', 'user', 'sprint', 'array', 'parent', 'date', 'custom'].includes(field.kind);
    const base = `(NOT (${ors}))`;
    return canEmpty ? `((NOT ${this.emptySql(field, ft)}) AND ${base})` : base;
  }

  emptySql(field, ft) {
    switch (field.kind) {
      case 'custom': return `(NOT ${this.customSql(field, ft, 'cardinality(jira_custom_search(i.fields_raw -> cf.id)) > 0')})`;
      case 'user': case 'sprint': return `${field.kind === 'sprint' ? 'i.sprint_id' : field.id} IS NULL`;
      case 'array': return `(${field.col} IS NULL OR cardinality(${field.col}) = 0)`;
      case 'parent': return `i.parent_id IS NULL`;
      case 'text': return `(${field.col} IS NULL OR ${field.col} = '')`;
      case 'date': return `${field.col} IS NULL`;
      default: this.fail(ft, `'${field.label}'에는 EMPTY를 쓸 수 없습니다`);
    }
  }

  // field = value (IN도 이 조합의 OR)
  eqSql(field, ft, v) {
    if (v.empty) return this.emptySql(field, ft);
    if (v.fn === 'currentUser') {
      if (field.kind !== 'user') this.fail(ft, `currentUser()는 assignee/reporter에만 쓸 수 있습니다`);
      return `${field.id} = ${this.p(this.userId)}`;
    }
    if (v.fn === 'openSprints') {
      if (field.kind !== 'sprint') this.fail(ft, `openSprints()는 sprint에만 쓸 수 있습니다`);
      return `i.sprint_id IN (SELECT id FROM jira_sprints WHERE state <> 'closed')`;
    }
    if (v.fn === 'activeSprints') {
      if (field.kind !== 'sprint') this.fail(ft, `activeSprints()는 sprint에만 쓸 수 있습니다`);
      return `i.sprint_id IN (SELECT id FROM jira_sprints WHERE state = 'active')`;
    }
    // 수정 버전 함수: 이슈 프로젝트의 버전 중 출시 여부로 (칸반 보드 하위 필터 'fixVersion in unreleasedVersions()')
    if (v.fn === 'unreleasedVersions' || v.fn === 'releasedVersions') {
      if (field.label !== 'fixVersion') this.fail(ft, `${v.fn}()는 fixVersion에만 쓸 수 있습니다`);
      const cond = v.fn === 'releasedVersions' ? 'COALESCE(_v.released, false)' : 'NOT COALESCE(_v.released, false)';
      return `EXISTS (SELECT 1 FROM unnest(i.fix_versions) _x JOIN jira_versions _v
                       ON _v.project_id = i.project_id AND lower(_v.name) = lower(_x) WHERE ${cond})`;
    }
    switch (field.kind) {
      case 'custom': {
        const value = this.p(v.value);
        const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.value);
        const comparison = numeric ? `CASE WHEN cf.schema_type = 'number' AND x ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN x::numeric = ${value}::numeric ELSE lower(x) = lower(${value}) END` : `lower(x) = lower(${value})`;
        return this.customSql(field, ft, `EXISTS (SELECT 1 FROM unnest(jira_custom_search(i.fields_raw -> cf.id)) x WHERE ${comparison})`);
      }
      case 'text': case 'user':
        return `(${field.col} IS NOT NULL AND lower(${field.col}) = lower(${this.p(v.value)}))`;
      case 'sprint':
        return `(sp.name IS NOT NULL AND lower(sp.name) = lower(${this.p(v.value)}))`;
      case 'array':
        return `EXISTS (SELECT 1 FROM unnest(${field.col}) _x WHERE lower(_x) = lower(${this.p(v.value)}))`;
      case 'key':
        return `i.issue_key = upper(${this.p(v.value)})`;
      case 'parent':
        return `p1.issue_key = upper(${this.p(v.value)})`;
      case 'date':
        return `${field.col}::date = ${this.p(this.dateValue(v, ft))}::date`;
      case 'search':
        this.fail(ft, `text 필드에는 '~'만 쓸 수 있습니다 (예: text ~ "검색어")`);
      default:
        this.fail(ft, `'${field.label}'에는 =/IN을 쓸 수 없습니다`);
    }
  }

  customSql(field, ft, condition) {
    if (this.customFields) {
      const hits = this.customFields.filter((f) => (field.id ? f.id === field.id : f.name.toLowerCase() === String(ft.value).toLowerCase()));
      if (!hits.length) this.fail(ft, `알 수 없는 사용자 정의 필드 '${ft.value}'`);
      // 같은 이름 필드가 여럿이면(예: Story Points 두 종류) 어느 하나라도 맞으면 참
      // 자리표시자는 실제로 쓰일 때만 만든다 — 쓰이지 않는 $n이 있으면 PostgreSQL이 형식을 정하지 못한다
      const sub = (c, f) => {
        let out = c;
        if (out.includes('i.fields_raw -> cf.id')) { const ph = `${this.p(f.id)}::text`; out = out.replaceAll('i.fields_raw -> cf.id', `i.fields_raw -> ${ph}`); }
        if (out.includes('cf.schema_type')) { const ph = `${this.p(f.schema_type ?? '')}::text`; out = out.replaceAll('cf.schema_type', ph); }
        return out;
      };
      return `(${hits.map((f) => `(${sub(condition, f)})`).join(' OR ')})`;
    }
    const lookup = field.id ? `cf.id = ${this.p(field.id)}` : `lower(cf.name) = lower(${this.p(ft.value)})`;
    return `EXISTS (SELECT 1 FROM jira_fields cf WHERE cf.custom AND ${lookup}
      AND NOT (cf.id = ANY(${this.p(HIDDEN_CUSTOM_FIELDS)}::text[]))
      AND COALESCE(cf.schema_custom, '') !~ ${this.p(HIDDEN_CUSTOM_TYPES.join('|'))}
      AND (${condition}))`;
  }

  searchSql(v) {
    if (v.empty || v.fn) throw new JqlError('text ~ 에는 검색어가 필요합니다', 0);
    const q = this.p('%' + v.value + '%');
    return `(i.summary ILIKE ${q} OR i.description_adf::text ILIKE ${q})`;
  }

  dateValue(v, ft) {
    if (v.empty || v.fn) this.fail(ft, '날짜 값이 필요합니다 (예: 2026-01-01, -7d)');
    const rel = v.value.match(/^-(\d+)([mhdw])$/i);
    if (rel) return new Date(Date.now() - Number(rel[1]) * REL_MS[rel[2].toLowerCase()]).toISOString();
    if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(v.value)) {
      this.fail(ft, `날짜 형식이 아닙니다: '${v.value}' (예: 2026-01-01, "2026-01-01 09:00", -7d, -4w)`);
    }
    return v.value;
  }
  keyNum(v, ft) {
    const m = String(v.value ?? '').match(/-(\d+)$/) ?? String(v.value ?? '').match(/^(\d+)$/);
    if (!m) this.fail(ft, `이슈 키 또는 번호가 필요합니다 (예: NEXT-100)`);
    return Number(m[1]);
  }
}

// 반환: { where, order }  — where는 괄호로 감싼 SQL 조각, order는 sort 키('-updated' 등) 또는 null
export function parseJql(src, { p, userId, customFields }) {
  const parser = new Parser(src, { p, userId, customFields });
  return parser.parse();
}
