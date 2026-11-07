# 화이트보드 원본 호환 — 대응 현황과 남은 손실 (GIRA-58·74·78)

원본 Confluence 화이트보드(33개, 요소 2,764 — 2026-11-06 조사)를 Gonfluence로 옮길 때 무엇이 보존되고 무엇이 빠지는지 정리한다.
원본 데이터 받는 경로와 Yjs 구조는 개발 명세서 '원본 Confluence 호환성' 절, 변환기는 `scripts/lib/confluence-whiteboard.mjs`.

## 이관 경로 (원본에는 GET만)

| 대상 | 받는 곳 | 보관 |
| --- | --- | --- |
| 보드 (Yjs 스냅샷) | canvas collab 스냅샷 | `whiteboard_snapshots.source_ybin`(원본) + `data`(변환 결과) |
| 이미지 원본 | canvas 세션의 media 토큰으로 `api.media.atlassian.com/file/<media id>/binary?collection=contentId-<id>` (클라이언트 id = 토큰의 iss) | 첨부 `whiteboard-<media id>.<확장자>` (DATA_DIR/att-cache), 보기는 `/api/att/<id>/<파일>` |
| 댓글 | `/wiki/rest/api/content/<id>/child/comment` (인라인 댓글, `extensions.inlineProperties.markerRef` = 보드 댓글 요소의 `ci`) | `comments` (kind inline, `inline_ref` = ci) |

- 새로 이관할 때: `scripts/import-space.mjs`가 보드와 함께 이미지·댓글도 받는다(로컬 편집본이 있는 보드도 이미지·댓글은 받는다).
- 이미 이관한 보드: `node scripts/whiteboard-renormalize.mjs` = 변환기만 다시(원본 호출 없음),
  `--media [--ids …] [--dry]` = 이미지·댓글을 원본에서 받아 보관.

## 대응 현황

| 요소 | 상태 |
| --- | --- |
| 도형·텍스트·스티커·섹션·스탬프·자유 그리기·아이콘 | 원본과 같은 위치·크기·색 (GIRA-58, whiteboard-fidelity) |
| 커넥터 | 붙은 지점 재연결·경유점·꺾임 유지. 다시 그린 직각 꺾은선은 모서리를 둥글게(반지름 8) (GIRA-78) |
| 리치 텍스트 | 문단·제목·글머리/번호 목록(들여쓰기)·굵게·기울임·취소선·링크·줄바꿈·이모지 해석 (GIRA-78). 조사한 1,823개 값 모두 해석, 해석 못 하는 새 형식은 예전 방식(글자만) |
| 이미지 | 원본 파일을 첨부로 보관해 표시 (GIRA-78). 받기 전·실패 시에는 회색 자리 표시 |
| 댓글 | 열린 댓글은 💬 표시 + 보드 아래 '보드 댓글' 목록(작성자·시각·본문), 표시를 누르면 해당 댓글 강조. 해결된 댓글은 원본처럼 숨김 (GIRA-78) |
| 모르는 요소 | 사라지지 않게 점선 상자 + '(종류 — 옮기지 못한 요소)' |

## 남은 손실

- **글자 크기의 제목 수준**: 원본 보드에서 제목 1~6은 상자 크기(bs#)에 차이가 없어 크기는 요소 배율(fs#)만 쓰고 제목은 굵게만 표시한다.
  글자 단위 색·크기 마크는 원본 데이터에 없다(색은 요소 단위로 이미 반영).
- **Jira 이슈 카드 등 스마트 요소**: 조사한 33개 보드에 하나도 없어 형식을 확인하지 못했다. 나오면 점선 상자로 보이며, 표본이 생기면 Gira 이슈 카드로 연결한다.
- **번호 목록 시작 번호**: 속성 값 뜻을 확인하지 못해 항상 1부터 매긴다(표본 11개 모두 같은 값).
- **댓글 답글·댓글 작성**: 원본 답글은 같은 목록에 시간순으로 함께 보이고, 원본 보기에서 새 댓글·해결은 아직 못 한다(문서 댓글 기능과 묶어 후속).
- **편집기(Excalidraw)·PNG/JPG 내보내기**: 이미지는 자리 표시, 서식은 글자만(편집기 변환 `web/src/whiteboard-excalidraw.mjs`). SVG 내보내기는 이미지를 서버 주소로 참조해 파일만 따로 열면 이미지가 안 보인다.
