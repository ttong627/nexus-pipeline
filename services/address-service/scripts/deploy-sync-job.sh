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

echo "▶ Cloud Run Job 배포: $JOB ($REGION / $PROJECT)"
gcloud run jobs deploy "$JOB" \
  --source "$SOURCE_DIR" \
  --region "$REGION" \
  --project "$PROJECT" \
  --account "$ACCOUNT" \
  --task-timeout=3600s \
  --max-retries=1 \
  --command=node \
  --args=scripts/sync-address-data.mjs,--apply \
  --update-secrets=DATABASE_URL=ADDRESS_DATABASE_URL:latest,JUSO_API_KEYS=ADDRESS_JUSO_KEYS:latest,KAKAO_REST_KEY=ADDRESS_KAKAO_REST_KEY:latest,VWORLD_KEY=ADDRESS_VWORLD_KEY:latest

echo "▶ Cloud Scheduler 등록: $SCHEDULE (Asia/Seoul)"
gcloud scheduler jobs create http "${JOB}-trigger" \
  --location "$REGION" \
  --project "$PROJECT" \
  --schedule "$SCHEDULE" \
  --time-zone "Asia/Seoul" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST \
  --oauth-service-account-email "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  || echo "  (이미 존재하면 update 로 바꿔 실행: gcloud scheduler jobs update http ${JOB}-trigger ...)"

cat <<'EOF'

완료. 확인 명령:
  gcloud run jobs executions list --job nexus-address-sync --region asia-northeast3 --project logis-op
  gcloud run jobs execute nexus-address-sync --region asia-northeast3 --project logis-op   # 즉시 1회 실행

되돌리기:
  gcloud scheduler jobs delete nexus-address-sync-trigger --location asia-northeast3 --project logis-op
  gcloud run jobs delete nexus-address-sync --region asia-northeast3 --project logis-op
EOF
