// SSOT: services/address-service/src/shared/applyNoteNormalize.js (P7 Phase2 — 서버·클라 공용).
//   서버 Docker 빌드 컨텍스트(`COPY src ./src`)에 포함시키려 실체를 shared로 옮겼다.
//   이 파일은 기존 참조 경로 호환을 위한 재수출 스텁 — 로직·규칙은 SSOT에만 존재한다.
export * from '../../services/address-service/src/shared/applyNoteNormalize.js';
export { default } from '../../services/address-service/src/shared/applyNoteNormalize.js';
