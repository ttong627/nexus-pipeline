/**
 * 물량배분 Web Worker — **얇은 껍데기**.
 *
 * ★2026-08-04: 배분 로직 1,004줄을 코어(`services/address-service/src/routing/loadBalance.js`)로
 *   옮겼다. 워커 안에만 있으면 브라우저 밖에서는 아무도 못 쓴다 — 서버도, 생성된 배송 프로그램도.
 *   이제 이 파일이 하는 일은 "메시지를 받아 코어 함수에 넘기고 결과를 돌려주는 것"뿐이다.
 *   UI 를 막지 않으려고 워커를 쓰는 것이지, 로직이 여기 살 이유는 없었다.
 *
 * ⚠️`{ type: 'module' }` 로 로드돼야 import 가 동작한다(RouteMapModal.jsx).
 */
import { computeAutoSplit } from '../../services/address-service/src/routing/loadBalance.js';

self.onmessage = (e) => {
  const { type, ...payload } = e.data;
  if (type !== 'autoSplit') return;
  try {
    const { clusterMap, diagnostics } = computeAutoSplit(payload);
    self.postMessage({ type: 'autoSplitResult', clusterMap, diagnostics });
  } catch (err) {
    self.postMessage({ type: 'autoSplitError', message: err.message });
  }
};
