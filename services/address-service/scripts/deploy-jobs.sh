#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  주소 서비스 Cloud Run Job 일괄 배포 (2026-08-11 점검 후속)
#
#  ★왜 필요한가: Job 4개가 **같은 소스**를 쓰는데 각각 따로 배포된다. 코드를 고치고
#    하나만 재배포하면 나머지는 옛 이미지로 돌면서 **에러 없이 다른 동작**을 한다.
#    가장 찾기 어려운 종류의 불일치라, 배포는 한 번에 하도록 여기 모은다.
#
#  ★이 파일은 "실행하면 배포되는 스크립트"다. 형 승인 없이 돌리지 말 것.
#  ★운영 서비스(nexus-address-api)는 건드리지 않는다. Job 만 다룬다.
#
#  사용:
#    bash scripts/deploy-jobs.sh              # 전부
#    bash scripts/deploy-jobs.sh sync entrc   # 골라서
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT="${PROJECT:-logis-op}"
REGION="${REGION:-asia-northeast3}"
ACCOUNT="${ACCOUNT:-ttong627@gmail.com}"
CLOUDSQL="${CLOUDSQL:-logis-op:asia-northeast3:nexus-address-pg}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SECRETS="DATABASE_URL=ADDRESS_DATABASE_URL:latest,JUSO_API_KEYS=ADDRESS_JUSO_KEYS:latest,KAKAO_REST_KEY=ADDRESS_KAKAO_REST_KEY:latest,VWORLD_KEY=ADDRESS_VWORLD_KEY:latest"

# ★--args 구분자는 **값에 없는 문자**로 고른다.
#   `^:^` 를 쓰다가 `gs://버킷/…` 의 `://` 가 쪼개져 Job 이 scandir 'gs' 로 죽었다
#   (2026-08-11 실측). GCS 경로가 인자로 들어가므로 전부 `^|^` 를 쓴다.
deploy () {
  local name="$1" args="$2" memory="$3" timeout="$4"
  echo "▶ $name  (mem $memory · timeout $timeout)"
  gcloud run jobs deploy "$name" \
    --source "$SOURCE_DIR" \
    --region "$REGION" --project "$PROJECT" --account "$ACCOUNT" \
    --command=node --args="$args" \
    --memory="$memory" --task-timeout="$timeout" --max-retries=1 \
    --set-cloudsql-instances="$CLOUDSQL" \
    --set-env-vars=PGSSL=disable \
    --update-secrets="$SECRETS" \
    --quiet
  echo "  적용된 args: $(gcloud run jobs describe "$name" --region "$REGION" --project "$PROJECT" --account "$ACCOUNT" \
    --format='value(spec.template.spec.template.spec.containers[0].args.list())')"
}

want () { [ $# -eq 0 ] && return 0; for a in "$@"; do [ "$a" = "$TARGET" ] && return 0; done; return 1; }

run_one () {
  TARGET="$1"; shift
  case "$TARGET" in
    # 매일 04:23 정기 동기화 — ①스키마 ②출입구적재 ③학습주소 ④편입 ⑤좌표채움 ⑥이상치검증
    sync)     deploy nexus-address-sync     '^|^scripts/sync-address-data.mjs|--apply' 1Gi 3600s ;;
    # 명단 → 좌표저장소 행 만들기(C-6 이 못 메우는 구멍). 주 1회.
    listfill) deploy nexus-address-listfill '^|^scripts/fill-list-coords.mjs|--all|--apply' 1Gi 7200s ;;
    # C-7 행안부 출입구 자료 적재. /tmp 가 tmpfs 라 메모리 2Gi 필요.
    entrc)    deploy nexus-address-entrc    '^|^scripts/load-juso-entrc.mjs|gs://logis-op-address-source/entrc' 2Gi 7200s ;;
    # 진단·격리 전용. args 를 갈아 끼워 쓰는 자리라 기본값은 격리 스크립트로 되돌려 둔다.
    fill)     deploy nexus-address-fill     'scripts/quarantine-dong-samecoord.mjs' 1Gi 1800s ;;
    *) echo "알 수 없는 Job: $TARGET" >&2; return 1 ;;
  esac
}

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(sync listfill entrc fill)
for t in "${TARGETS[@]}"; do run_one "$t"; done

cat <<'EOF'

완료. 확인:
  gcloud run jobs list --region asia-northeast3 --project logis-op --account ttong627@gmail.com

⚠️ entrc 는 기본이 **예행**이다. 실제 적재는 args 에 --apply 를 더해 실행할 것:
  gcloud run jobs update nexus-address-entrc --args='^|^scripts/load-juso-entrc.mjs|gs://logis-op-address-source/entrc|--apply' \
    --region asia-northeast3 --project logis-op --account ttong627@gmail.com

⚠️ 좌표 채움과 출입구 적재를 **동시에 돌리지 말 것** — 같은 Cloud SQL(1 vCPU)이다.
EOF
