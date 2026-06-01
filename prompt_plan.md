# 구현 계획: 사용자·기업 모델 재설계 + 기업소속 기사/행정동 매칭 보존 + 명단 무리프레시 편집

> 승인일: 2026-06-01 · 형 확정. 기존 작동기능(주소정제 A·기사배분 R·배송순번 DS·3순위 매칭) 절대 보존.

## 형 확정 사항
1. 소속사 = 기업 = 동일 계층. 단일 엔티티 + `welshareMember` 플래그(소속사 true/일반기업 false).
2. 권한·지역·기사·데이터 전부 기업 귀속. 담당자 교체 = ownerUid 매칭만 변경(재생성 금지).
3. 사용자(User) ↔ 기업(Company) 명확 분리.
4. 데이터 소유권 = 지역(권한지역) 기준. 관리자 대리생성도 해당 지역 기업 데이터로 인식.
5. 기사 = 기업소속기사로 통일. **기업 하위 기사 생성·등록·지역·행정동 매칭 기능 잘 유지(최우선).**
6. 명단 인라인 편집 무리프레시.

## 데이터 모델 (user_companies 재활용, 컬렉션 이동 없음)
- `user_companies/{companyCode}`: name, welshareMember(신규), citiesApproved, ownerUid, ownerEmail, memberUids(신규), drivers 서브컬렉션
- `users/{uid}`: email, role, tier, maxCities, realName, companyId(=companyCode). orgId/region/citiesApproved → 기업 이관
- 데이터: base_lists/{city}, cloud_lists/{city}/months/{YYYY-MM} — city 키 유지. 감사필드 ownerCompanyCode/createdByUid 추가. 소유 판정은 지역.

## 기사 단일화 (보존 핵심)
- 기존 3단계 폴백(org_drivers / user_companies drivers / user_drivers) → user_companies/{code}/drivers 단일 소스로 통일하되 읽기 폴백 유지.
- 기사 생성·등록·capacity·color·status·메모·지역/행정동 매칭 UI/로직 그대로 유지.

## Phase 순서
- Phase 0: 마이그레이션 스크립트 + 관리자 버튼(폴백 읽기, 무손실/롤백)
- Phase 1: companies 스키마 + 헬퍼(getMyCompany, canAccessCity)
- Phase 2: AdminPanel 재편(사용자 탭/기업 탭 분리, 기업 생성→사용자 매칭, ownerUid 교체)
- Phase 3: 기사 기업 귀속 단일화 + 행정동 매칭 보존
- Phase 4: 지역 기반 소유권/권한 게이트(base/cloud CRUD)
- Phase 5: 명단 무리프레시 인라인 편집(원인: per-keystroke commit + dirtyRecords 의존 재정렬 → blur commit + 편집행 정렬 제외)
- Phase 6: firestore.rules 권한 반영

## 절대 보존
주소정제 A규칙 / 기사배분 R규칙 / 배송순번 DS규칙 / §2 3순위 매칭 / 배치 499 / getDocsFromServer / pushHistory / 기업하위 기사·행정동 매칭
