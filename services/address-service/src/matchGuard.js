// ══════════════════════════════════════════════════════════════════
//  유사매칭 채택 게이트 (형 지시 2026-08-11)
//  "신축 건물의 경우 다른 건물로 유사 매칭하는 오류가 발생하고 있어."
//
//  주소DB는 월 전체분이라 그달 이후 신축이 없다. 건물번호 없는 질의(건물명만)는
//  fuzzyMatch → buildingMatch 로 내려가는데, 지금까지 **트리그램 점수만** 보고
//  채택해 이름이 절반만 닮은 인접 단지를 그대로 집었다.
//
//  ★원칙: 오매칭(엉뚱한 집에 배송) > 미매칭(확인필요로 담당자 처리).
//         애매하면 버리고 확인필요로 넘긴다(CLAUDE.md A-12).
//  ★DB를 쓰지 않는 순수 판정 — 회귀 scripts/match-guard.test.mjs 로 고정한다.
// ══════════════════════════════════════════════════════════════════

// 유형어는 단지를 구분하지 못한다 — 걷어내야 '무지개주공2단지'와
// '무지개마을주공아파트2단지'가 같은 곳으로 보인다.
const GENERIC_RE = /(아파트단지|아파트|apartment|apt|오피스텔|빌라|맨션|연립주택|연립|다세대|공동주택|주택|타운하우스|타운|단지|마을|빌딩|시티|파크|하우스)/gi;
const NON_KEY_RE = /[^0-9a-z가-힣]/g;

export const buildingNameKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(GENERIC_RE, '')
    .replace(NON_KEY_RE, '');

// 차수(1차·2차)는 이름이 거의 같아도 **다른 단지**다. 신축 2차를 기존 1차로 보내는
// 사고가 여기서 난다.
export const parseComplexPhase = (value) => {
  const m = String(value || '').match(/(\d+)\s*차(?![가-힣])/);
  return m ? Number(m[1]) : null;
};

const MIN_SCORE = { fuzzy: 0.42, building: 0.45 };   // 기존 임계 유지 — 게이트는 아래 규칙이 맡는다
const SURE_SCORE = { fuzzy: 0.70, building: 0.75 };  // 이 아래는 채택하되 담당자 확인 대상
const LENGTH_GAP_RATIO = 0.6;                        // 짧은 쪽이 긴 쪽의 60% 미만이면 확인필요

const reject = (reason) => ({ accept: false, needsReview: false, reason });

/**
 * 유사매칭 후보를 채택할지 판정한다.
 * @param {object}  p
 * @param {string}  p.rawQuery   원 질의(정제 전 텍스트)
 * @param {'fuzzy'|'building'} p.kind 어느 매칭 단계의 후보인가
 * @param {object}  p.candidate  DB 후보행 { score, building_name, building_main_no, building_sub_no }
 * @param {object} [p.queryRoad] parseRoadNumber(rawQuery) 결과 — 있으면 번호 일치를 강제한다
 * @returns {{accept:boolean, needsReview:boolean, reason:string}}
 */
export const judgeCandidate = ({ rawQuery = '', kind = 'building', candidate = null, queryRoad = null } = {}) => {
  const score = Number(candidate?.score);
  if (!candidate || !Number.isFinite(score)) return reject('후보 없음');
  if (score < (MIN_SCORE[kind] ?? MIN_SCORE.building)) return reject('유사도 미달');

  // R1. 질의에 건물번호가 있으면 **같은 번호**여야 한다.
  //     신축이 DB에 없을 때 옆 번호 건물이 점수만 높아 채택되던 경로를 끊는다.
  if (queryRoad && queryRoad.buildingMainNo != null) {
    const candMain = Number(candidate.building_main_no);
    if (!Number.isFinite(candMain) || candMain !== Number(queryRoad.buildingMainNo)) {
      return reject('본번 불일치');
    }
    const candSub = Number(candidate.building_sub_no || 0);
    if (candSub !== Number(queryRoad.buildingSubNo || 0)) return reject('부번 불일치');
  }

  // R2. 차수가 다르면 다른 단지다.
  const qPhase = parseComplexPhase(rawQuery);
  const cPhase = parseComplexPhase(candidate.building_name);
  if (qPhase != null && cPhase != null && qPhase !== cPhase) return reject('차수 불일치');

  // R3. 건물명으로 잡은 후보는 **이름 포함관계**를 반드시 통과해야 한다.
  //     (클라 A-32 ④에만 있던 방어를 서버에도 세운다 — 두 경로가 갈라져 있었다)
  let lengthGap = 0;
  if (kind === 'building') {
    const q = buildingNameKey(rawQuery);
    const c = buildingNameKey(candidate.building_name);
    if (!q || !c) return reject('건물명 없음');
    if (!q.includes(c) && !c.includes(q)) return reject('건물명 포함관계 없음');
    lengthGap = Math.min(q.length, c.length) / Math.max(q.length, c.length);
  }

  // R4. 통과했지만 확신이 안 서는 구간은 채택하되 **확인필요**로 표시한다.
  //     (버리면 미매칭이 늘어 그것도 사고 — 담당자가 볼 수 있게만 한다)
  const needsReview = score < (SURE_SCORE[kind] ?? SURE_SCORE.building)
    || (kind === 'building' && lengthGap < LENGTH_GAP_RATIO);

  return { accept: true, needsReview, reason: needsReview ? '유사매칭(확인필요)' : '' };
};
