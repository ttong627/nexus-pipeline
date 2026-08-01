// ══════════════════════════════════════════════════════════════════
//  dictStore — 학습사전 5종을 Firestore에서 읽어 purifyCore에 넣어줄 형태로 보관 (P7 Phase2 ⓐ)
//
//  클라(addressEngine.loadTypoDict)가 브라우저에서 하던 일을 서버가 그대로 한다.
//  읽는 컬렉션·필드·폴백(`wrong || doc.id`)은 클라와 **한 글자도 다르면 안 된다** —
//  다르면 같은 명단이 클라 정제와 서버 정제에서 다른 결과를 낸다.
//
//  설계 원칙
//   ① **getter 주입**: purifyCore는 호출 시점에 사전을 읽는다. 값 스냅샷을 넘기면
//      로드 이전의 빈 사전이 영구 고정된다(scripts/purify-core-deps.test.mjs ③).
//   ② **사전이 없어도 서버는 산다**: 권한 미부여·Firestore 장애 시 빈 사전으로 계속 동작한다.
//      학습 보정만 빠지고 규격화(A-1~A-29)는 그대로다. 정제 API가 통째로 죽는 것보다 낫다.
//   ③ **firebase-admin은 지연 import**: 이 모듈을 import하는 것만으로 인증을 시도하지 않는다.
//      테스트·파리티 검증이 자격증명 없이 돌아간다.
//   ④ TTL 캐시 + in-flight 합류: 배치 요청 수백 건이 동시에 와도 Firestore 조회는 1회.
// ══════════════════════════════════════════════════════════════════
import { config } from './config.js';
import { buildVariantIndex } from './shared/normalizeVariant.js';
import { DEFAULT_SPECIAL_CHARS, buildTypoRegex, buildSpecialCharRegex } from './shared/dictRegex.js';

// 클라 loadTypoDict와 동일한 컬렉션·필드 매핑. (dict 키, 컬렉션, 키필드, 값필드)
const SOURCES = [
  { key: 'typoDict', collection: 'typo_dict', keyField: 'wrong', valueField: 'correction' },
  { key: 'nameTypoDict', collection: 'name_typo_dict', keyField: 'wrong', valueField: 'correction' },
  { key: 'buildingAliasDict', collection: 'building_alias', keyField: 'alias', valueField: 'canonical' },
  { key: 'noteNormalizeDict', collection: 'note_normalize_dict', keyField: 'wrong', valueField: 'correction' },
];
const SPECIAL_CHARS_COLLECTION = 'special_chars';

const emptyDicts = () => ({
  typoDict: {},
  nameTypoDict: {},
  buildingAliasDict: {},
  noteNormalizeDict: {},
  specialChars: [...DEFAULT_SPECIAL_CHARS],
});

/** 원시 사전 → purifyCore가 받는 형태(정규식·표기변이 인덱스 포함). 순수함수. */
export const deriveDicts = (raw = {}) => ({
  typoDict: raw.typoDict || {},
  nameTypoDict: raw.nameTypoDict || {},
  buildingAliasDict: raw.buildingAliasDict || {},
  noteNormalizeDict: raw.noteNormalizeDict || {},
  typoRegex: buildTypoRegex(raw.typoDict),
  // ★특수문자는 목록이 비면 기본값으로 되돌린다 — 클라(항상 기본값 보유)와 A-9 결과를 맞춘다.
  //   빈 목록을 그대로 넘기면 A-9가 통째로 꺼져 클라와 갈라진다.
  specialCharRegex: buildSpecialCharRegex(
    raw.specialChars?.length ? raw.specialChars : DEFAULT_SPECIAL_CHARS,
  ),
  // D: 표기변이 정규화 인덱스(건물명·특이사항만, 이름 제외) — 클라와 동일.
  buildingAliasVariantIndex: buildVariantIndex(raw.buildingAliasDict),
  noteNormalizeVariantIndex: buildVariantIndex(raw.noteNormalizeDict),
});

/** Firestore에서 5컬렉션을 읽어 원시 사전으로. firebase-admin은 여기서만 만진다. */
export const loadFromFirestore = async () => {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  const existing = getApps()[0];
  let app = existing;
  if (!app) {
    // ★자격증명 선(先)검사 — 절대 순서를 바꾸지 말 것 (2026-08-01 실측 사고).
    //   ADC 없이 Firestore 클라이언트를 먼저 만들면 google-gax가 gRPC stub을 만드는 도중
    //   **잡을 수 없는 unhandledRejection**으로 터져 API 프로세스 전체가 죽는다
    //   (`Could not load the default credentials` → Node 프로세스 종료).
    //   getAccessToken()은 정상적으로 reject하는 awaitable이라 여기서 안전하게 걸러진다.
    const credential = applicationDefault();
    await credential.getAccessToken();
    app = initializeApp({
      credential,     // ADC(Cloud Run 런타임 SA) — 키파일 불요. SA에 roles/datastore.viewer 필요.
      ...(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : {}),
    });
  }
  const db = getFirestore(app);

  const raw = emptyDicts();
  const snaps = await Promise.all([
    ...SOURCES.map((s) => db.collection(s.collection).get()),
    db.collection(SPECIAL_CHARS_COLLECTION).get(),
  ]);

  SOURCES.forEach((source, index) => {
    for (const doc of snaps[index].docs) {
      const data = doc.data() || {};
      const key = data[source.keyField] || doc.id;
      const value = data[source.valueField];
      if (key && value) raw[source.key][key] = value;
    }
  });
  const specials = new Set(raw.specialChars);
  for (const doc of snaps[SOURCES.length].docs) specials.add((doc.data() || {}).char || doc.id);
  raw.specialChars = [...specials];

  return raw;
};

/**
 * 사전 저장소 생성.
 * @param {{ loader?: () => Promise<object>, ttlMs?: number, onError?: (e: Error) => void }} options
 *        loader를 주입하면 Firestore 없이도 쓴다(테스트·파리티 검증).
 */
export const createDictStore = ({ loader = loadFromFirestore, ttlMs = config.dictTtlMs, onError } = {}) => {
  let current = deriveDicts(emptyDicts());
  let loadedAt = 0;
  let inflight = null;

  const refresh = () => {
    if (inflight) return inflight;          // in-flight 합류 — 동시 요청이 Firestore를 난타하지 않는다
    inflight = (async () => {
      try {
        current = deriveDicts(await loader());
      } catch (error) {
        // 실패해도 빈 사전(또는 직전 사전)으로 계속 간다. 다음 TTL에 재시도.
        (onError || ((e) => console.error('[dictStore] 학습사전 로드 실패(빈 사전으로 계속):', e.message)))(error);
      } finally {
        loadedAt = Date.now();
        inflight = null;
      }
    })();
    return inflight;
  };

  const ensureFresh = () => ((Date.now() - loadedAt >= ttlMs) ? refresh() : Promise.resolve());

  return {
    refresh,
    /** 지금 로드된 원시 상태 확인용(모니터링·테스트). */
    stats: () => ({
      loadedAt,
      typo: Object.keys(current.typoDict).length,
      nameTypo: Object.keys(current.nameTypoDict).length,
      buildingAlias: Object.keys(current.buildingAliasDict).length,
      noteNormalize: Object.keys(current.noteNormalizeDict).length,
    }),
    /** ★purifyCore에 그대로 넘길 getter 객체. 값 복사 금지(§설계원칙 ①). */
    dicts: {
      // 코어가 정제 시작 전에 await 한다 → 여기서 TTL 만료를 확인하고 필요하면 갱신을 기다린다.
      get ready() { return ensureFresh(); },
      get typoDict() { return current.typoDict; },
      get typoRegex() { return current.typoRegex; },
      get nameTypoDict() { return current.nameTypoDict; },
      get specialCharRegex() { return current.specialCharRegex; },
      get buildingAliasDict() { return current.buildingAliasDict; },
      get buildingAliasVariantIndex() { return current.buildingAliasVariantIndex; },
      get noteNormalizeDict() { return current.noteNormalizeDict; },
      get noteNormalizeVariantIndex() { return current.noteNormalizeVariantIndex; },
    },
  };
};
