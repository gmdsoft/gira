# 요구사항

## 목표
현재 클라우드로 사용 중인 Confluence(`gmdsoft.atlassian.net`)를 대체하는, 사내 서버에서 직접 운영하는 웹 기반 문서 서비스.

## 필수 요건
- **사내 서버 자체 호스팅**: 외부 SaaS 의존 없이 사내 인프라에서 구동
- **Docker 배포**: 최종 결과물은 docker compose로 배포 가능해야 한다 (TrueNAS Custom App 포함)
- **다중 인스턴스**: 보안에 민감한 문서(스페이스)는 별도 내부 서버의 독립 Docker 인스턴스로 옮길 수 있어야 한다 → 스페이스 단위 내보내기/가져오기 기능 필수
- **마이그레이션**: 기존 Confluence Cloud의 스페이스, 페이지 계층, 본문, 첨부파일, 버전 이력, 댓글, 라벨, 권한을 새 서비스로 이관
- **Jira 링크 호환**: Jira 이슈 본문·댓글·remote link에 있는 기존 Confluence 링크(약 6,100개 이슈)가 마이그레이션 후에도 동작해야 한다
- **인증**: 회사 Microsoft 계정(Entra ID, OIDC) SSO 로그인

## 분석 방식
1. **UI/동작 분석**: 사용자 PC의 Chrome(CDP 9222)을 SSH 역방향 포워딩으로 연결 후 `rea`로 수집. 결과는 기능 명세의 참고 자료로만 사용하고 Atlassian 코드는 가져오지 않는다.
2. **데이터 구조 분석**: Confluence REST API(v2)로 인벤토리 수집 → 데이터 모델 설계 및 마이그레이션 범위 산정 (`scripts/confluence-inventory.mjs`)
