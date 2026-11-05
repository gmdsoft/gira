-- 공용 스키마: 두 앱(Gonfluence, Gira)의 DB에 모두 존재하는 테이블.
-- 인증(auth.mjs)·권한 컨텍스트(perm.getAccess)가 사용한다.
-- DB 분리 후 사용자 정보의 원본은 Gonfluence DB로 하고, Gira DB에는 복제한다
-- (Entra 연동 시 양쪽 모두 OIDC 클레임으로 갱신).

CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  email text UNIQUE,
  entra_oid uuid UNIQUE,
  confluence_account_id text UNIQUE,
  display_name text,
  avatar_key text,
  active boolean NOT NULL DEFAULT true,
  is_admin boolean NOT NULL DEFAULT false
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS groups (
  id bigserial PRIMARY KEY,
  entra_group_id uuid UNIQUE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id bigint NOT NULL REFERENCES users(id),
  group_id bigint NOT NULL REFERENCES groups(id),
  PRIMARY KEY (user_id, group_id)
);

-- 팀·파트 (2단 조직: parent_id가 NULL이면 팀, 있으면 그 팀의 파트)
CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  parent_id bigint REFERENCES teams(id),
  position int
);
-- 개발용 로그인 허용(Entra 전): 팀/파트 단위 허용 — 소속원(팀 허용 시 하위 파트 포함)이 로그인 가능
ALTER TABLE teams ADD COLUMN IF NOT EXISTS dev_login boolean NOT NULL DEFAULT false;

-- 사용자 조직 속성: 주 소속(team_id: 파트 또는 팀 직속), 직책(duty: 권한 판정), 직급(rank: 표시용)
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS duty text NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank text;
-- 개발용 로그인 허용 (Entra 전): 관리자가 지정한 계정만 이름 입력으로 로그인할 수 있다
ALTER TABLE users ADD COLUMN IF NOT EXISTS dev_login boolean NOT NULL DEFAULT false;

-- 생성 권한 그룹 (예: 'PM들'): 멤버는 프로젝트/스페이스를 만들 수 있다
ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_create boolean NOT NULL DEFAULT false;
-- 개발용 로그인 허용(Entra 전): 그룹 단위 허용 — 멤버가 로그인 가능
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dev_login boolean NOT NULL DEFAULT false;

-- 접근 권한 요청 (space = Gonfluence, project = Gira — 각 앱 DB에서 자기 리소스만 사용)
CREATE TABLE IF NOT EXISTS access_requests (
  id bigserial PRIMARY KEY,
  resource_type text NOT NULL CHECK (resource_type IN ('space','project')),
  resource_id bigint NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id),
  want text NOT NULL DEFAULT 'viewer' CHECK (want IN ('viewer','editor')),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by bigint REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_requests_resource ON access_requests(resource_type, resource_id, status);
CREATE INDEX IF NOT EXISTS access_requests_user ON access_requests(user_id, created_at);

-- 원본 동기화(병행 운영기): 이관된 프로젝트/스페이스별 마지막 동기화 상태
-- last_synced_at = 마지막 성공 실행의 시작 시각 → 다음 실행의 증분 기준(--since)
CREATE TABLE IF NOT EXISTS source_sync_state (
  kind text NOT NULL,             -- 'jira-project' | 'conf-space'
  key text NOT NULL,              -- 프로젝트/스페이스 키
  last_synced_at timestamptz,
  last_run_at timestamptz,
  last_status text,               -- 'ok' | 'error'
  last_log text,
  PRIMARY KEY (kind, key)
);

-- 셀프 이관: 본인 Atlassian API 토큰(AES-GCM 암호화 저장)과 이관 작업 이력
CREATE TABLE IF NOT EXISTS atlassian_tokens (
  user_id bigint PRIMARY KEY REFERENCES users(id),
  email text NOT NULL,
  token_enc bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  kind text NOT NULL,            -- 'jira-project' | 'conf-space'
  target text NOT NULL,          -- 프로젝트/스페이스 키
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  log text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS import_jobs_user ON import_jobs(user_id, created_at);

-- API 키: Authorization: Bearer 로 쿠키 세션 대신 인증 (키는 해시로만 저장, 발급 시 1회 표시)
CREATE TABLE IF NOT EXISTS api_keys (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  name text NOT NULL,
  prefix text NOT NULL,            -- 식별용 앞 8자 (목록 표시)
  token_hash bytea UNIQUE NOT NULL, -- sha256(토큰)
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
