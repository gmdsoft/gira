# 알파 배포 가이드 (Docker)

Gira와 Gonfluence는 **각각 독립 스택으로 배포**한다. 스택마다 자기 PostgreSQL을 가지며,
서로 없어도 동작한다 (앱 간 연결은 URL 링크뿐). 같은 호스트에 둘 다 올려도 되고,
다른 호스트에 하나씩 올려도 된다. 두 앱 모두 루트 `Dockerfile` 한 장으로 빌드된 같은 이미지를 쓴다.

| 스택 | compose 파일 | 포트 | 구성 |
| --- | --- | --- | --- |
| Gonfluence | docker-compose.gonfluence.yml | 3001 (`GONFLUENCE_PORT`) | app + postgres(rea DB) + opensearch |
| Gira | docker-compose.gira.yml | 3002 (`GIRA_PORT`) | app + postgres(gira DB) |

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
   docker compose -f docker-compose.gonfluence.yml up -d --build
   docker compose -f docker-compose.gira.yml up -d --build
   ```

3. 데이터 반입: 개발 DB의 `pg_dump` 를 각 스택의 postgres 로 복원한다
   (rea → Gonfluence 스택, gira → Gira 스택). 첨부 파일은 server/data 를 각 스택의
   `appdata` 볼륨(/data)으로 복사.

## 업데이트 배포

```
git pull
docker compose -f docker-compose.gonfluence.yml up -d --build app   # Gonfluence만
docker compose -f docker-compose.gira.yml up -d --build app         # Gira만
```

스택이 분리되어 있으므로 한쪽을 재배포해도 다른 쪽은 영향이 없다.

## 백업 (스택별)

- DB: `docker compose -f docker-compose.gira.yml exec postgres sh -c 'pg_dump -U rea gira' > gira.sql`
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
