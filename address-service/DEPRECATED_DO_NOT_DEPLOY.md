# ⛔ 이 폴더는 배포하지 마세요 (레거시 · 2026-06 판)

**운영본은 `services/address-service/` 입니다.** 이 폴더는 그 전 버전(CommonJS·express 4)이며
`package.json` 의 이름이 운영본과 **같아서**(`nexus-address-service`) 디렉터리를 잘못 잡고
`gcloud run deploy nexus-address-api --source=.` 를 치면 **6월판 서버가 운영에 올라갑니다.**

그러면 빌드도 성공하고 헬스체크도 통과하지만, 다음 규칙이 통째로 사라집니다:

- **A-35** 신축 오매칭 차단(`matchGuard`·`address_learned`)
- **A-36** 건물명으로 주소 찾기 금지(`sameAddressAsQuery`)
- A-37/A-38 등 08월 정제 규칙 전부

증상은 오류가 아니라 **"정제 규칙이 조용히 예전으로 되돌아감"** 으로만 나타납니다.

## 배포할 때 쓰는 경로

```bash
cd services/address-service
gcloud run deploy nexus-address-api --source=. --region asia-northeast3 --project logis-op
bash scripts/deploy-jobs.sh        # Job 4개(같은 이미지)
```

삭제 여부는 형 판단 사항이라 남겨 둡니다(2026-08-23 점검).
