-- Gira(Jira PoC) 스키마. schema-core.sql(users 등) 적용 후에 실행한다.
-- 사용자: Jira도 같은 Atlassian accountId 체계이므로 users.confluence_account_id 를 공유한다.
-- 빈 DB에서도 위에서 아래로 그대로 실행되도록 CREATE → ALTER 순서를 지킨다.

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

-- 로컬 업로드 첨부: source_url 대신 DATA_DIR 아래 파일 키
ALTER TABLE jira_attachments ADD COLUMN IF NOT EXISTS local_key text;

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

-- 스프린트 표시 순서 (원본 보드의 백로그 정렬 — jira-import-boards.mjs가 채움)
ALTER TABLE jira_sprints ADD COLUMN IF NOT EXISTS position int;

-- 사용자 정의 보드: 컬럼마다 포함할 상태를 지정한다 (columns: [{name, statusIds[]}])
CREATE TABLE IF NOT EXISTS jira_boards (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  name text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'
);

-- 보드 고도화: 원본 이관(source_id)·유형(scrum/kanban)·보드 필터(JQL)
ALTER TABLE jira_boards ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE jira_boards ADD COLUMN IF NOT EXISTS jql text;
ALTER TABLE jira_boards ADD COLUMN IF NOT EXISTS source_id bigint UNIQUE;

-- 변경 이력(기록): 이관분은 jira_id에 원본 history id, 로컬 수정은 NULL
CREATE TABLE IF NOT EXISTS jira_changelog (
  id bigserial PRIMARY KEY,
  jira_id bigint UNIQUE,
  issue_id bigint NOT NULL REFERENCES jira_issues(id) ON DELETE CASCADE,
  author_id bigint REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  items jsonb NOT NULL  -- [{field, fromString, toString}]
);
CREATE INDEX IF NOT EXISTS jira_changelog_issue ON jira_changelog(issue_id, created_at);

-- 프로젝트 접근 권한 (space_permissions와 동일 의미, 규칙이 없으면 비공개 — 사이트 관리자만)
CREATE TABLE IF NOT EXISTS jira_project_permissions (
  project_id bigint NOT NULL REFERENCES jira_projects(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group','team','anyone')),
  principal_id bigint NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('viewer','editor','admin')),
  PRIMARY KEY (project_id, principal_type, principal_id, role)
);

-- 개발참여 챗봇 대화: 메시지 content는 API 응답 블록을 그대로 저장(append-only — thinking 블록 보존)
CREATE TABLE IF NOT EXISTS dev_chat_sessions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  author text,                   -- 실제 작성자 표시 이름 (Gonfluence 프록시 경유 시)
  source text,                   -- 'Gira' | 'Gonfluence'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dev_chat_messages (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES dev_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dev_chat_messages_session ON dev_chat_messages(session_id, id);

-- 저장된 필터 (사용자별)
CREATE TABLE IF NOT EXISTS jira_filters (
  id bigserial PRIMARY KEY,
  owner_id bigint NOT NULL REFERENCES users(id),
  name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'
);
