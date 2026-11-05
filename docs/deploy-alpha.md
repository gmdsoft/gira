# 알파 배포 가이드 (Docker)

Gonfluence(3001)와 Gira(3002)를 한 호스트에서 docker compose 로 띄운다.
두 앱은 같은 이미지(루트 `Dockerfile`)를 쓰고 `command` 로 서버를 고른다.
DB는 PostgreSQL 인스턴스 하나에 **데이터베이스 2개**(rea = Gonfluence, gira = Gira)로 분리한다.

## 구성

| 서비스 | 포트 | 데이터 |
| --- | --- | --- |
| postgres | (내부) | 볼륨 `pgdata`, 최초 기동 시 `deploy/initdb/`가 gira DB 생성 |
| gonfluence | 3001 | `DATABASE_URL` → rea DB, 첨부/캐시 볼륨 `gonfluence-data`(/data) |
| gira | 3002 | `GIRA_DATABASE_URL` → gira DB, 첨부 볼륨 `gira-data`(/data) |
| search (OpenSearch) | (내부) | 볼륨 `osdata` — Gonfluence 검색용 |

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

2. 기동:

   ```
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   앱이 기동하면서 스키마(schema-core + 앱별 schema)를 스스로 적용한다.

3. 데이터 반입: 개발 DB에서 옮기려면 `pg_dump`를 postgres 컨테이너로 복원한다.
   (rea DB → rea, gira DB → gira. 첨부 파일은 server/data 를 각 앱 볼륨 /data 로 복사.)

## 업데이트 배포

```
git pull
docker compose -f docker-compose.prod.yml up -d --build gonfluence gira
```

## 백업

- DB: `docker compose -f docker-compose.prod.yml exec postgres sh -c 'pg_dump -U rea rea' > rea.sql` (gira 동일)
- 첨부: `gonfluence-data`, `gira-data` 볼륨 스냅샷

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
