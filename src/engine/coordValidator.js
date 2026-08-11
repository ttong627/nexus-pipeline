// SSOT: services/address-service/src/shared/coordValidator.js (C-6 — 서버·클라 공용).
//   서버 Docker 빌드 컨텍스트(`COPY src ./src`)에 포함시키려 실체를 shared로 옮겼다.
//   정기배치 ⑥ 좌표 이상치 검증이 이 판정을 그대로 쓴다 — 화면과 배치가 같은 기준이어야
//   "화면에선 정상인데 배치가 outlier로 찍는" 어긋남이 생기지 않는다.
//   이 파일은 기존 참조 경로 호환을 위한 재수출 스텁 — 로직·규칙은 SSOT에만 존재한다.
export * from '../../services/address-service/src/shared/coordValidator.js';
