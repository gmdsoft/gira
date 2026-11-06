# 알파 배포 가이드 (Docker)

Gira와 Gonfluence는 **각각 독립 스택으로 배포**한다. 스택마다 자기 PostgreSQL을 가지며,
서로 없어도 동작한다 (앱 간 연결은 URL 링크뿐). 같은 호스트에 둘 다 올려도 되고,
다른 호스트에 하나씩 올려도 된다. 두 앱 모두 `docker/Dockerfile` 한 장으로 빌드된 같은 이미지를 쓴다.

| 스택 | compose 파일 | 포트 | 구성 |
| --- | --- | --- | --- |
| Gonfluence | docker/docker-compose.gonfluence.yml | 3001 (`GONFLUENCE_PORT`), 관리 3003 (`ADMIN_PORT`) | app + postgres(rea DB) + opensearch + admin |
| Gira | docker/docker-compose.gira.yml | 3002 (`GIRA_PORT`), 관리 3013 (`GIRA_ADMIN_PORT`) | app + postgres(gira DB) + admin |

**관리 서비스(admin)** 는 조직(사용자·팀·파트·그룹·직책·생성 권한·API 키)의 유일한 관리 지점이다.
자체 DB 없이 스택의 조직 테이블(schema-core)을 관리하며, 앱 서버에는 조직을 바꾸는 API가 없다.

한 호스트에 **두 스택을 함께** 올릴 때는 관리 서비스를 하나만 켠다:

```
# Gonfluence 스택의 admin 이 양쪽 조직 테이블을 관리하도록
echo 'ORG_MIRROR_DATABASE_URL=postgres://rea:<PW>@gira-postgres-1주소:5432/gira' >> .env
docker compose -f docker/docker-compose.gonfluence.yml --env-file .env up -d --build
docker compose -f docker/docker-compose.gira.yml --env-file .env up -d --build --scale admin=0
```

(개발 환경은 로컬 postgres 하나라 `.env` 의 `ORG_MIRROR_DATABASE_URL=...:5432/gira` 로 충분)

개인 프로필 이미지 업로드(GIRA-20)는 앱 서버가 관리 서비스로 프록시하므로, 두 스택의 앱·관리 서비스에
**같은 `COOKIE_SECRET`** 을 지정한다(세션 쿠키 공유). 관리 서비스를 한쪽만 켠 경우 앱의 `ORG_ADMIN_URL` 을
그 관리 서비스 주소(예: `http://gonfluence-host:3003`)로 맞춘다. 관리 서비스는 조직 테이블만 쓰고,
이미지 바이트는 `ORG_MIRROR_DATABASE_URL` 로 각 앱 DB에 복제된다.

## 처음 띄우기

1. `.env` 작성 (저장소 루트, gitignore 됨):

   ```
   POSTGRES_PASSWORD=<강한 값>
   ADMIN_EMAIL=pottery@gmdsoft.com
   # 이관 전 원본 첨부 프록시가 필요할 때만:
   ATLASSIAN_SITE=https://gmdsoft.atlassian.net
   ATLASSIAN_EMAIL=...
   ATLASSIAN_API_TOKEN=...
   ```

2. 필요한 스택만 기동 (스키마는 앱이 기동하면서 스스로 적용):

   ```
   docker compose -f docker/docker-compose.gonfluence.yml --env-file .env up -d --build
   docker compose -f docker/docker-compose.gira.yml --env-file .env up -d --build
   ```

3. 데이터 반입: 개발 DB의 `pg_dump` 를 각 스택의 postgres 로 복원한다
   (rea → Gonfluence 스택, gira → Gira 스택). 첨부 파일은 server/data 를 각 스택의
   `appdata` 볼륨(/data)으로 복사.

## 업데이트 배포

```
git pull
docker compose -f docker/docker-compose.gonfluence.yml --env-file .env up -d --build app   # Gonfluence만
docker compose -f docker/docker-compose.gira.yml --env-file .env up -d --build app         # Gira만
```

스택이 분리되어 있으므로 한쪽을 재배포해도 다른 쪽은 영향이 없다.

## 백업 (스택별)

- DB: `docker compose -f docker/docker-compose.gira.yml --env-file .env exec postgres sh -c 'pg_dump -U rea gira' > gira.sql`
  (Gonfluence는 rea DB 동일 요령)
- 첨부: 각 스택의 `appdata` 볼륨 스냅샷

## 개발 환경에서의 DB 분리

기존 단일 DB(rea)를 쓰던 개발 환경은 한 번만 분리 스크립트를 실행한다:

```
scripts/split-gira-db.sh          # rea → gira 로 공용+jira_* 테이블 복사 (원본 유지)
echo 'GIRA_DATABASE_URL=postgres://rea:rea@localhost:5432/gira' >> .env
# 3002 서버 재시작
```

`GIRA_DATABASE_URL` 이 없으면 Gira는 종전처럼 `DATABASE_URL` 로 동작한다(단일 DB 호환).
분리 후 rea DB에 남은 jira_* 테이블은 검증 기간이 지나면 수동으로 DROP 한다.

## 헬스체크

두 서버 모두 `GET /healthz` (로그인 불필요, DB SELECT 1 포함). compose 헬스체크가 이를 사용한다.

## 사용자 동기화 (알파 기간)

users 테이블이 스택마다 따로 있다. 알파 기간엔 이관 시점에 복제해 두고,
Entra OIDC 도입 시 로그인 클레임으로 양쪽을 각자 갱신하는 방식으로 전환한다.

### 내부 링크 카드

Gonfluence 편집기에 같은 호스트의 문서 주소 또는 Gira `:3002/browse/KEY-123` 주소를 붙여넣으면 링크/카드를 선택할 수 있다. 카드의 제목·상태는 볼 때마다 새로 가져온다(문서에 저장된 값은 조회 실패 시 대체 표시).
Gonfluence 서버는 Gira 조회 시 사용자의 쿠키/Authorization을 전달하며 Gira의 프로젝트 보기 권한 검사를 그대로 적용한다.
이슈 조회는 이슈 카드와 같은 `/api/gira/issues/:key`를 쓴다. Gira 서버 주소는 `GIRA_URL`(기본 `http://localhost:3002`), 사용자가 이동할 Gira 주소는 `GIRA_PUBLIC_URL`(기본: 접속한 호스트의 3002 포트)로 정한다. 쿠키 인증을 공유하려면 두 앱의 `COOKIE_SECRET`과 사용자 ID가 같아야 한다. 접속 또는 인증에 실패하면 카드 대신 링크로 삽입할 수 있다.
외부 사이트 URL은 카드 메타데이터 조회 대상이 아니다.
