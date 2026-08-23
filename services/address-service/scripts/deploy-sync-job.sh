#!/usr/bin/env bash
# ⛔이 스크립트는 **더 이상 Job 을 직접 배포하지 않는다**(2026-08-23 점검).
#   같은 Job(nexus-address-sync)을 `deploy-jobs.sh` 와 **다른 구분자**(`^:^`)로 배포하고 있었고,
#   그 구분자는 `gs://` 경로를 쪼개 Job 을 죽인다(2026-08-11 실측 · deploy-jobs.sh 헤더 참조).
#   → 배포는 deploy-jobs.sh 하나로 통일한다. 스케줄러 등록만 여기 남긴다.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[deploy-sync-job] Job 배포는 deploy-jobs.sh 로 위임합니다."
bash "$DIR/deploy-jobs.sh" "$@"

cat <<'MSG'

스케줄러(매일 04:23 KST)는 이미 등록돼 있습니다. 새로 만들 때만 아래를 실행하세요:

  gcloud scheduler jobs create http nexus-address-sync-trigger \
    --location=asia-northeast3 --schedule="23 4 * * *" --time-zone="Asia/Seoul" \
    --uri="https://asia-northeast3-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/logis-op/jobs/nexus-address-sync:run" \
    --http-method=POST --oauth-service-account-email="31783407891-compute@developer.gserviceaccount.com"
MSG
