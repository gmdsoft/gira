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
| POST | /api/v1/issues/{KEY}/attachments | 첨부 업로드 (multipart) |
| GET | /api/v1/sprints?project=KEY | 스프린트 목록 |
| GET | /api/v1/projects/{KEY}/export | 프로젝트 패키지(.zip) 내보내기 (프로젝트 관리자) |
| POST | /api/v1/projects/import | 패키지 가져오기 (multipart, 생성 권한자) |

## Gonfluence (3001)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | /api/v1/spaces | 접근 가능한 스페이스 목록 |
| GET | /api/v1/spaces/{KEY} | 스페이스 + 페이지 트리 |
| GET | /api/v1/pages?q=&space= | 페이지 검색 |
| GET | /api/v1/pages/{id} | 페이지 상세 (본문 doc 포함) |
| POST | /api/v1/pages | 새 페이지 {spaceKey, parentId?, title?} |
| POST | /api/v1/pages/{id}/publish | 본문 게시 {doc, title?, baseVersion?} |
| POST | /api/v1/pages/{id}/comments | 댓글 작성 |
| GET | /api/v1/spaces/{KEY}/export | 스페이스 패키지(.zip) 내보내기 (스페이스 관리자) |
| POST | /api/v1/spaces/import | 패키지 가져오기 (multipart, 생성 권한자) |

응답·오류 형식은 현재 내부 API와 동일({error} + HTTP 상태코드). 권한은 화면과 같은
규칙(프로젝트/스페이스 역할, 기본 비공개)을 따른다.
