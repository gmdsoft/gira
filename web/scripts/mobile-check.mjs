// Build both web apps first; CHROMIUM_BIN=/path/to/chromium node web/scripts/mobile-check.mjs
// Fixture-only CDP capture: no listening port, DB, or real API connections.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../', import.meta.url));
const text=s=>({type:'text',text:s});
const doc={type:'doc',content:[{type:'paragraph',content:[text('모바일 브라우저에서도 긴 문서와 이슈 설명을 편하게 읽습니다. '.repeat(6))]},{type:'paragraph',content:[text('https://example.test/'+ 'long-path/'.repeat(20))]}]};
const statuses=[{id:1,name:'해야 할 일',category:'new'},{id:2,name:'진행 중',category:'indeterminate'},{id:3,name:'완료',category:'done'}];
const rows=statuses.map((s,i)=>({id:i+1,issue_key:`DEMO-${i+1}`,summary:'모바일 보기 전용 테스트 — 긴 제목과 여러 상태의 카드를 확인합니다',status_id:s.id,status_name:s.name,status_category:s.category,type_name:'작업',issue_type_id:1,priority:'Normal',labels:['모바일'],fix_versions:[],updated_at:'2026-11-06T00:00:00Z'}));
const me={id:1,display_name:'테스트 사용자',can_create:true};
const space={id:1,key:'DEMO',name:'모바일 테스트',role:'admin',tree:[{id:1,title:'모바일 문서',type:'page',children:[]}]};
let writes=[];
function fixture(url){const u=new URL(url,'http://test');const p=u.pathname;
 if(p==='/api/auth/me')return me;
 if(p==='/api/meta')return {projects:[{id:1,key:'DEMO',name:'모바일 테스트 프로젝트'}],statuses,types:[{id:1,name:'작업'}],priorities:['Normal'],assignees:[me]};
 if(p==='/api/issues')return {rows,total:rows.length};
 if(p.startsWith('/api/issue/'))return {...rows[0],description_adf:doc,attachments:[],subtasks:[rows[1]],links:[],comments:[{id:1,author_name:me.display_name,body_adf:doc,created_at:'2026-11-06T00:00:00Z'}],history:[],changelog:[],components:[]};
 if(p==='/api/labels')return {labels:['모바일'],components:[]};
 if(p==='/api/people')return [me];
 if(p==='/api/spaces')return [space];
 if(p==='/api/spaces/DEMO')return space;
 if(p.includes('/comments') || p.includes('presence'))return [];
 if(p==='/api/content/1')return {id:1,title:'모바일 문서 보기 — 긴 제목 확인',spaceKey:'DEMO',space_key:'DEMO',status:'current',type:'page',labels:['모바일'],children:[],version:{version:1,doc,author_name:me.display_name}};
 if(p==='/api/search')return {total:1,hits:[{id:1,title:'모바일 문서 보기',spaceKey:'DEMO',type:'page',excerpts:['모바일 브라우저에서 검색 결과를 확인합니다. '.repeat(8)]}]};
 return [];
}
const {spawn} = await import('node:child_process');
const chrome=spawn(process.env.CHROMIUM_BIN || 'chromium',['--no-sandbox','--remote-debugging-pipe',`--user-data-dir=${await fs.mkdtemp('/tmp/gira-12-browser-')}`,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
chrome.stderr.on('data',b=>process.stderr.write(b));
chrome.on('error', e => { console.error(e.message); process.exit(1); });
chrome.on('exit', code => { if (code) process.exit(code); });
for (const pipe of [chrome.stdio[3], chrome.stdio[4]]) pipe.on('error', e => { console.error(e.message); process.exit(1); });
const deadline=setTimeout(() => { console.error('Browser verification timed out'); chrome.kill(); process.exit(1); }, 30000);
let id=0;const pending=new Map();const errors=[];let buffer='';let session;
const cmd=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(m.error):resolve(m.result));chrome.stdio[3].write(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
chrome.stdio[4].on('data',b=>{buffer+=b;let idx;while((idx=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,idx));buffer=buffer.slice(idx+1);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails));if(m.method==='Fetch.requestPaused')respond(m.params).catch(console.error);}});
async function respond({requestId,request}) {
 const u=new URL(request.url);let body;let contentType='application/json';
 if(u.pathname.startsWith('/api/')){if(request.method!=='GET')writes.push([request.method,u.pathname]);body=Buffer.from(JSON.stringify(fixture(u.pathname+u.search)));}
 else {const jira=u.pathname.startsWith('/browse/')||u.pathname.startsWith('/projects/')||u.pathname.startsWith('/jira/');const base=path.join(root,'web',jira?'dist-jira-app':'dist');let file;if(u.pathname.includes('/assets/')){const name=path.basename(u.pathname);file=path.join(root,'web',name.startsWith('jira-')?'dist-jira-app':'dist','assets',name);}else file=path.join(base,jira?'jira.html':'index.html');try{body=await fs.readFile(file);}catch{body=Buffer.from('');}contentType=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';}
 await cmd('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:contentType}],body:body.toString('base64')});
}
const {targetInfos}=await cmd('Target.getTargets',{},null);const attached=await cmd('Target.attachToTarget',{targetId:targetInfos[0].targetId,flatten:true},null);session=attached.sessionId;
const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Fetch.enable',{patterns:[{urlPattern:'*'}]});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const out=path.join(root,'docs/screenshots/gira-12');await fs.mkdir(out,{recursive:true});
try{
 for(const width of [390,480]){
 await cmd('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
 for(const [name,url,selector] of [['issue','/browse/DEMO-1','.issue-view h1'],['board','/projects/DEMO/board','.card'],['document','/s/DEMO/p/1','.doc'],['search','/search?q=모바일','.search-result']]){
 await cmd('Page.navigate',{url:'http://127.0.0.1:5188'+url});
 let loaded=false;for(let i=0;i<60;i++){if(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)){loaded=true;break;}await delay(100);}assert(loaded,`${name} loaded`);await delay(300);
 const size=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert(size.scroll<=width,`${name} ${width}: overflow ${JSON.stringify(size)}`);
 assert.equal(await evaluate(`!!document.querySelector('#sidebar, .gs-side')`),false,`${name}: sidebar collapsed`);
 const editing=await evaluate(`Array.from(document.querySelectorAll('.cform, .comment-form, .comment-edit, .page-actions, .bcell-add, .field-picker button, .issue-view select, .createbtn, .gtb-create')).filter(e=>e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e=>e.className)`);assert.deepEqual(editing,[],`${name}: write controls`);
 if(name==='board')assert(await evaluate(`document.querySelector('.lane-cols').getBoundingClientRect().width <= innerWidth`));
 if(name==='issue'){await evaluate(`document.querySelector('.issue-view h1').click();document.querySelector('.issue-view .inline-edit')?.click()`);assert.equal(await evaluate(`!!document.querySelector('.issue-view input, .issue-view [contenteditable=true]')`),false);}
 const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await fs.writeFile(path.join(out,`${name}-${width}.png`),Buffer.from(shot.data,'base64'));
 console.log(`PASS ${name} ${width}px: ${size.scroll}px, read only`);
 // Drawer opens, keeps content width, closes with backdrop.
 await evaluate(`document.querySelector('.navtgl, .gtb-left .gs-iconbtn').click()`);await delay(100);assert(await evaluate(`!!document.querySelector('#sidebar, .gs-side')`));await evaluate(`document.querySelector('.mobile-shade').click()`);await delay(100);assert.equal(await evaluate(`!!document.querySelector('#sidebar, .gs-side')`),false);
 }
 }
 await cmd('Page.navigate',{url:'http://127.0.0.1:5188/s/DEMO/p/1/edit'});await delay(500);assert(await evaluate(`document.body.textContent.includes('이 화면은 데스크톱에서 이용하세요')`));assert.equal(await evaluate(`!!document.querySelector('[contenteditable=true]')`),false);
 assert.deepEqual(writes,[],'No write API requests');assert.deepEqual(errors,[],'No browser exceptions');console.log('PASS direct edit URL, navigation drawer, zero writes and zero browser exceptions');
}finally{clearTimeout(deadline); await cmd('Browser.close',{},null);}
