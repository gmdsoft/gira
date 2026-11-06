import React, { useEffect, useState } from 'react';
import { api } from './util.jsx';
function Gadget({ gadget }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null); setError('');
    if (gadget.params && !gadget.error) {
      const {filter, ...params} = gadget.params;
      api('/api/stats?' + new URLSearchParams(params)).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});
    }
    return () => {live=false;};
  }, [gadget]);
  return <article style={{border:'1px solid var(--border)',padding:16,margin:12}}>
    <h4>{gadget.title ?? '가젯'}</h4>
    {!gadget.params ? <p>지원하지 않는 가젯</p> : gadget.error || error ? <p role="alert">{gadget.error || error}</p> : !data ? <p>불러오는 중…</p> : <>
      <p>전체 {data.total}건</p>
      {data.type === 'results' ? <ul>{data.rows.map(r=><li key={r.issue_key}><a href={'/browse/'+r.issue_key}>{r.issue_key}</a> {r.summary}</li>)}</ul>
        : data.type === 'pie' ? <><svg viewBox="0 0 100 100" width="140" role="img" aria-label="원형 통계">{(() => {let offset=0; const sum=data.values.reduce((n,v)=>n+v.count,0); return data.values.map((v,i)=>{const size=sum ? v.count/sum*100 : 0; const start=offset;offset+=size;return <circle key={v.value} cx="50" cy="50" r="25" fill="none" stroke={`hsl(${i*67} 60% 50%)`} strokeWidth="50" pathLength="100" strokeDasharray={`${size} ${100-size}`} strokeDashoffset={-start} transform="rotate(-90 50 50)"/>;});})()}</svg><ul>{data.values.map(v=><li key={v.value}>{v.value || '없음'}: {v.count}</li>)}</ul></>
        : data.type === 'two' ? <table><thead><tr><th></th>{data.columns.map(c=><th key={c}>{c || '없음'}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.value}><th>{r.value || '없음'}</th>{data.columns.map(c=><td key={c}>{r.cells[c] ?? 0}</td>)}</tr>)}</tbody></table>
        : <><svg viewBox="0 0 400 140" width="100%" role="img" aria-label="생성 대 해결 추이">
          {['created','resolved'].map((metric,index)=>{const max=Math.max(1,...data.rows.flatMap(r=>[r.created,r.resolved]));return <polyline key={metric} fill="none" stroke={index?'#00875a':'#0052cc'} strokeWidth="2" points={data.rows.map((r,i)=>`${10+i*380/Math.max(1,data.rows.length-1)},${130-r[metric]*120/max}`).join(' ')}/>;})}
        </svg><p>파랑: 생성 · 초록: 해결</p><table><thead><tr><th>기간</th><th>생성</th><th>해결</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.created}</td><td>{r.resolved}</td></tr>)}</tbody></table></>}
    </>}
  </article>;
}
export default function Collections({ filters, onFilter, onRefresh }) {
  const [dashboards,setDashboards]=useState([]), [dashboard,setDashboard]=useState(null), [error,setError]=useState('');
  useEffect(()=>{api('/api/dashboards').then(setDashboards).catch(e=>setError(e.message));},[]);
  return <section style={{padding:20}}>
    <h2>필터</h2>
    {['내 필터','공유된 필터'].map((label,i)=><details key={label}><summary>{label}</summary>{filters.filter(f=>i ? !f.mine : f.mine).map(f=><div key={f.id}>
      <button className="plain" aria-label={f.favourite ? '즐겨찾기 해제' : '즐겨찾기 추가'} onClick={async()=>{try {await api(`/api/filters/${f.id}/favourite`,{method:'PUT',json:{favourite:!f.favourite}});await onRefresh();}catch(e){setError(e.message);}}}>{f.favourite?'★':'☆'}</button>
      <button className="plain" onClick={()=>onFilter(String(f.id))}>{f.name}</button>
    </div>)}</details>)}
    <h2>대시보드 <small>읽기 전용</small></h2>
    {error && <p role="alert">{error}</p>}
    <select aria-label="대시보드" value={dashboard?.id ?? ''} onChange={async e=>{setDashboard(null);if(e.target.value)try{setDashboard(await api('/api/dashboards/'+e.target.value));}catch(err){setError(err.message);}}}>
      <option value="">대시보드 선택</option>{dashboards.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
    {dashboard && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))'}}>{[...dashboard.gadgets].sort((a,b)=>(a.position?.column??0)-(b.position?.column??0)||(a.position?.row??0)-(b.position?.row??0)).map(g=><Gadget key={g.id} gadget={g}/>)}</div>}
  </section>;
}
