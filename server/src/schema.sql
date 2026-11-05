-- Gonfluence(Confluence 대체) 스키마: docs/data-model.md 기준.
-- schema-core.sql(users/groups/api_keys) 적용 후에 실행한다.
-- Gira(Jira PoC) 스키마는 schema-jira.sql 로 분리 — 알파부터 별도 DB를 쓴다.

CREATE TABLE IF NOT EXISTS spaces (
  id bigint PRIMARY KEY,
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('global','personal','collaboration','knowledge_base')),
  status text NOT NULL DEFAULT 'current',
  homepage_id bigint,
  icon_key text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS content (
  id bigint PRIMARY KEY,
  space_id bigint NOT NULL REFERENCES spaces(id),
  parent_id bigint REFERENCES content(id),
  type text NOT NULL CHECK (type IN ('page','live','folder','whiteboard','database','embed')),
  title text NOT NULL,
  position int,
  status text NOT NULL DEFAULT 'current',
  author_id bigint REFERENCES users(id),
  owner_id bigint REFERENCES users(id),
  current_version int,
  -- Confluence 기본은 고정 폭(760px 컬럼, 넓은 표는 돌출 렌더링). 속성이 명시적으로 full-width일 때만 true
  full_width boolean NOT NULL DEFAULT false,
  created_at timestamptz,
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS content_space_parent ON content(space_id, parent_id);
ALTER TABLE content ADD COLUMN IF NOT EXISTS full_width boolean NOT NULL DEFAULT false;
ALTER TABLE content ALTER COLUMN full_width SET DEFAULT false;

CREATE TABLE IF NOT EXISTS content_versions (
  content_id bigint NOT NULL REFERENCES content(id),
  version int NOT NULL,
  doc jsonb,
  source_xhtml text,
  source_editor text,
  message text,
  minor_edit boolean DEFAULT false,
  author_id bigint REFERENCES users(id),
  created_at timestamptz,
  PRIMARY KEY (content_id, version)
);

CREATE TABLE IF NOT EXISTS drafts (
  content_id bigint PRIMARY KEY REFERENCES content(id),
  doc jsonb,
  title text, -- 초안 단계의 제목 변경 (게시 시 content.title에 반영)
  base_version int,
  updated_by bigint REFERENCES users(id),
  updated_at timestamptz
);
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS title text;

CREATE TABLE IF NOT EXISTS attachments (
  id bigint PRIMARY KEY,
  content_id bigint NOT NULL REFERENCES content(id),
  filename text NOT NULL,
  media_type text,
  file_size bigint,
  s3_key text,
  source_url text, -- 마이그레이션 전 원본 다운로드 경로 (PoC 프록시용, 이관 완료 후 제거)
  sha256 bytea,
  version int NOT NULL DEFAULT 1,
  author_id bigint REFERENCES users(id),
  created_at timestamptz,
  UNIQUE (content_id, filename, version)
);
CREATE INDEX IF NOT EXISTS attachments_content ON attachments(content_id);

CREATE TABLE IF NOT EXISTS comments (
  id bigint PRIMARY KEY,
  content_id bigint NOT NULL REFERENCES content(id),
  parent_id bigint REFERENCES comments(id),
  kind text NOT NULL CHECK (kind IN ('footer','inline')),
  inline_ref text,
  resolved boolean NOT NULL DEFAULT false,
  doc jsonb,
  author_id bigint REFERENCES users(id),
  created_at timestamptz
);
CREATE INDEX IF NOT EXISTS comments_content ON comments(content_id);

CREATE TABLE IF NOT EXISTS labels (
  id bigserial PRIMARY KEY,
  name text UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS content_labels (
  content_id bigint NOT NULL REFERENCES content(id),
  label_id bigint NOT NULL REFERENCES labels(id),
  PRIMARY KEY (content_id, label_id)
);

CREATE TABLE IF NOT EXISTS space_permissions (
  space_id bigint NOT NULL REFERENCES spaces(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group','team','anyone')),
  principal_id bigint NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('viewer','editor','admin')),
  PRIMARY KEY (space_id, principal_type, principal_id, role)
);
-- 기존 DB의 CHECK에 'team' 추가 (멱등: 매 기동마다 재생성)
ALTER TABLE space_permissions DROP CONSTRAINT IF EXISTS space_permissions_principal_type_check;
ALTER TABLE space_permissions ADD CONSTRAINT space_permissions_principal_type_check
  CHECK (principal_type IN ('user','group','team','anyone'));

-- 페이지 접근 제한 (Confluence 제한과 동일 의미: view 제한은 하위 페이지에 상속, edit 제한은 해당 페이지만)
CREATE TABLE IF NOT EXISTS content_restrictions (
  content_id bigint NOT NULL REFERENCES content(id),
  rtype text NOT NULL CHECK (rtype IN ('view','edit')),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group','team')),
  principal_id bigint NOT NULL,
  PRIMARY KEY (content_id, rtype, principal_type, principal_id)
);
ALTER TABLE content_restrictions DROP CONSTRAINT IF EXISTS content_restrictions_principal_type_check;
ALTER TABLE content_restrictions ADD CONSTRAINT content_restrictions_principal_type_check
  CHECK (principal_type IN ('user','group','team'));
CREATE INDEX IF NOT EXISTS content_restrictions_content ON content_restrictions(content_id);

-- 새로 만드는 콘텐츠의 ID 발급. 이관된 Confluence ID보다 큰 값에서 시작하도록 서버 기동 시 보정한다.
CREATE SEQUENCE IF NOT EXISTS content_id_seq;
CREATE SEQUENCE IF NOT EXISTS attachment_id_seq;
CREATE SEQUENCE IF NOT EXISTS comment_id_seq;

CREATE TABLE IF NOT EXISTS redirects (
  old_path text PRIMARY KEY,
  content_id bigint,
  target_url text
);
