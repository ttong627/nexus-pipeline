export const sourceLayout = {
  roadCodes: {
    prefix: '202604_주소DB_전체분/개선_도로명코드_전체분.txt',
    label: '주소DB 도로명코드',
  },
  addressLinks: {
    prefix: '202604_주소DB_전체분/주소_',
    label: '주소DB 주소',
  },
  roadAddressKorean: {
    prefix: '202604_도로명주소 한글_전체분/',
    label: '도로명주소 한글',
    includes: 'jibun_rnaddrkor_',
  },
  buildings: {
    prefix: '202604_건물DB_전체분/build_',
    label: '건물DB 건물정보',
  },
  detailDongDisplays: {
    prefix: '202604_상세주소 동 표시_전체분/rnspbd_dong_',
    label: '상세주소 동 표시',
  },
  detailAddresses: {
    prefix: '202604_상세주소DB_전체분/adrdc_',
    label: '상세주소DB',
  },
  detailBuildingDisplays: {
    prefix: '202604_상세주소 표시_전체분/rnspbd_adrdc_',
    label: '상세주소 표시 건물',
  },
  detailFloorRoomDisplays: {
    prefix: '202604_상세주소 표시_전체분/rnspbt_adrdc_',
    label: '상세주소 표시 층호',
  },
};

export const toStoragePrefix = (rootPrefix, childPrefix) =>
  [String(rootPrefix || '').replace(/\/+$/, ''), String(childPrefix || '').replace(/^\/+/, '')]
    .filter(Boolean)
    .join('/');
