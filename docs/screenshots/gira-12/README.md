# GIRA-12 모바일 화면 검증

현재 상태: **스크린샷 미검증**. 작업 환경의 Chromium은 `libasound.so.2` 누락으로 실행되지 않았다.
두 앱 빌드, 변경한 JS 파일 문법 검사, 상태·상위 항목 컴포넌트의 모바일/데스크톱 렌더링 검사는 통과했다.

브라우저 실행 환경에서 저장소 루트에서 다음을 실행한다.

```sh
npm --workspace web run build
npm --workspace web run build:jira
CHROMIUM_BIN=/path/to/chromium node web/scripts/mobile-check.mjs
```

검증 스크립트는 Chromium CDP 파이프로 빌드 결과와 가상 API 응답을 주입한다.
로컬 서버 포트를 열거나 실제 DB/API에 접속하지 않는다. 원본 데이터나 로그인 정보는 필요 없다.

- 390×844, 480×844에서 이슈 직접 링크, 세로 카드 보드, 문서 직접 링크, 검색 결과를 확인한다.
- 가로 넘침, 초기 사이드바 접힘, 메뉴 열기·닫기, 편집 컨트롤 노출 여부를 검사한다.
- 이슈 제목·설명 클릭과 문서 편집 URL 직접 접근이 편집으로 이어지지 않는지 확인한다.
- 쓰기 API 요청과 브라우저 예외가 없는지 확인한다.
- 성공 시 이 폴더에 `issue`, `board`, `document`, `search`의 폭별 PNG 8개를 저장한다.

남은 완료 조건: 위 검증을 통과한 뒤 PNG를 직접 확인하고 첨부한다.
