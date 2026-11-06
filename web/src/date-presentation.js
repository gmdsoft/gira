// ISO 날짜를 지역 달력 날짜로 비교한다. 원래 값은 복사/붙여넣기에도 보존한다.
export function datePresentation(value, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return { class: `date-lozenge${valid && value === today ? ' date-today' : valid && value < today ? ' date-past' : ''}`, 'data-date': value };
}
