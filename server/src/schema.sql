-- 스키마: docs/data-model.md 기준. PGlite(로컬 개발)와 PostgreSQL 16(운영 compose)에서 동일하게 동작한다.

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
  principal_type text NOT NULL CHECK (principal_type IN ('user','group','anyone')),
  principal_id bigint NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('viewer','editor','admin')),
  PRIMARY KEY (space_id, principal_type, principal_id, role)
);

-- 페이지 접근 제한 (Confluence 제한과 동일 의미: view 제한은 하위 페이지에 상속, edit 제한은 해당 페이지만)
CREATE TABLE IF NOT EXISTS content_restrictions (
  content_id bigint NOT NULL REFERENCES content(id),
  rtype text NOT NULL CHECK (rtype IN ('view','edit')),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group')),
  principal_id bigint NOT NULL,
  PRIMARY KEY (content_id, rtype, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS content_restrictions_content ON content_restrictions(content_id);

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

-- 새로 만드는 콘텐츠의 ID 발급. 이관된 Confluence ID보다 큰 값에서 시작하도록 서버 기동 시 보정한다.
CREATE SEQUENCE IF NOT EXISTS content_id_seq;
CREATE SEQUENCE IF NOT EXISTS attachment_id_seq;
CREATE SEQUENCE IF NOT EXISTS comment_id_seq;

CREATE TABLE IF NOT EXISTS redirects (
  old_path text PRIMARY KEY,
  content_id bigint,
  target_url text
);

-- ===== Jira PoC (프로젝트 단위 이관, 읽기 전용 수집) =====
-- 사용자: Jira도 같은 Atlassian accountId 체계이므로 users.confluence_account_id 를 공유한다.

CREATE TABLE IF NOT EXISTS jira_projects (
  id bigint PRIMARY KEY,
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  project_type text,
  style text,
  lead_id bigint REFERENCES users(id),
  raw jsonb
);

CREATE TABLE IF NOT EXISTS jira_statuses (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('new','indeterminate','done'))
);

CREATE TABLE IF NOT EXISTS jira_issue_types (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  subtask boolean NOT NULL DEFAULT false,
  description text
);

-- 필드 사전: UI에서 customfield_* 를 사람이 읽을 이름으로 표시하기 위한 매핑
CREATE TABLE IF NOT EXISTS jira_fields (
  id text PRIMARY KEY,           -- 'summary', 'customfield_10073' 등
  name text NOT NULL,
  custom boolean NOT NULL DEFAULT false,
  schema_type text               -- string/number/option/user/array 등
);

CREATE TABLE IF NOT EXISTS jira_versions (
  id bigint PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  name text NOT NULL,
  released boolean NOT NULL DEFAULT false,
  release_date date
);

CREATE TABLE IF NOT EXISTS jira_issues (
  id bigint PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  issue_key text UNIQUE NOT NULL,
  issue_type_id bigint REFERENCES jira_issue_types(id),
  status_id bigint REFERENCES jira_statuses(id),
  summary text NOT NULL,
  description_adf jsonb,         -- Atlassian Document Format 원본 (뷰어에서 변환 렌더)
  priority text,
  resolution text,
  assignee_id bigint REFERENCES users(id),
  reporter_id bigint REFERENCES users(id),
  parent_id bigint,              -- 에픽/하위작업 부모 (이슈 적재 후 2차 업데이트, 같은 테이블)
  labels text[] NOT NULL DEFAULT '{}',
  fix_versions text[] NOT NULL DEFAULT '{}',
  components text[] NOT NULL DEFAULT '{}',
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  fields_raw jsonb               -- 커스텀 필드 포함 fields 전체 (명세 확정 전 보존용)
);
CREATE INDEX IF NOT EXISTS jira_issues_project ON jira_issues(project_id);
CREATE INDEX IF NOT EXISTS jira_issues_parent ON jira_issues(parent_id);

CREATE TABLE IF NOT EXISTS jira_comments (
  id bigint PRIMARY KEY,
  issue_id bigint NOT NULL REFERENCES jira_issues(id),
  body_adf jsonb,
  author_id bigint REFERENCES users(id),
  created_at timestamptz,
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS jira_comments_issue ON jira_comments(issue_id);

CREATE TABLE IF NOT EXISTS jira_attachments (
  id bigint PRIMARY KEY,
  issue_id bigint NOT NULL REFERENCES jira_issues(id),
  filename text NOT NULL,
  media_type text,
  file_size bigint,
  source_url text,               -- 원본 다운로드 경로 (PoC 프록시용)
  author_id bigint REFERENCES users(id),
  created_at timestamptz
);
CREATE INDEX IF NOT EXISTS jira_attachments_issue ON jira_attachments(issue_id);

CREATE TABLE IF NOT EXISTS jira_issue_links (
  id bigint PRIMARY KEY,
  link_type text NOT NULL,       -- 예: 'Blocks'
  inward_issue bigint NOT NULL,  -- 링크 양끝이 이관 범위 밖일 수 있어 FK 없이 이슈 id만 저장
  outward_issue bigint NOT NULL
);

-- Jira PoC 쓰기 기능: 신규 이슈/댓글/첨부는 로컬 DB에만 생성 (원본 Jira Cloud는 읽기 전용 유지)
CREATE SEQUENCE IF NOT EXISTS jira_issue_id_seq;
CREATE SEQUENCE IF NOT EXISTS jira_comment_id_seq;
CREATE SEQUENCE IF NOT EXISTS jira_attachment_id_seq;

-- 스프린트: 이관 데이터에는 없고(클래식 프로젝트, 보드 미사용) 로컬에서만 만든다
CREATE TABLE IF NOT EXISTS jira_sprints (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  name text NOT NULL,
  goal text,
  state text NOT NULL DEFAULT 'future' CHECK (state IN ('future','active','closed')),
  start_at timestamptz,
  end_at timestamptz
);
ALTER TABLE jira_issues ADD COLUMN IF NOT EXISTS sprint_id bigint REFERENCES jira_sprints(id);

-- 로컬 업로드 첨부: source_url 대신 DATA_DIR 아래 파일 키
ALTER TABLE jira_attachments ADD COLUMN IF NOT EXISTS local_key text;

-- 사용자 정의 보드: 컬럼마다 포함할 상태를 지정한다 (columns: [{name, statusIds[]}])
CREATE TABLE IF NOT EXISTS jira_boards (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  name text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'
);

-- 저장된 필터 (사용자별)
CREATE TABLE IF NOT EXISTS jira_filters (
  id bigserial PRIMARY KEY,
  owner_id bigint NOT NULL REFERENCES users(id),
  name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'
);
