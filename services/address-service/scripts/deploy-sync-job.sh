#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  주소자료 정기 동기화 — Cloud Run Job + Cloud Scheduler 구성 (형 지시 2026-08-11)
#
#  ★이 파일은 "실행하면 배포되는 스크립트"다. 형 승인 없이 돌리지 말 것.
#  ★기존 서비스(nexus-address-api)는 건드리지 않는다. 별도 Job 으로 분리한 이유:
#     - 적재는 수 분~수십 분 걸린다. 요청 처리용 서비스에 얹으면 커넥션을 붙잡아
#       실사용 매칭이 500(pool connect timeout)으로 무너진다(2026-08-01 실측 사례).
#     - Job 은 실패해도 서비스가 살아 있다.
#
#  전제: gcloud 로그인 계정 ttong627@gmail.com · 프로젝트 logis-op
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT="${PROJECT:-logis-op}"
REGION="${REGION:-asia-northeast3}"
JOB="${JOB:-nexus-address-sync}"
ACCOUNT="${ACCOUNT:-ttong627@gmail.com}"
SCHEDULE="${SCHEDULE:-23 4 * * *}"   # 매일 새벽 4시 23분(정각 회피 — 부하 분산)
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CLOUDSQL="${CLOUDSQL:-logis-op:asia-northeast3:nexus-address-pg}"

echo "▶ Cloud Run Job 배포: $JOB ($REGION / $PROJECT)"
# ★--set-cloudsql-instances 를 빼면 DB에 못 붙는다. 서비스(nexus-address-api)는
#   run.googleapis.com/cloudsql-instances 주석으로 붙어 있고, Job 은 별도 리소스라
#   같은 설정을 다시 줘야 한다(2026-08-11 스키마 Job에서 실측).
# ★--args 는 `--apply` 처럼 대시로 시작하는 값이 있어 커스텀 구분자(^:^)를 쓴다.
gcloud run jobs deploy "$JOB" \
  --source "$SOURCE_DIR" \
  --region "$REGION" \
  --project "$PROJECT" \
  --account "$ACCOUNT" \
  --task-timeout=3600s \
  --max-retries=1 \
  --command=node \
  --args="^:^scripts/sync-address-data.mjs:--apply" \
  --set-cloudsql-instances="$CLOUDSQL" \
  --set-env-vars=PGSSL=disable \
  --update-secrets=DATABASE_URL=ADDRESS_DATABASE_URL:latest,JUSO_API_KEYS=ADDRESS_JUSO_KEYS:latest,KAKAO_REST_KEY=ADDRESS_KAKAO_REST_KEY:latest,VWORLD_KEY=ADDRESS_VWORLD_KEY:latest

# ★--account 를 빼면 전역 활성 계정(다른 계정일 수 있다)으로 조회돼 권한 오류가 난다.
#   이 스크립트는 전역 계정을 바꾸지 않고 명령마다 계정을 지정한다(2026-08-11 실측).
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --account "$ACCOUNT" --format='value(projectNumber)')"
INVOKER="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "▶ 스케줄러 호출 권한 부여: $INVOKER → run.invoker"
# 권한이 없으면 스케줄러는 등록되지만 매번 403 으로 조용히 실패한다(로그를 안 보면 모른다).
gcloud run jobs add-iam-policy-binding "$JOB" \
  --region "$REGION" --project "$PROJECT" --account "$ACCOUNT" \
  --member="serviceAccount:${INVOKER}" --role=roles/run.invoker --quiet >/dev/null

echo "▶ Cloud Scheduler 등록: $SCHEDULE (Asia/Seoul)"
gcloud scheduler jobs create http "${JOB}-trigger" \
  --location "$REGION" \
  --project "$PROJECT" \
  --schedule "$SCHEDULE" \
  --time-zone "Asia/Seoul" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST \
  --oauth-service-account-email "$INVOKER" \
  --account "$ACCOUNT" \
  || echo "  (이미 존재하면 update 로 바꿔 실행: gcloud scheduler jobs update http ${JOB}-trigger ...)"

cat <<'EOF'

완료. 확인 명령:
  gcloud run jobs executions list --job nexus-address-sync --region asia-northeast3 --project logis-op
  gcloud run jobs execute nexus-address-sync --region asia-northeast3 --project logis-op   # 즉시 1회 실행

되돌리기:
  gcloud scheduler jobs delete nexus-address-sync-trigger --location asia-northeast3 --project logis-op
  gcloud run jobs delete nexus-address-sync --region asia-northeast3 --project logis-op
EOF
