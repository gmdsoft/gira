# HTML 블록 격리 (GIRA-49)

HTML Macro Pro, html, iframe은 `htmlEmbed` 원자 블록으로 보관한다. HTML은 JSON 속성에 원문 그대로 보관하며, 대형 본문의 첨부 분리는 이번 변경에 포함하지 않는다. 높이는 원본의 양수 px 값, 없거나 잘못된 값이면 400px다. 폭은 100%이며 자동 높이 보고는 사용하지 않는다. 편집 화면은 미리보기와 읽기 전용 원문을 제공한다.

## HTML 본문

`srcdoc`에만 HTML을 넣고 부모 DOM에는 삽입하지 않는다. sandbox는 `allow-scripts allow-popups allow-popups-to-escape-sandbox`다. `allow-same-origin`을 주지 않아 출처가 opaque이며, 부모 DOM·쿠키·localStorage 접근은 브라우저 동일 출처 정책으로 거부된다. 부모는 블록의 postMessage를 처리하지 않는다.

본문 앞에 CSP meta를 삽입한다(doctype은 유지). `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`으로 fetch/XHR/WebSocket·폼 전송·base 변경을 막는다. HTTPS 외부 스크립트(인라인/eval 포함), 스타일, 글꼴, 이미지, 미디어와 일부 data 리소스는 허용한다. jsdelivr·Google Fonts·Tailwind와 인라인 차트 코드를 사용할 수 있다. 외부 JSON을 fetch하는 차트는 연결 차단 때문에 동작하지 않을 수 있다.

자식 CSP의 `frame-src`는 `https: http:`다. 기존 Figma 등 중첩 iframe을 지원하며 sandbox 제한은 자손에도 전파된다. HTML 안의 중첩 iframe에는 내부망 URL도 포함될 수 있다. 따라서 이 기능은 내부망으로의 모든 네트워크 요청을 차단하는 방화벽은 아니다. 팝업은 원본 호환을 위해 sandbox 밖에서 열릴 수 있다. 블록의 코드가 팝업에서 Gonfluence 문서나 API 응답을 읽는 권한을 얻는 것은 아니다.

## URL 매크로

절대 http/https URL만 받는다. 상대 URL, 자격 증명, IP 리터럴(공개 IP 포함), 단일 호스트명, local/internal/lan/localhost/test/invalid 도메인은 거부한다. 브라우저에서는 Gonfluence와 같은 호스트도 포트에 관계없이 거부한다. URL을 변환할 때와 렌더할 때 모두 검사한다. 공개 DNS 이름이 내부 IP로 해석되거나 외부 URL이 리다이렉트되는 경우까지 탐지하지는 않는다.

브라우저 NodeView의 외부 URL은 `allow-scripts allow-same-origin allow-popups allow-forms allow-presentation` sandbox로 표시한다. same-origin 권한은 해당 외부 사이트의 출처에 적용된다. 서버/문자열 HTML 직렬화는 서비스 출처를 확정할 수 없어 더 엄격한 opaque sandbox를 유지한다. `loading=lazy`, `referrerpolicy=no-referrer`를 사용한다. 사이트 자체의 X-Frame-Options/frame-ancestors 정책으로 임베드가 거부될 수 있다.

부모 서비스의 전역 CSP 헤더는 이번 변경에서 추가하지 않는다. 배포에서 부모 `frame-src`를 제한한다면 srcdoc의 `about:`과 필요한 외부 http/https 출처를 허용해야 한다. 자식의 CSP는 부모의 정책을 완화하지 않는다.

## 검증과 반영

`web/test/html-embed.test.mjs`에서 세 변환 형식, UTF-8/base64 오류, 문단 내부 블록 승격, 두 편집기 스키마, HTML 직렬화, 위험 URL 거부, sandbox/CSP 속성을 검사한다. 이 검사는 실제 브라우저의 보안 동작을 실행하는 검사가 아니다.

샌드박스에서 DB·서버를 사용하지 않는다. 머지 후 담당자가 `node scripts/reconvert.mjs`로 전 버전을 재변환하고 `npm --workspace web run check`를 실행해야 한다. PS 1580957722, QATeam 30203131, DEV4 354091337의 원본 화면 비교와 임시 문서의 차트 실행, parent.document/document.cookie/localStorage 접근 거부, fetch API 연결 차단은 브라우저에서 확인하고 임시 문서를 삭제한다. 원본 Cloud나 실제 이관 문서를 테스트로 수정하지 않는다.
