# 데이터 모델 (초안)

PostgreSQL 기준. 수집 결과(26,249 페이지, 251,171 버전, 첨부 139,103개, 폴더 600, 라이브 문서 1,152, 데이터베이스 48, 화이트보드 33)를 수용하도록 설계했다.

## 원칙
1. **원본 ID 보존**: 이관되는 콘텐츠는 Confluence의 숫자 ID를 그대로 PK로 쓴다. 새로 만드는 콘텐츠는 기존 최대값보다 큰 시퀀스에서 발급한다.
   → 기존 URL `/wiki/spaces/{key}/pages/{id}/...` 리다이렉트가 조인 없이 가능하다.
2. **본문은 ProseMirror JSON**: 에디터(TipTap)가 직접 저장하고 불러오는 형식. 변환기(`scripts/convert-storage.mjs`)가 storage XHTML을 이 형식으로 바꾼다. 원본 XHTML도 버전마다 보관해 재변환에 대비한다.
3. **모든 콘텐츠 유형은 하나의 트리**: 페이지, 라이브 문서, 폴더, 데이터베이스, 화이트보드, 임베드가 `content` 한 테이블에서 `parent_id`로 트리를 이룬다. 실제 데이터에서 폴더 아래 폴더(245), 데이터베이스 아래 폴더(3)도 있으므로 부모 유형을 제한하지 않는다.

## 테이블

### 사용자, 그룹
```sql
users (
  id            bigserial PK,
  email         text UNIQUE,            -- Entra ↔ Confluence 매핑 키
  entra_oid     uuid UNIQUE NULL,       -- Entra ID object id (첫 로그인 시 채움)
  confluence_account_id text UNIQUE NULL, -- 712020:uuid (이관 매핑)
  display_name  text,
  avatar_key    text NULL,              -- S3 키
  active        boolean DEFAULT true    -- 퇴사자 등 비활성 (이관 시 글쓴이 보존용)
)
groups ( id bigserial PK, entra_group_id uuid UNIQUE NULL, name text )
user_groups ( user_id FK, group_id FK, PRIMARY KEY(user_id, group_id) )  -- 로그인 시 Entra 토큰으로 동기화
```

### 스페이스, 콘텐츠 트리
```sql
spaces (
  id bigint PK,                         -- Confluence space id 보존
  key text UNIQUE, name text,
  type text CHECK (IN 'global','personal','collaboration','knowledge_base'),
  status text DEFAULT 'current',        -- current | archived
  homepage_id bigint NULL,              -- FK content
  icon_key text NULL, created_at timestamptz
)

content (
  id bigint PK,
  space_id bigint FK, parent_id bigint NULL FK content,
  type text CHECK (IN 'page','live','folder','whiteboard','database','embed'),
  title text, position int,             -- 형제 간 정렬
  status text DEFAULT 'current',        -- current | archived | trashed | draft
  author_id bigint FK users, owner_id bigint FK users,
  current_version int,                  -- page/live: 현재 게시 버전 번호
  created_at timestamptz, updated_at timestamptz
)
-- 트리 조회는 recursive CTE. 깊이 최대 11, 스페이스당 수천 건 수준이라 충분하다.
```

### 버전 (page, live 공용)
```sql
content_versions (
  content_id bigint FK, version int,    -- PK (content_id, version)
  doc jsonb,                            -- ProseMirror 문서
  source_xhtml text NULL,               -- 이관 원본 (재변환 대비, TOAST 압축에 맡김)
  source_editor text NULL,              -- v2 | legacy (레거시 편집기 버전 식별)
  message text, minor_edit boolean,
  author_id bigint FK users, created_at timestamptz
)
-- 251,171행 + 본문. storage 전체가 576MiB이므로 원본 포함해도 수 GiB 수준.
-- live 문서는 저장 시점마다 버전을 쌓지 않고, 주기 스냅숏 + 현재본으로 운영한다.
```

### 초안과 동시 편집
```sql
drafts (
  content_id bigint FK PK, doc jsonb,
  base_version int,                     -- 어느 게시 버전에서 분기했는지
  updated_by bigint, updated_at timestamptz
)
-- 동시 편집 도입 시 Yjs 업데이트 로그 테이블(yjs_updates)을 추가하고
-- drafts.doc 은 스냅숏 캐시로 유지한다.
```

### 첨부
```sql
attachments (
  id bigint PK,                         -- Confluence attachment id 보존
  content_id bigint FK, filename text,
  media_type text, file_size bigint,
  s3_key text,                          -- MinIO 오브젝트 키: att/{content_id}/{id}/{version}
  sha256 bytea NULL, version int DEFAULT 1,
  author_id bigint, created_at timestamptz,
  UNIQUE (content_id, filename, version)
)
-- 본문에서는 attachment id 또는 filename으로 참조(storage 형식과 동일한 유연성).
```

### 댓글, 레이블, 반응
```sql
comments (
  id bigint PK, content_id bigint FK,
  parent_id bigint NULL FK comments,    -- 답글
  kind text CHECK (IN 'footer','inline'),
  inline_ref text NULL,                 -- 본문 inline-comment-marker 의 ref 와 매칭
  resolved boolean DEFAULT false,
  doc jsonb, author_id bigint, created_at timestamptz
)
labels ( id bigserial PK, name text UNIQUE )          -- 고유 421개
content_labels ( content_id FK, label_id FK, PK(content_id, label_id) )
```

### 권한
Entra 그룹 중심으로 단순화한 3단계 역할 + 콘텐츠 제한.
```sql
space_permissions (
  space_id FK,
  principal_type text CHECK (IN 'user','group','anyone'),
  principal_id bigint NULL,
  role text CHECK (IN 'viewer','editor','admin'),
  PRIMARY KEY (space_id, principal_type, principal_id, role)
)
content_restrictions (                  -- 페이지 단위 제한(restrict_content 대응)
  content_id FK, principal_type text, principal_id bigint,
  op text CHECK (IN 'view','edit')
)
-- 이관 매핑: read:space→viewer, create/update/delete:*→editor, administer:space→admin.
-- 원본 39k건의 사용자 단위 권한은 그대로 매핑해 보존하고, 운영은 그룹 단위를 권장.
```

### 데이터베이스(표 형식 콘텐츠), 화이트보드
```sql
db_definitions (
  content_id bigint PK FK,
  fields jsonb,   -- [{id, name, type: text|tag|user|date|number|checkbox|link|page}, ...]
  views  jsonb    -- [{id, name, filter, sort, hiddenFields, kind: table|board}, ...]
)
db_rows (
  id bigserial PK, database_id bigint FK,
  data jsonb,                           -- {fieldId: value}
  position int, created_by bigint, created_at, updated_at
)
whiteboards (
  content_id bigint PK FK,
  scene jsonb,                          -- Excalidraw scene
  thumbnail_key text NULL
)
```

### 기타
```sql
watchers ( content_id FK, user_id FK, PK(content_id, user_id) )
events (                                -- 최근 활동, 알림 원천
  id bigserial PK, space_id, content_id, user_id,
  kind text,                            -- created | edited | commented | moved ...
  at timestamptz, meta jsonb
)
jira_cache ( issue_key text PK, payload jsonb, fetched_at timestamptz )
redirects ( old_path text PK, content_id bigint )   -- 특수 URL 보정용(대부분은 ID 규칙으로 해결)
```

## 검색
- OpenSearch 단일 인덱스: `{content_id, space_key, type, title, text(본문 평문화), labels, author, updated_at}`
- 한국어는 nori 형태소 분석기, 첨부는 후순위로 텍스트 추출(tika) 후 별도 필드.
- PostgreSQL 트리거 또는 아웃박스 테이블로 색인 동기화.

## 본문(ProseMirror) 커스텀 노드
표준: paragraph, heading, bullet/orderedList, taskList/taskItem, table, codeBlock, blockquote, image(media), hardBreak, horizontalRule.
커스텀: `panel(type)`, `expand(title)`, `status(text,color)`, `mention(userId)`, `emoji`, `date`, `layout/layoutColumn`, `pageLink(contentId)`, `fileCard(attachmentId)`, `jiraIssue(key)`, `jiraTable(jql)`, `toc`, `anchor(name)`, `excerpt(name)`, `cfMacro(name, params, body)` — cfMacro는 동적 매크로(include, children, pagetree 등)와 미지원 매크로의 공통 컨테이너다. 렌더러만 단계적으로 붙이면 된다.
