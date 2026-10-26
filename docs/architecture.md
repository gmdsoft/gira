# 아키텍처 (초안)

## 배포 환경: 사내 TrueNAS
- **TrueNAS SCALE 24.10(Electric Eel) 이상**: Docker 기반 앱을 지원한다. "Custom App"(docker compose YAML)으로 서비스를 구동한다.
- **TrueNAS CORE(FreeBSD)**: Docker를 직접 지원하지 않는다. Linux VM을 따로 만들어 그 안에서 구동해야 한다.
- 데이터(PostgreSQL, 검색 인덱스)는 ZFS 데이터셋에 마운트한다. ZFS 스냅샷과 복제로 백업한다.

## 구성 (docker compose)
| 컨테이너 | 역할 |
|---|---|
| `web` | React SPA (정적 파일, Nginx/Caddy가 서빙) |
| `api` | Node.js API 서버: 인증(Entra ID OIDC), 페이지, 버전, 검색, 권한, Jira 프록시 |
| `postgres` | 스페이스, 페이지, 버전, 댓글, 권한, 레이블 메타데이터 및 본문 |
| `search` | 전문 검색. 한국어 형태소 분석 지원 엔진 후보: OpenSearch + nori, 또는 Meilisearch |
| `proxy` | HTTPS 종단(사내 인증서), `/wiki/spaces/...` 기존 URL 리다이렉트 |
| (기존) MinIO | 첨부파일 저장 (S3 API). 버킷 하나를 서비스 전용으로 할당 |

## 첨부 저장소: MinIO 사용, Nextcloud는 쓰지 않음
- MinIO는 S3 API로 애플리케이션이 직접 다루는 오브젝트 스토리지다. presigned URL로 브라우저가 바로 업로드·다운로드할 수 있어 API 서버 부하가 적다.
- Nextcloud는 사용자용 파일 공유 서비스다. 첨부 저장소로 쓰면 다음 문제가 있다.
  - WebDAV 경유라 느리다.
  - 파일이 특정 Nextcloud 계정 소유가 되어 권한 모델이 이중이 된다.
  - 문서 서비스 밖에서 파일이 수정·삭제될 위험이 있다.
- 저장소는 S3 인터페이스 뒤로 추상화해 둔다. MinIO 커뮤니티 에디션의 향후 배포 정책이 바뀌어도 다른 S3 호환 스토리지로 교체할 수 있게 한다.
- 용량: 첨부 최신 버전만 약 102 GiB다. 첨부 이력과 증가분을 고려해 MinIO 데이터셋에 최소 300 GiB 여유를 권장한다.

## 인증: Entra ID (OIDC)
- Entra ID 앱 등록: redirect URI `https://<사내 도메인>/auth/callback`. Entra ID는 localhost 외에는 HTTPS redirect URI만 허용하므로 **사내 TLS 인증서가 필요하다.**
- 그룹 기반 권한을 위해 ID 토큰에 `groups` 클레임을 포함하도록 설정하거나, Microsoft Graph로 그룹을 조회한다.
- Confluence 사용자(accountId) ↔ Entra 사용자는 이메일로 매핑한다.

## Jira 연동
- Jira Cloud는 유지한다. 서버가 Jira REST API를 프록시하고 캐시해 이슈 매크로(단일 이슈, JQL 표, 차트)를 렌더링한다.
- 서버용 연동 계정과 API 토큰이 필요하다(읽기 전용).

## Jira에 있는 기존 Confluence 링크 (2026-10-24 검증)
`gmdsoft.atlassian.net`은 Atlassian 소유 도메인이라 구독 해지 후 우리가 리다이렉트를 걸 수 없다. 따라서 **Jira 쪽 링크를 일괄 재작성**하고, 새 서비스가 **기존 URL 경로를 그대로 받도록** 만든다.

### 현황 (Jira API로 확인)
- 본문·댓글에 `gmdsoft.atlassian.net/wiki` 포함 이슈: **약 6,104개** (approximate-count)
- remote link("mentioned in"): `object.url`이 `/wiki/pages/viewpage.action?pageId={id}` 형식, `globalId`에 pageId 포함 → 숫자 ID 그대로
- 단축 링크 `/wiki/x/{token}`: **token = 페이지 ID의 4바이트 리틀엔디언 base64**(`/`→`-`, `+`→`_`, 끝의 `=`·`A` 제거). 실제 검증: `3QCnAQ` → 페이지 27721949 리다이렉트 확인 → **토큰만으로 페이지 ID를 복원할 수 있다**

### 새 서비스의 호환 라우트 (원본 ID를 PK로 보존하므로 전부 조인 없이 해결)
| 기존 경로 | 처리 |
|---|---|
| `/wiki/spaces/{key}/pages/{id}/{slug?}` | ID로 새 페이지 경로로 301 |
| `/wiki/pages/viewpage.action?pageId={id}` | 동일 |
| `/wiki/x/{token}` | 토큰 → ID 디코딩 후 301 |
| `/wiki/spaces/{key}/overview`, `/wiki/display/{key}/...` | 스페이스 홈으로 301 |
| 다른 인스턴스로 이전된 콘텐츠 | `redirects` 테이블 → 해당 인스턴스 URL로 301 |

### 재작성 도구 (마이그레이션 파이프라인에 포함, Confluence 해지 전 실행)
1. 전체 이슈 순회: description·comment의 ADF에서 `gmdsoft.atlassian.net/wiki` URL을 찾아 **호스트만 새 도메인으로 교체**(경로 보존, 단축 링크는 정식 경로로 풀어서 교체)
2. `PUT /rest/api/3/issue/{id}?notifyUsers=false`로 수정 → 알림 폭주 방지 (이슈 updated 시각은 변경됨)
3. remote link는 `PUT /issue/{key}/remotelink/{linkId}`로 url·title 교체
4. 사전 dry-run으로 교체 목록 리포트를 만들어 검토 후 실행

## 배포 패키징
- 산출물: 컨테이너 이미지(web, api, migrator) + `docker-compose.yml` + `.env.example`
- 외부 네트워크 없이 동작(이미지에 자산 포함, CDN 의존 금지) — 폐쇄망 인스턴스 요건
- 같은 compose 구성을 파라미터만 바꿔 여러 인스턴스로 배포한다 (메인, 보안 문서용 등)

## 다중 인스턴스: 보안 문서 분리
- 민감 스페이스는 별도 내부 서버의 독립 인스턴스(자체 Postgres, MinIO, 검색)로 운영한다. 인스턴스 간 데이터 공유나 연합 검색은 하지 않는다(분리 자체가 목적).
- **스페이스 내보내기/가져오기**: 스페이스 전체(콘텐츠 트리, 버전, 첨부, 댓글, 레이블, 권한)를 아카이브(JSONL + 첨부 파일)로 내보내고 다른 인스턴스에서 가져온다. Confluence 마이그레이션 파이프라인과 같은 형식을 쓴다 → 도구 하나로 "Confluence→인스턴스A"와 "인스턴스A→인스턴스B"를 모두 처리.
- 이전 후 원 인스턴스에는 `redirects` 행만 남겨 새 위치로 301 한다(접근 권한은 대상 인스턴스가 판단). 민감 문서의 존재 자체를 숨겨야 하면 redirect도 남기지 않는 옵션을 둔다.
- 인스턴스별 Entra 앱 등록(redirect URI가 다름) 또는 하나의 앱에 URI 다중 등록.
