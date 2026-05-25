# OMC 도입 상세 정보

> 이 파일은 omc-adoption.md에서 분리된 설치/유지보수 상세 내용입니다.
> 운영 핵심 정보는 [omc-adoption.md](omc-adoption.md) 참조.

## 설치 정보

- **버전**: 최신 (설치 버전 기록 필요)
- **설치 방식**: `claude plugin install oh-my-claudecode` (마켓플레이스)
- **라이선스**: MIT
- **백업**: `~/.claude/settings.json.bak.{TIMESTAMP}`

## 도입 범위 상세

### 변경 없는 기존 요소

- 기존 MCP 서버, 기존 안전 훅, CC CHIPS 상태바
- Custom agents, existing skills
- settings.json 권한 구조, 팀 모드 설정
- git-workflow, security, coding-style 등 모든 규칙 파일

## 업무 방식 변화 상세

### 1. 모델 라우팅: 수동 → 자동

기존: performance-v2.md의 테이블을 Claude가 읽고 따르길 바람 (준수율 ~60%)
지금: 위임 강제기가 Task 호출을 가로채서 model 파라미터 자동 주입 (준수율 ~100%)
비용 절감: ~29% 예상

### 2. 코드 탐색: 텍스트 → 구조 인식

기존: Grep/Glob 텍스트 매칭 (false positive 多)
지금: LSP/AST 도구 추가 사용 가능

| 도구 | 용도 |
|------|------|
| lsp_goto_definition | 심볼 정의 위치로 이동 |
| lsp_find_references | 심볼의 모든 참조처 찾기 (정확) |
| lsp_hover | 타입 정보, 문서 확인 |
| lsp_rename | 심볼 전체 리네임 (모든 파일) |
| lsp_diagnostics | 특정 파일의 타입 에러 확인 |
| lsp_diagnostics_directory | 디렉토리 전체 타입 체크 |
| ast_grep_search | 코드 구조 패턴 검색 (메타변수 지원) |
| ast_grep_replace | 구조적 코드 치환 (드라이런 지원) |

### 3. 컨텍스트 유실 방지: 없음 → 3중 안전망

| 계층 | 기능 |
|------|------|
| 선제적 컴팩션 | 70%/90% 경고로 미리 대비 |
| Notepad | Priority Context(핵심 메모) + Working Memory(작업 기록) 디스크 저장 |
| Project Memory | 프로젝트 환경 자동 학습, 세션 간 유지 |

### 4. 에이전트 프롬프트: 느슨한 가이드 → 구조화된 행동 강제

6개 에이전트를 OMC `<Agent_Prompt>` 형식으로 병합 (상세는 omc-adoption.md "병합 에이전트" 섹션 참조).

## OMC 업데이트 프로세스

OMC 버전 업데이트 시 반드시 5단계 프로세스를 따른다:

### Step 1: 백업
```bash
bash ~/.claude/scripts/pre-omc-update.sh
```

### Step 2: 업데이트
```bash
claude plugin update oh-my-claudecode
```

### Step 3: Diff 확인
```bash
# 병합 에이전트가 덮어씌워졌는지 확인
diff ~/.claude/backups/pre-omc-update-*/agents/ ~/.claude/agents/
```

### Step 4: 재병합
덮어씌워진 병합 에이전트가 있으면 백업에서 복원:
```bash
cp ~/.claude/backups/pre-omc-update-TIMESTAMP/agents/planner.md ~/.claude/agents/
# ... 필요한 에이전트마다 반복
```

### Step 5: 검증
```bash
# 에이전트 로드 확인
claude --print-config | grep agents
# 빌드 테스트
npm run build  # (해당 프로젝트에서)
```

## 롤백 방법

```bash
# OMC만 제거 (기존 시스템 유지)
claude plugin uninstall oh-my-claudecode

# 완전 복원 (필요시)
cp ~/.claude/settings.json.bak.20260220120304 ~/.claude/settings.json
```

## 위험 관리

| 위험 | 완화 |
|------|------|
| SDK v0.x 깨짐 | 버전 4.2.15 고정, 수동 업데이트만 |
| 버스 팩터 1 (93.3% 단일 개발자) | MIT 라이선스, 포크 가능 |
| settings.json 손상 | 설치 전 백업 존재 |
| 성능 영향 | 훅 지연 131-156ms (200ms 기준 이내) |

## 파일 위치

- 플러그인: `~/.claude/plugins/cache/omc/oh-my-claudecode/{VERSION}/`
- .mcp.json (수정됨): 위 경로 + 마켓플레이스 소스
- 병합 에이전트: `~/.claude/agents/{planner,architect,code-reviewer,security-reviewer,tdd-guide,build-error-resolver}.md`
- 백업 스크립트: `~/.claude/scripts/pre-omc-update.sh`
- 백업: `~/.claude/settings.json.bak.{TIMESTAMP}`
