// 내부·자동 필드는 표시와 검색에서 함께 제외한다.
export const HIDDEN_CUSTOM_FIELDS = ['customfield_10019', 'customfield_10080', 'customfield_10081', 'customfield_10082', 'customfield_10000', 'customfield_10025', 'customfield_10024', 'customfield_10011', 'customfield_10012', 'customfield_10013', 'customfield_10017'];
export const HIDDEN_CUSTOM_TYPES = ['sd-sla-field', 'gh-sprint'];
export function fieldType(f) {
  const type = f.schema_custom?.split(':').pop();
  if (type === 'jsw-story-points' || type === 'gh-story-points') return 'float';
  if (type) return type;
  return ({ option: 'select', number: 'float', string: 'textfield', date: 'datepicker', user: 'userpicker' })[f.schema_type] ?? f.schema_type;
}
export function visibleField(f) {
  return f.custom && !HIDDEN_CUSTOM_FIELDS.includes(f.id) && !HIDDEN_CUSTOM_TYPES.some(type => (f.schema_custom ?? '').includes(type));
}
export function searchValues(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(searchValues);
  if (typeof value !== 'object') return [String(value)];
  return ['value', 'displayName', 'accountId', 'name', 'text', 'content', 'start', 'end'].flatMap(k => searchValues(value[k]));
}
export function displayValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value !== 'object') return String(value);
  if (value.displayName) return value.displayName;
  if (value.type === 'doc') return (value.content ?? []).map(displayValue).join('\n');
  if (value.content) return value.content.map(displayValue).join('');
  return displayValue(value.value ?? value.name ?? value.text ?? (value.start != null || value.end != null ? [value.start, value.end].filter(v => v != null) : value.accountId));
}
export function fieldOptions(f, projectId, issueTypeId) {
  return (f.options ?? []).filter(c => (c.isGlobalContext || c.projectIds?.map(String).includes(String(projectId))) &&
    (c.isAnyIssueType || c.issueTypeIds?.map(String).includes(String(issueTypeId)))).flatMap(c => c.options ?? []).filter(o => !o.disabled);
}
export function normalizeCustomFields(definitions, raw = {}, projectId, issueTypeId) {
  return definitions.filter(visibleField).flatMap(f => {
    const value = raw?.[f.id];
    const values = searchValues(value);
    if (!values.length) return [];
    const type = fieldType(f);
    const options = fieldOptions(f, projectId, issueTypeId);
    const editable = ['select', 'radiobuttons', 'multicheckboxes', 'multiselect'].includes(type) ? options.length > 0 : ['labels', 'textfield', 'url', 'float', 'datepicker'].includes(type);
    return [{ id: f.id, name: f.name, type, value, display: displayValue(value), options, editable,
      storyPoints: /^(Story Points|Story point estimate)$/i.test(f.name) || ['customfield_10041', 'customfield_10016'].includes(f.id) || /jsw-story-points/.test(f.schema_custom ?? '') }];
  });
}
export function validateCustomPatch(patch, definitions, projectId, issueTypeId) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('customFields는 객체여야 합니다');
  const out = {};
  for (const [id, value] of Object.entries(patch)) {
    const f = definitions.find(f => f.id === id && visibleField(f));
    if (!f) throw new Error(`알 수 없는 사용자 정의 필드: ${id}`);
    const type = fieldType(f);
    if (!['select', 'radiobuttons', 'multicheckboxes', 'multiselect', 'labels', 'textfield', 'url', 'float', 'datepicker'].includes(type)) throw new Error(`${f.name}: 읽기 전용 필드입니다`);
    if (value === null) { out[id] = null; continue; }
    const fail = () => { throw new Error(`${f.name}: 올바르지 않은 값입니다`); };
    if (['select', 'radiobuttons', 'multicheckboxes', 'multiselect'].includes(type)) {
      const options = fieldOptions(f, projectId, issueTypeId);
      const one = v => { const o = options.find(o => String(o.id) === String(v?.id ?? v)); if (!o) fail(); return { id: String(o.id), value: o.value }; };
      if (['multicheckboxes', 'multiselect'].includes(type)) { if (!Array.isArray(value)) fail(); out[id] = value.map(one); }
      else out[id] = one(value);
    } else if (type === 'float') { if (typeof value !== 'number' || !Number.isFinite(value)) fail(); out[id] = value; }
    else if (type === 'labels') { if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) fail(); out[id] = value; }
    else {
      if (typeof value !== 'string') fail();
      if (type === 'datepicker' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail();
      if (type === 'url') { try { if (!['http:', 'https:'].includes(new URL(value).protocol)) fail(); } catch { fail(); } }
      out[id] = value;
    }
  }
  return out;
}
