// 프로젝트별 상태 목록 (원본 GET /rest/api/3/project/{key}/statuses 의 합집합)
import { query } from '../../server/src/db.mjs';

export async function replaceProjectStatuses(projectId, statusIds) {
  await query(`DELETE FROM jira_project_statuses WHERE project_id = $1 AND NOT (status_id = ANY($2::bigint[]))`,
    [projectId, statusIds]);
  await query(`INSERT INTO jira_project_statuses (project_id, status_id)
               SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [projectId, statusIds]);
}
