// ══════════════════════════════════════════════════════════════════
//  기업(소속사) 통합 모델 헬퍼
//  설계: CLAUDE.md / prompt_plan.md
//  · 소속사와 기업은 동일 계층 — welshareMember 플래그로만 구분
//    (소속사 = 웰쉐어 회원사 = true / 일반기업 = 비회원사 = false)
//  · 권한지역(citiesApproved)·기사·데이터는 전부 기업에 귀속
//  · 담당자(사용자) 교체는 ownerUid 매칭만 변경 — 기업 재생성 금지
// ══════════════════════════════════════════════════════════════════
import { collection, doc } from 'firebase/firestore';
import { db } from '../config/firebase.js';

export const COMPANIES_COLLECTION = 'user_companies';

// 소속사 여부 (웰쉐어 회원사 = true)
export const isWelshareMember = (company) => company?.welshareMember === true;

// 기업 권한지역 배열 — citiesApproved 우선, 구 cities 폴백
export const getCompanyCities = (company) =>
  Array.isArray(company?.citiesApproved) ? company.citiesApproved
    : Array.isArray(company?.cities) ? company.cities
      : [];

// 지역(지자체) 접근 권한 — 관리자 전체 허용, 그 외 기업 권한지역 포함 여부
export const canAccessCity = (user, company, city) => {
  if (user?.role === 'admin') return true;
  if (!city) return false;
  return getCompanyCities(company).includes(city);
};

// ── 기업소속 기사 컬렉션 경로 해석 (기존 동작 100% 보존) ──────────────
//   우선순위: 소속사(orgId) > 기업(companyCode) > 개인(uid)
//   ※ 기사 생성/등록/지역·행정동(assignedZones) 매칭은 이 경로 기준으로 동작
export const resolveDriversCollectionPath = ({ orgId, companyCode, uid } = {}) => {
  if (orgId) return ['org_drivers', orgId, 'drivers'];
  if (companyCode) return [COMPANIES_COLLECTION, companyCode, 'drivers'];
  if (uid) return ['user_drivers', uid, 'drivers'];
  return null;
};

export const getDriversCollection = (opts) => {
  const path = resolveDriversCollectionPath(opts);
  return path ? collection(db, ...path) : null;
};

export const getDriverDoc = (opts, driverId) => {
  const path = resolveDriversCollectionPath(opts);
  return path ? doc(db, ...path, driverId) : null;
};

// 기사 소속 라벨 (회사 → 기업 명칭 통일)
export const getDriverScopeLabel = ({ orgId, companyCode } = {}) => {
  if (orgId) return `소속사: ${orgId}`;
  if (companyCode) return `기업: ${companyCode}`;
  return '개인';
};
