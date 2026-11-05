# REST API v1 (알파)

외부 도구 연동용 안정 별칭. 내부 화면용 API와 같은 구현을 쓰지만, `/api/v1/*` 경로는
이후 버전에서도 형태를 유지한다.

## 인증

- 개인 API 키 발급: 각 앱 설정(톱니) 메뉴 → "내 API 키". 발급 시 1회만 평문 표시.
- 호출: `Authorization: Bearer gmd_...` 헤더. 키는 발급한 사용자의 권한으로 동작하며
  **발급한 앱 전용**이다 (Gira 키는 Gira에서만).

## Gira (3002)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | /api/v1/meta | 프로젝트(접근 가능한 것만)·상태·타입·담당자 목록 |
| GET | /api/v1/issues?project=KEY&limit=&offset=&sort= | 이슈 목록 (기본 필터 파라미터 동일) |
| GET | /api/v1/search?jql=... | JQL 검색 (issues와 동일 응답) |
| POST | /api/v1/issues | 이슈 생성 {projectKey, typeId, summary, description?, assigneeId?, ...} |
| GET | /api/v1/issues/{KEY} | 이슈 상세 (댓글·첨부·링크·하위·기록 포함) |
| PATCH | /api/v1/issues/{KEY} | 이슈 수정 {statusId?, summary?, assigneeId?, priority?, ...} |
| POST | /api/v1/issues/{KEY}/comments | 댓글 작성 {text} |
| PATCH | /api/v1/comments/{id} | 댓글 수정 {text} (작성자) |
| POST | /api/v1/issues/{KEY}/attachments | 첨부 업로드 (multipart) |
| GET | /api/v1/attachment/{id} | 첨부 내려받기 |
| GET | /api/v1/sprints?project=KEY | 스프린트 목록 |
| POST | /api/v1/projects | 프로젝트 만들기 {name, key, description?, rows?[{principalType, principalId, role}]} (생성 권한자, 만든 사람이 관리자) |
| GET | /api/v1/projects/{KEY}/export | 프로젝트 패키지(.zip) 내보내기 (프로젝트 관리자) |
| POST | /api/v1/projects/import | 패키지 가져오기 (multipart, 생성 권한자) |

## Gonfluence (3001)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | /api/v1/spaces | 접근 가능한 스페이스 목록 |
| GET | /api/v1/spaces/{KEY} | 스페이스 + 페이지 트리 |
| GET | /api/v1/pages?q=&space= | 페이지 검색 |
| GET | /api/v1/pages/{id} | 페이지 상세 (본문 doc 포함) |
| POST | /api/v1/pages | 새 페이지 {spaceKey, parentId?, title?, markdown? \| doc?} — 본문을 주면 버전 1로 게시까지 |
| POST | /api/v1/pages/{id}/publish | 본문 게시(새 버전) {markdown \| doc, title?, baseVersion?, message?} |
| GET | /api/v1/pages/{id}/versions | 버전 목록 |
| POST | /api/v1/pages/{id}/restore | 이전 버전으로 되돌리기 {version} |
| POST | /api/v1/pages/{id}/attachments | 첨부 업로드 (multipart) |
| GET | /api/v1/att/{id}/{filename} | 첨부 내려받기 |
| POST | /api/v1/pages/{id}/move | 이동 {parentId?, spaceKey?} |
| POST | /api/v1/pages/{id}/copy | 같은 위치에 사본 만들기 |
| POST | /api/v1/pages/{id}/status | 상태 변경 {status: current \| archived \| trashed} (하위 포함) |
| POST | /api/v1/pages/{id}/labels | 레이블 {add?:[], remove?:[]} |
| GET | /api/v1/pages/{id}/comments | 댓글 목록 |
| POST | /api/v1/pages/{id}/comments | 댓글 작성 {text} |
| POST | /api/v1/comments/{id}/resolve | 댓글 해결 {resolved?: true} |
| POST | /api/v1/spaces | 스페이스 만들기 {name, key} (생성 권한자) 또는 {type: "personal", name?} (개인 1개) |
| GET / PUT | /api/v1/spaces/{KEY}/permissions | 스페이스 권한 조회 / 전체 교체 {rows:[{principalType, principalId, role}]} (관리자) |
| GET | /api/v1/spaces/{KEY}/export | 스페이스 패키지(.zip) 내보내기 (스페이스 관리자) |
| POST | /api/v1/spaces/import | 패키지 가져오기 (multipart, 생성 권한자) |

응답·오류 형식은 현재 내부 API와 동일({error} + HTTP 상태코드). 권한은 화면과 같은
규칙(프로젝트/스페이스 역할, 기본 비공개)을 따른다.

## 본문 형식 (Gonfluence)

- `markdown`: CommonMark + GFM 표·취소선·작업 목록(`- [ ]`). 제목, 목록, 인용, 코드 블록(언어),
  구분선, 표, 굵게·기울임·인라인 코드·링크를 편집기 문서로 변환한다. 이미지는 링크로, HTML은 글자 그대로 들어간다.
- `doc`: 편집기 문서 JSON(`{type: "doc", content: [...]}`) — `GET /api/v1/pages/{id}`의 `doc`과 같은 형식.
  패널·확장 같은 Confluence 고유 요소까지 다루려면 이 형식을 쓴다.
- 둘 다 주면 `doc`이 우선. `baseVersion`을 주면 그사이 다른 사람이 게시했을 때 409로 막는다.

```bash
# 새 페이지를 Markdown 본문과 함께 만들기
curl -X POST http://<gonfluence>/api/v1/pages -H "Authorization: Bearer gmd_..." \
  -H "content-type: application/json" \
  -d '{"spaceKey":"DEV1","title":"배포 노트","markdown":"# 11월 배포\n- 보드 스윔레인\n- 챗봇 첨부"}'
```

