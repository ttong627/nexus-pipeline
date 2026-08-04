// SSOT: services/address-service/src/routing/routeSequenceEngine.js (배송 코어 승격 2026-08-03).
//   서버 Docker 빌드 컨텍스트(`COPY src ./src`)에 포함시키려 실체를 서비스 쪽으로 옮겼다.
//   루트 src/ 에 두면 서버 이미지에 안 들어가 코어 API 로 노출할 수 없다(shared 모듈과 같은 이유).
//   이 파일은 기존 참조 경로 호환을 위한 재수출 스텁 — 로직·알고리즘은 SSOT 에만 존재한다.
//
//   참조처: engine/addressEngine.js(parseAptDong) · engine/deliveryDaySplit.js(haversine) ·
//           workers/routeWorker.js(순수헬퍼 9종) — 전부 경로 무변경으로 동작한다.
export * from '../../services/address-service/src/routing/routeSequenceEngine.js';
