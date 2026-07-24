# HANDOFF — VWorld 동별좌표 / 배송완료 좌표 비교 (2026-07-24 → 07-25 완료)

> ①②-A②-B **전부 완료·배포됨**(2026-07-25, 커밋 a4beda0, logis-op.web.app). 남은 것은 형 폰 실기기 완료버튼 테스트뿐.

## ✅ ②-A·②-B 완료 (2026-07-25, 커밋 a4beda0 배포)
### ②-A 기사앱 배송완료 버튼 (`src/components/ShareRouteView.jsx`)
- 배송지별 "배송완료" 토글 버튼 → 탭 시 `latestLocRef` 현재 GPS 캡처.
- `errM = Math.round(haversineKm(gps, 동별좌표)*1000)`(공용 `engine/coordValidator.js` 재사용).
- 저장: `updateDoc(route_shares/{shareId}, { completions.{record._uid}: {at,driverId,name,lat,lng,accuracy,dongLat,dongLng,errM} })`. 취소=`deleteField()`.
- GPS 미허용 시에도 완료시각 기록(errM=null "위치 없이 기록"). 목록·지도핀 ✓·초록 표시.
- **firestore.rules**: `route_shares` update 화이트리스트에 `completions` 추가(map 검증 + 마지막 건 취소로 필드 소멸 허용). ⚠️ HANDOFF 초안의 "completions도 같은 문서라 OK"는 오판이었음 — 화이트리스트라 rules 보강 필수였고 반영함.
### ②-B 관리자 비교뷰 (`src/components/RouteMapModal.jsx` + 신규 `DeliveryAccuracyView.jsx`)
- 툴바(지적도 옆) "완료비교" 토글 → `handleLoadCompletions`(route_shares getDocs, city+monthId) → 지도에 동별좌표↔완료좌표 연결선+오차 라벨(>100m 빨강·>50m 주황·양호 초록). 별도 `completionOverlaysRef`.
- "정확도" 버튼 → `DeliveryAccuracyView`(오차 순위·평균·최대·이상>100m·위치없음 건수, 행 클릭 시 지도 focus).
- **핵심 설계**: completion 문서에 `dongLat/dongLng·errM·name`을 함께 저장 → ②-B는 record 매칭 불필요, completions 데이터만으로 완결(견고).
- 검증: eslint 신규코드 0에러, vite build 그린, 배포 HTTP 200.

## ✅ 오늘 완료 (①, 배포됨)
1. **V7.3 VWorld 소스 복구** — 배포본에만 있고 git 미커밋이던 서버 소스를 GCS 배포 아카이브에서 복구. 커밋 `2219bae`.
   - `services/address-service/src/vworld.js`(신규): VWorld 지오코더 + `LT_C_SPBD` 건물레이어 동(棟)별 좌표·층수
   - server.js: `/v1/address/geocode`(VWorld 우선→Kakao 폴백) + 신규 `POST /v1/building/dong-coords`
2. **functions v월드 배선** — 커밋 `0e772dd`, **배포 완료**. `functions/index.js`의 좌표 자동채우기(geocode·geocodeAuto)를 nexus-address-api 경유로 전환. 아파트+동번호면 dong-coords(동별), 일반은 geocode, 실패 시 kakao 폴백.
   - dongNo는 서버 parseDongNo가 "동" 글자를 요구 → **`${dongNo}동`으로 넘긴다**(중요, 안 붙이면 complex 폴백).
3. **재좌표 도구** — 커밋 `e23c13a`. `scripts/_reproject-dong.mjs "시군구" "월" [--write]`.
   - **부천 오정구 2026-07 시연 완료**: 아파트+동 2335건 중 1685건 동별 좌표 갱신(`좌표출처=vworld-dong`, `dongFloors` 저장), 171개 단지 분산. 여월휴먼시아 24개동 전부 개별 좌표+층수 검증.

## 🔜 남은 작업 ② — 배송완료 좌표 ↔ 동별좌표 비교 (설계 확정)
형 결정: **기사앱 완료버튼** 방식 + 비교뷰 **둘 다**(지도 토글 + 분석화면).

### ②-A 기사앱 배송완료 버튼 (먼저)
- 파일: `src/components/ShareRouteView.jsx` (기사 공유링크 지도, 인증 없음 → **route_shares 문서만 접근 가능**)
- 기존: 실시간 GPS를 `route_shares/{shareId}.liveGps.{driverId}`에 5초마다 방송(298~315행). GPS 로직 `applyGpsPosition`/`latestLocRef` 220~315행. 배송지 목록 `shareData.records`, allRecords 392~407행.
- **구현**: 각 배송지 항목/핀에 "배송완료" 버튼 → 탭 시 현재 GPS(`latestLocRef.current`) 캡처 →
  `updateDoc(route_shares/{shareId}, { [\`completions.\${uid}\`]: {lat,lng,accuracy,at:ISO, dongLat, dongLng, 오차m} })`
  - `오차m` = haversine(완료GPS, record.lat/lng) — record.lat/lng는 이제 vworld-dong 동별좌표
  - 완료된 배송지는 목록/핀에 ✅ 표시(shareData.completions 구독)
- 권한: `firestore.rules` 178행 route_shares — read(TTL)·create(auth). update 규칙 확인(liveGps가 되니 허용됨). completions도 같은 문서라 OK. 필요 시 rules 보강.
- **검증**: 기사앱은 모바일 GPS라 **형 폰 실기기 테스트 필요**(데스크톱 GPS 부정확).

### ②-B 비교뷰 (데이터 쌓인 뒤)
1. **관리자 배송지도 토글** — `src/components/RouteMapModal.jsx`(6095줄, 카카오 SDK). 동별좌표 핀 ↔ 완료좌표 점을 선으로 잇고 거리(m) 라벨. 오차 큰 건 빨강. route_shares.completions 로드.
2. **별도 분석화면** — "배송 정확도" 전용: 오차 큰 순 목록·평균·이상(>100m) 건수. 배송이 실제 그 동에 갔는지 검증.

## 참고
- nexus-address-api URL: `https://nexus-address-api-31783407891.asia-northeast3.run.app` (Cloud Run rev 00034, VWORLD_KEY 설정됨)
- VWorld 키: `.env`/Cloud Run env (gitignore). 프론트 `.env`에 VITE_VWORLD_KEY도 있으나 현재 미사용.
- 배포: 프론트 `npm run deploy`(firebase hosting, 계정 ttong627), functions `firebase deploy --only functions --project logis-op --account ttong627@gmail.com`(functions/node_modules 필요 → npm install 먼저).
- ⚠️ 이 저장소는 **I: 정본 + 다중 PC 클론** 동시사용 → 하루 작업은 반드시 커밋·푸시로 마감(V7.3 미커밋 분기 사고 원인).
- 메모리: `project_nexus_vworld_v73`.
