// 데이터베이스 내보내기·가져오기 대화 상자 (원본 ••• → 내보내기 / 템플릿 및 가져오기 대응)
import React, { useMemo, useState } from 'react';
import { Dialog, downloadBlob } from './MenuButton.jsx';
import { exportTable, toCsv, toHtml, safeFileName, csvTable, inferType, importCsv, suggestMapping, IMPORTABLE } from './database-io.mjs';
import { fieldTypes } from './DatabaseEditor.jsx';

const MAX_IMPORT_ROWS = 5000;

export function ExportDialog({ title, data, view, value, users, search, onClose }) {
  const [format, setFormat] = useState('csv');
  const [useView, setUseView] = useState(true);
  const run = () => {
    const table = exportTable(data, view, { useView, value, search, users });
    const name = safeFileName(useView ? `${title} - ${view.name}` : title);
    if (format === 'csv') downloadBlob(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    else if (format === 'html') downloadBlob(new Blob([toHtml(title, table)], { type: 'text/html;charset=utf-8' }), `${name}.html`);
    else {
      // PDF: 인쇄 화면을 열어 'PDF로 저장' (표가 길어도 쪽이 자연스럽게 나뉜다)
      const w = window.open('', '_blank');
      if (!w) { alert('팝업이 막혀 PDF 인쇄 화면을 열 수 없습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
      w.document.write(toHtml(title, table, { print: true }));
      w.document.close();
      w.onload = () => { w.focus(); w.print(); };
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* 닫힘 */ } }, 600);
    }
    onClose();
  };
  return <Dialog title="데이터베이스 내보내기" onClose={onClose}
    footer={<><button className="wb-btn" onClick={onClose}>취소</button><button className="wb-btn primary" onClick={run}>내보내기</button></>}>
    <div className="mb-field"><b>파일 형식</b>
      <div className="mb-choices">
        {[['csv', 'CSV'], ['html', 'HTML'], ['pdf', 'PDF']].map(([k, l]) => <label key={k}><input type="radio" name="fmt" checked={format === k} onChange={() => setFormat(k)} />{l}</label>)}
      </div>
      <p className="mb-help">{format === 'csv' ? '엑셀·스프레드시트·다른 데이터베이스로 옮길 때 (한글이 깨지지 않게 저장)' : format === 'html' ? '웹 페이지 표 — 다른 문서에 붙여 넣거나 보관할 때' : '인쇄 화면이 열리면 대상에서 ‘PDF로 저장’을 고르세요'}</p>
    </div>
    <label className="mb-check"><input type="checkbox" checked={useView} onChange={(e) => setUseView(e.target.checked)} />현재 보기 적용 ({view.name})</label>
    <p className="mb-help">{useView ? '이 보기의 필터·정렬·숨긴 열' + (search ? '과 검색어' : '') + '를 반영합니다.' : '모든 행과 열을 표 형태로 내보냅니다.'}</p>
  </Dialog>;
}

const decode = (buf) => {
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf;
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return utf; } // 엑셀이 저장한 한글 CSV
};

export function ImportDialog({ data, onApply, onClose }) {
  const [table, setTable] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const hasData = (data?.rows?.length ?? 0) > 0;
  const [mode, setMode] = useState(hasData ? 'newFields' : 'replace');
  const [mapping, setMapping] = useState([]);
  const targets = data.fields.filter((f) => IMPORTABLE.includes(f.type));
  const types = useMemo(() => table?.headers.map((_, i) => inferType(table.rows.map((r) => r[i]))) ?? [], [table]);

  const pick = async (file) => {
    setError(''); setTable(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('10MB가 넘는 파일은 가져올 수 없습니다'); return; }
    const t = csvTable(decode(await file.arrayBuffer()));
    if (!t.headers.length) { setError('읽을 수 있는 행이 없습니다'); return; }
    if (t.rows.length > MAX_IMPORT_ROWS) { setError(`한 번에 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다 (이 파일 ${t.rows.length}행)`); return; }
    setFileName(file.name); setTable(t); setMapping(suggestMapping(data, t.headers));
  };
  const apply = () => {
    if (mode === 'replace' && hasData && !confirm('지금 데이터베이스의 모든 필드와 값을 CSV 내용으로 바꿉니다. 계속할까요?')) return;
    if (mode === 'append' && !mapping.some(Boolean)) { setError('연결할 필드를 하나 이상 고르세요'); return; }
    onApply(importCsv(data, table, mode, { mapping }));
    onClose();
  };
  return <Dialog title="CSV 가져오기" wide onClose={onClose}
    footer={<><button className="wb-btn" onClick={onClose}>취소</button><button className="wb-btn primary" disabled={!table} onClick={apply}>가져오기</button></>}>
    <div className="mb-field"><b>CSV 파일</b>
      <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="mb-help">첫 줄은 필드 이름입니다. 숫자·링크·태그(값이 자주 겹치는 열)는 형식을 알아서 정하고, 나머지는 텍스트로 가져옵니다.</p>
      {error && <p className="mb-help" role="alert" style={{ color: '#c9372c' }}>{error}</p>}
    </div>
    {table && <>
      <p className="mb-help">{fileName} — {table.rows.length}행 · {table.headers.length}열</p>
      {hasData && <div className="mb-field"><b>이미 데이터가 있습니다 — 가져오는 방식</b>
        <div className="mb-choices">
          <label><input type="radio" name="mode" checked={mode === 'newFields'} onChange={() => setMode('newFields')} />새 필드로 추가</label>
          <label><input type="radio" name="mode" checked={mode === 'append'} onChange={() => setMode('append')} />기존 필드에 맞춰 행 추가</label>
          <label><input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />전체 교체</label>
        </div>
        <p className="mb-help">{mode === 'newFields' ? 'CSV 열을 오른쪽에 새 필드로 붙이고, 행은 위에서부터 채운 뒤 남는 행은 아래에 추가합니다.'
          : mode === 'append' ? 'CSV 열을 기존 필드에 연결해 새 행으로 추가합니다. 없는 선택지는 새로 만듭니다.'
            : '지금 필드와 값을 모두 지우고 CSV 내용으로 바꿉니다. 보기는 남기되 필터·정렬은 초기화합니다.'}</p>
      </div>}
      <table className="mb-table"><thead><tr><th>CSV 열</th><th>{mode === 'append' ? '연결할 필드' : '만들 필드 형식'}</th><th>예시</th></tr></thead>
        <tbody>{table.headers.map((h, i) => <tr key={i}>
          <td>{h}</td>
          <td>{mode === 'append'
            ? <select value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => { const n = [...m]; n[i] = e.target.value; return n; })}>
              <option value="">가져오지 않음</option>{targets.map((f) => <option key={f.id} value={f.id}>{f.name} ({fieldTypes[f.type] ?? f.type})</option>)}</select>
            : fieldTypes[types[i]] ?? types[i]}</td>
          <td className="muted">{table.rows.find((r) => r[i])?.[i]?.slice(0, 40) ?? ''}</td>
        </tr>)}</tbody></table>
    </>}
  </Dialog>;
}
