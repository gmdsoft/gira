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
