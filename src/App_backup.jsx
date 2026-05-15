import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UploadCloud, CheckCircle, AlertTriangle, Download, Settings, ChevronLeft, ChevronRight, FileSpreadsheet, ArrowRight, Database, Columns, LogOut, ShieldCheck, Activity } from 'lucide-react';

// ============================================================================
// 🔥 1. FIREBASE INITIALIZATION & CONFIG
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyDnKkUkKgZIfF6eVuClwOdl2nsG1q8QUL8",
  authDomain: "logis-op.firebaseapp.com",
  projectId: "logis-op",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const JUSO_API_KEYS = [
  "U01TX0FVVEgyMDI2MDUwNDE0MjYzMjExODA5Mjg=", 
  "U01TX0FVVEgyMDI2MDQyOTExMTAwNzExODA3MDA="
];
const apiCache = new Map();
const pendingRequests = new Map();
let currentApiIdx = 0;

// IndexedDB 영구 스토리지 (싱글톤)
const initDB = () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("NexusJusoDB", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("jusoCache", { keyPath: "keyword" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const getLocalCache = async (keyword) => {
  try {
    const db = await initDB();
    return new Promise(resolve => {
      const req = db.transaction("jusoCache", "readonly").objectStore("jusoCache").get(keyword);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
};
const setLocalCache = async (keyword, data) => {
  try {
    const db = await initDB();
    return new Promise(resolve => {
      const tx = db.transaction("jusoCache", "readwrite");
      tx.objectStore("jusoCache").put({ keyword, data });
      tx.oncomplete = () => resolve();
    });
  } catch (e) {}
};

// ============================================================================
// 🔥 2. UTILS & DATA ENGINES (안정성 강화)
// ============================================================================
const loadSheetJS = () => {
  return new Promise((resolve) => {
    if (window.XLSX) return resolve(window.XLSX);
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    document.head.appendChild(script);
  });
};

const asyncPool = async (poolLimit, array, iteratorFn) => {
  const ret = []; const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
};

const fetchJusoAPI = async (keyword, retryCount = 0) => {
  if (retryCount >= JUSO_API_KEYS.length) return null;
  const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${JUSO_API_KEYS[currentApiIdx]}&currentPage=1&countPerPage=1&keyword=${encodeURIComponent(keyword)}&resultType=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP_ERROR");
    const data = await res.json();
    if (data.results?.common?.errorCode === "E0005" || data.results?.common?.errorCode === "E0006") throw new Error("LIMIT");
    if (data.results?.juso?.length > 0) return data.results.juso[0];
  } catch (e) {
    currentApiIdx = (currentApiIdx + 1) % JUSO_API_KEYS.length;
    return fetchJusoAPI(keyword, retryCount + 1);
  }
  return null;
};

// ============================================================================
// 🔥 3. 12단계 주소 정제 규칙 엔진 (동/호수 변환 강화 및 쉼표 삽입)
// ============================================================================
const processAddress = async (inputAddr, inputName = "") => {
  let result = { 정제된이름: inputName, 주소: "", 특이사항: "", 확인필요: false, 확인사유: "" };
  
  if (inputName && inputName.length > 4) {
    result.정제된이름 = inputName.substring(0, 4);
    result.특이사항 = `(본명:${inputName}) `;
  }

  if (!inputAddr || inputAddr.trim() === "") {
    result.확인필요 = true; result.확인사유 = "주소 공란";
    return result;
  }

  let text = inputAddr.replace(/부촌시/g, "부천시").replace(/만안그/g, "만안구");
  text = text.normalize('NFC').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').replace(/[　\xA0\t\n\r]/g, ' ').replace(/["']/g, '');

  let tokens = text.split(/\s+/).filter(Boolean);
  let newTokens = []; let stopRemoval = false;
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i], nextT = tokens[i + 1] || "";
    if (stopRemoval) { newTokens.push(t); continue; }
    let isRoad = /(로|길|대로)$/.test(t) || (/(로|길|대로)/.test(t) && /^\d/.test(nextT)) || /(로|길|대로)\d+/.test(t);
    let isJibun = /[가-힣\d]+(동|읍|면)$/.test(t) && nextT.match(/^\d+(?:-\d+)?/);
    if (isRoad || isJibun || /[가-힣\d]+(동|읍|면)\d+(?:-\d+)?/.test(t)) {
      stopRemoval = true; newTokens.push(t); continue;
    }
    let isRegion = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(t) ||
                   /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/.test(t) ||
                   /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주)$/.test(t);
    if (!isRegion) newTokens.push(t);
  }

  text = newTokens.join(' ').replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ');
  let parens = [];
  text = text.replace(/\(.*?\)/g, (m) => { parens.push(m); return `__PAREN${parens.length - 1}__`; });

  let commaIdx = text.indexOf(',');
  let mainAddr = commaIdx !== -1 ? text.substring(0, commaIdx) : text;
  let detailAddr = commaIdx !== -1 ? text.substring(commaIdx + 1) : "";
  mainAddr = mainAddr.replace(/\s{2,}/g, ' ').trim();

  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)/g, '$1 $3');
  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)/g, '$1 $3');

  if (!detailAddr && mainAddr.includes(' ')) {
    let parts = mainAddr.split(' ');
    let lastIsNum = /^\d/.test(parts[parts.length-1]);
    if(!lastIsNum && !parts[parts.length-1].includes('__PAREN')) {
        detailAddr = parts.pop();
        mainAddr = parts.join(' ');
    }
  }

  let searchKeyword = mainAddr.replace(/__PAREN\d+__/g, '').trim();
  
  let apiResult = apiCache.get(searchKeyword);
  if (!apiResult) {
    const dbCache = await getLocalCache(searchKeyword);
    if (dbCache) { apiResult = dbCache; apiCache.set(searchKeyword, apiResult); }
    else if (!/(로|길|대로)\s*\d+/.test(mainAddr) && searchKeyword.length >= 2) {
      const p = pendingRequests.has(searchKeyword) ? pendingRequests.get(searchKeyword) : fetchJusoAPI(searchKeyword);
      pendingRequests.set(searchKeyword, p);
      apiResult = await p;
      apiCache.set(searchKeyword, apiResult);
      if (apiResult) await setLocalCache(searchKeyword, apiResult);
      pendingRequests.delete(searchKeyword);
    }
  }

  let finalRoadAddr = mainAddr;
  if (apiResult) {
    finalRoadAddr = apiResult.roadAddrPart1 || mainAddr;
    if (apiResult.bdNm && !detailAddr.includes(apiResult.bdNm)) detailAddr = apiResult.bdNm + (detailAddr ? `, ${detailAddr}` : '');
  } else if (!/(로|길|대로)/.test(finalRoadAddr)) { 
    result.확인필요 = true; result.확인사유 = "도로명 미발견 및 API 변환 실패"; 
  }

  parens.forEach((p, i) => {
    finalRoadAddr = finalRoadAddr.replace(`__PAREN${i}__`, p);
    detailAddr = detailAddr.replace(`__PAREN${i}__`, p);
  });

  let finalDetail = detailAddr;
  if (parens.length > 0 && !finalRoadAddr.includes('(') && !finalDetail.includes('(')) {
     finalDetail += " " + parens.join(' ');
  }
  
  // 11단계 규칙 (보강됨): "00동 00층 00호" -> "00-  00호 00층" (층수 재배치 및 호수 패딩)
  finalDetail = finalDetail.replace(/([가-힣A-Za-z\d]+)동\s*(?:(지하|[Bb]|제)?\s*(\d+)\s*층)?\s*(?:제)?\s*(\d+)(?:호)?/g, (m, dong, floorPrefix, floorNum, ho) => {
    let padLength = Math.max(0, 4 - ho.length);
    let pad = " ".repeat(padLength);
    let floorStr = floorNum ? ` ${(floorPrefix || '')}${floorNum}층` : "";
    return `${dong}-${pad}${ho}호${floorStr}`;
  });

  let spMatch = finalDetail.match(/(\*\*|\/|☆|★|\*)(.*)/);
  if (spMatch) {
    result.특이사항 += spMatch[0];
    finalDetail = finalDetail.replace(spMatch[0], '').trim();
  }
  
  finalDetail = finalDetail.replace(/^[,\s]+|[,\s]+$/g, '');
  
  // 번지/도로명과 세부주소 사이 쉼표(,) 삽입 규칙 적용
  result.주소 = finalRoadAddr + (finalDetail ? ", " + finalDetail : "");

  if (result.주소.length < 3) {
      result.확인필요 = true;
      result.확인사유 = "변환 후 주소 비정상";
  }

  return result;
};

// ============================================================================
// 🔥 기타 파싱 엔진
// ============================================================================
const parsePhoneNumbers = (p1, p2) => {
  let str1 = String(p1 || '').replace(/[^\d]/g, '');
  let str2 = String(p2 || '').replace(/[^\d]/g, '');
  let mobile = ''; let landline = '';
  
  const isMobile = (s) => /^(010|011|016|017|018|019)/.test(s);
  const formatPhone = (s) => s.length === 11 ? s.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : (s.length === 10 ? s.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : s);

  [str1, str2].filter(Boolean).forEach(p => {
    if (isMobile(p) && !mobile) mobile = p;
    else if (!landline) landline = p;
  });

  return { mobile: formatPhone(mobile), landline: formatPhone(landline) };
};

const parseSMS = (val) => {
  return /^(0|ㅇ|o|O|Y|y|yes|YES)$/.test(String(val || '').trim()) ? 'Y' : 'N';
};

const parseBirthDate = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/[^\d]/g, '');
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
  } else if (digits.length === 8) {
    return `${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`; 
  }
  let str = String(val).trim();
  if (/^\d{2}[-./]\d{2}[-./]\d{2}$/.test(str)) {
    return str.replace(/[-/]/g, '.');
  }
  return str;
};

const KOREA_REGION_MAP = {
  "종로구": "서울특별시 종로구", "중구": "서울특별시 중구", "용산구": "서울특별시 용산구", "성동구": "서울특별시 성동구", "광진구": "서울특별시 광진구", "동대문구": "서울특별시 동대문구", "중랑구": "서울특별시 중랑구", "성북구": "서울특별시 성북구", "강북구": "서울특별시 강북구", "도봉구": "서울특별시 도봉구", "노원구": "서울특별시 노원구", "은평구": "서울특별시 은평구", "서대문구": "서울특별시 서대문구", "마포구": "서울특별시 마포구", "양천구": "서울특별시 양천구", "강서구": "서울특별시 강서구", "구로구": "서울특별시 구로구", "금천구": "서울특별시 금천구", "영등포구": "서울특별시 영등포구", "동작구": "서울특별시 동작구", "관악구": "서울특별시 관악구", "서초구": "서울특별시 서초구", "강남구": "서울특별시 강남구", "송파구": "서울특별시 송파구", "강동구": "서울특별시 강동구",
  "수원시": "경기도 수원시", "성남시": "경기도 성남시", "의정부시": "경기도 의정부시", "안양시": "경기도 안양시", "부천시": "경기도 부천시", "광명시": "경기도 광명시", "평택시": "경기도 평택시", "동두천시": "경기도 동두천시", "안산시": "경기도 안산시", "고양시": "경기도 고양시", "과천시": "경기도 과천시", "구리시": "경기도 구리시", "남양주시": "경기도 남양주시", "오산시": "경기도 오산시", "시흥시": "경기도 시흥시", "군포시": "경기도 군포시", "의왕시": "경기도 의왕시", "하남시": "경기도 하남시", "용인시": "경기도 용인시", "파주시": "경기도 파주시", "이천시": "경기도 이천시", "안성시": "경기도 안성시", "김포시": "경기도 김포시", "화성시": "경기도 화성시", "광주시": "경기도 광주시", "양주시": "경기도 양주시", "포천시": "경기도 포천시", "여주시": "경기도 여주시", "연천군": "경기도 연천군", "가평군": "경기도 가평군", "양평군": "경기도 양평군",
  "춘천시": "강원도 춘천시", "원주시": "강원도 원주시", "강릉시": "강원도 강릉시", "동해시": "강원도 동해시", "태백시": "강원도 태백시", "속초시": "강원도 속초시", "삼척시": "강원도 삼척시", "홍천군": "강원도 홍천군", "횡성군": "강원도 횡성군", "영월군": "강원도 영월군", "평창군": "강원도 평창군", "정선군": "강원도 정선군", "철원군": "강원도 철원군", "화천군": "강원도 화천군", "양구군": "강원도 양구군", "인제군": "강원도 인제군", "강원고성군": "강원도 고성군", "양양군": "강원도 양양군",
  "청주시": "충청북도 청주시", "충주시": "충청북도 충주시", "제천시": "충청북도 제천시", "보은군": "충청북도 보은군", "옥천군": "충청북도 옥천군", "영동군": "충청북도 영동군", "증평군": "충청북도 증평군", "진천군": "충청북도 진천군", "괴산군": "충청북도 괴산군", "음성군": "충청북도 음성군", "단양군": "충청북도 단양군",
  "천안시": "충청남도 천안시", "공주시": "충청남도 공주시", "보령시": "충청남도 보령시", "아산시": "충청남도 아산시", "서산시": "충청남도 서산시", "논산시": "충청남도 논산시", "계룡시": "충청남도 계룡시", "당진시": "충청남도 당진시", "금산군": "충청남도 금산군", "부여군": "충청남도 부여군", "서천군": "충청남도 서천군", "청양군": "충청남도 청양군", "홍성군": "충청남도 홍성군", "예산군": "충청남도 예산군", "태안군": "충청남도 태안군",
  "전주시": "전라북도 전주시", "군산시": "전라북도 군산시", "익산시": "전라북도 익산시", "정읍시": "전라북도 정읍시", "남원시": "전라북도 남원시", "김제시": "전라북도 김제시", "완주군": "전라북도 완주군", "진안군": "전라북도 진안군", "무주군": "전라북도 무주군", "장수군": "전라북도 장수군", "임실군": "전라북도 임실군", "순창군": "전라북도 순창군", "고창군": "전라북도 고창군", "부안군": "전라북도 부안군",
  "목포시": "전라남도 목포시", "여수시": "전라남도 여수시", "순천시": "전라남도 순천시", "나주시": "전라남도 나주시", "광양시": "전라남도 광양시", "담양군": "전라남도 담양군", "곡성군": "전라남도 곡성군", "구례군": "전라남도 구례군", "고흥군": "전라남도 고흥군", "보성군": "전라남도 보성군", "화순군": "전라남도 화순군", "장흥군": "전라남도 장흥군", "강진군": "전라남도 강진군", "해남군": "전라남도 해남군", "영암군": "전라남도 영암군", "무안군": "전라남도 무안군", "함평군": "전라남도 함평군", "영광군": "전라남도 영광군", "장성군": "전라남도 장성군", "완도군": "전라남도 완도군", "진도군": "전라남도 진도군", "신안군": "전라남도 신안군",
  "포항시": "경상북도 포항시", "경주시": "경상북도 경주시", "김천시": "경상북도 김천시", "안동시": "경상북도 안동시", "구미시": "경상북도 구미시", "영주시": "경상북도 영주시", "영천시": "경상북도 영천시", "상주시": "경상북도 상주시", "문경시": "경상북도 문경시", "경산시": "경상북도 경산시", "군위군": "경상북도 군위군", "의성군": "경상북도 의성군", "청송군": "경상북도 청송군", "영양군": "경상북도 영양군", "영덕군": "경상북도 영덕군", "청도군": "경상북도 청도군", "고령군": "경상북도 고령군", "성주군": "경상북도 성주군", "칠곡군": "경상북도 칠곡군", "예천군": "경상북도 예천군", "봉화군": "경상북도 봉화군", "울진군": "경상북도 울진군", "울릉군": "경상북도 울릉군",
  "창원시": "경상남도 창원시", "진주시": "경상남도 진주시", "통영시": "경상남도 통영시", "사천시": "경상남도 사천시", "김해시": "경상남도 김해시", "밀양시": "경상남도 밀양시", "거제시": "경상남도 거제시", "양산시": "경상남도 양산시", "의령군": "경상남도 의령군", "함안군": "경상남도 함안군", "창녕군": "경상남도 창녕군", "경남고성군": "경상남도 고성군", "남해군": "경상남도 남해군", "하동군": "경상남도 하동군", "산청군": "경상남도 산청군", "함양군": "경상남도 함양군", "거창군": "경상남도 거창군", "합천군": "경상남도 합천군",
  "제주시": "제주특별자치도 제주시", "서귀포시": "제주특별자치도 서귀포시"
};

const extractCityName = (fileName, rawJsonArray) => {
  const targetText = (fileName + " " + rawJsonArray.slice(0, 30).map(r => r.join(' ')).join(' '));
  for (const [key, value] of Object.entries(KOREA_REGION_MAP)) {
    if (targetText.includes(key)) return value; 
  }
  for (const value of Object.values(KOREA_REGION_MAP)) {
    if (targetText.includes(value)) return value;
  }
  return ""; 
};

// ============================================================================
// 🔥 4. MAIN APP COMPONENT
// ============================================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('checking'); 
  const [step, setStep] = useState(1);
  const [authLoading, setAuthLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false); 

  const [meta, setMeta] = useState({ city: '', month: '' });
  const [worksheets, setWorksheets] = useState([]);
  const [rawHeaders, setRawHeaders] = useState([]);
  const [previewData, setPreviewData] = useState([]); 
  
  const [mapDef, setMapDef] = useState({ name: '', birth: '', contact1: '', contact2: '', address: '', qty: '', admin: '', note: '', sms: '' });
  const [gridData, setGridData] = useState([]);
  const [progress, setProgress] = useState({ percent: 0, desc: '' });
  const [filter, setFilter] = useState('ALL'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/png'; link.href = 'ttongpa.png';
    document.title = "웰쉐어 명단 정제System";
    initDB().catch(console.error);

    const unsub = onAuthStateChanged(auth, u => { 
      setUser(u); 
      setAuthStatus(u ? 'admin' : 'unauthenticated'); 
    });
    return () => unsub();
  }, []);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      await setDoc(doc(db, "users", res.user.uid), {
        email: res.user.email,
        name: res.user.displayName,
        status: 'pending',
        lastLogin: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      alert("로그인 중 오류가 발생했습니다: " + err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setStep(1); setGridData([]); setWorksheets([]); setShowAdmin(false);
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); handleFileUpload(e); };

  const handleFileUpload = async (e) => {
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    if (e.target) e.target.value = ''; // 동일 파일 재업로드 버그 차단

    setStep(2); 
    const monthMatch = file.name.match(/(\d+)월/);
    
    try {
      const XLSX = await loadSheetJS();
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      
      let allRawData = []; 
      
      const sheetsData = wb.SheetNames.map(name => {
        const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
        allRawData = allRawData.concat(rawJson.slice(0, 30)); 
        
        let type = '제외';
        if (name.includes('수급') || name.includes('의료') || name.includes('생계')) type = '수급자';
        else if (name.includes('차상위')) type = '차상위';
        else type = '수급자'; 

        let selected = type !== '제외';
        let headerIdx = 0;
        for (let i=0; i<Math.min(10, rawJson.length); i++) {
          if (rawJson[i].filter(c => String(c).trim() !== "").length > 3) { headerIdx = i; break; }
        }
        
        const headers = rawJson[headerIdx]?.map((h, i) => h ? String(h).trim() : `col_${i}`) || [];
        const bodyRows = rawJson.slice(headerIdx + 1).filter(r => r.some(c => c));
        const amtIdx = headers.findIndex(h => h.includes('포수') || h.includes('수량'));
        let qty = 0;
        bodyRows.forEach(row => { qty += (parseInt(row[amtIdx] || 0) || 1); });

        return { name, selected, type, qty, rowsCount: bodyRows.length, headers, bodyRows };
      });

      const detectedCity = extractCityName(file.name, allRawData);
      allRawData = null; // 메모리 릭(Leak) 차단을 위한 강제 GC 유도

      setMeta({ city: detectedCity, month: monthMatch ? `${monthMatch[1]}월` : '' });
      setWorksheets(sheetsData);

    } catch (err) {
      alert("파일 분석 중 오류가 발생했습니다.");
      setStep(1);
    }
  };

  const handleSheetUpdate = (index, field, value) => {
    setWorksheets(prev => {
      const newWs = [...prev];
      newWs[index] = { ...newWs[index], [field]: value };
      if (field === 'type' && value === '제외') newWs[index].selected = false;
      if (field === 'selected' && !value) newWs[index].type = '제외';
      return newWs;
    });
  };

  const proceedToMapping = () => {
    if (!meta.city || meta.city.trim() === '') {
      return alert("지자체 정보가 없습니다. 상단 입력란에 지자체(시/군/구)를 필수 입력해야 진행 가능합니다.");
    }

    const selectedSheets = worksheets.filter(s => s.selected);
    if (selectedSheets.length === 0) return alert("처리할 시트를 1개 이상 선택해주세요.");

    const primaryHeaders = selectedSheets[0].headers;
    setRawHeaders(primaryHeaders);

    let autoMap = { name: '', birth: '', contact1: '', contact2: '', address: '', qty: '', admin: '', note: '', sms: '' };
    primaryHeaders.forEach(h => {
      if (h.includes('이름') || h.includes('성명') || h.includes('대상자')) autoMap.name = h;
      else if (h.includes('생년월일') || h.includes('생년') || h.includes('주민번호') || h.includes('주민')) autoMap.birth = h;
      else if (h.includes('휴대') || (h.includes('연락') && !autoMap.contact1)) autoMap.contact1 = h;
      else if (h.includes('유선') || h.includes('전화') || (h.includes('연락') && autoMap.contact1)) autoMap.contact2 = h;
      else if (h.includes('주소')) autoMap.address = h;
      else if (h.includes('포수') || h.includes('수량')) autoMap.qty = h;
      else if (h.includes('행정동') || h.includes('읍면동')) autoMap.admin = h;
      else if (h.includes('특이') || h.includes('비고')) autoMap.note = h;
      else if (h.includes('문자') || h.includes('수신')) autoMap.sms = h;
    });
    setMapDef(autoMap);

    let preview = [];
    for (const sheet of selectedSheets) {
      const objRows = sheet.bodyRows.slice(0, 20).map(row => {
        let obj = { _sheetType: sheet.type, _sheetName: sheet.name };
        sheet.headers.forEach((h, j) => obj[h] = row[j]);
        return obj;
      });
      preview.push(...objRows);
      if (preview.length >= 20) break;
    }
    setPreviewData(preview.slice(0, 20));
    setStep(3);
  };

  const startProcessing = async () => {
    if (!mapDef.name || !mapDef.address || !mapDef.qty || !mapDef.contact1 || !mapDef.admin) {
      return alert("이름, 연락처, 주소, 포수, 행정동은 필수 매핑 항목입니다.");
    }
    setStep(4);
    setProgress({ percent: 10, desc: '주소 정제 엔진 가동 중...' });

    let processed = [];
    const selectedSheets = worksheets.filter(s => s.selected);

    for (const sheet of selectedSheets) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < sheet.bodyRows.length; i += CHUNK_SIZE) {
        const chunk = sheet.bodyRows.slice(i, i + CHUNK_SIZE);
        const chunkResults = await asyncPool(20, chunk, async (row) => {
          try {
            const rowObj = {};
            sheet.headers.forEach((h, j) => rowObj[h] = row[j]);

            const rawAddr = String(rowObj[mapDef.address] || "");
            const rawName = String(rowObj[mapDef.name] || "");
            const qty = parseInt(rowObj[mapDef.qty] || 0) || 1;
            
            const engineResult = await processAddress(rawAddr, rawName);
            const phones = parsePhoneNumbers(rowObj[mapDef.contact1], rowObj[mapDef.contact2]);
            const smsOpt = parseSMS(rowObj[mapDef.sms]);
            const birth = parseBirthDate(rowObj[mapDef.birth]);

            let extraNote = String(rowObj[mapDef.note] || '');
            if (extraNote) engineResult.특이사항 = engineResult.특이사항 ? `${engineResult.특이사항} / ${extraNote}` : extraNote;

            return {
              id: window.crypto.randomUUID(), 
              구분: sheet.type, 행정동: rowObj[mapDef.admin] || '-',
              이름: engineResult.정제된이름, 
              생년월일: birth, 
              포수: qty, 휴대폰: phones.mobile, 유선전화: phones.landline,
              주소: engineResult.주소, 문자수신: smsOpt,
              특이사항: engineResult.특이사항, _에러: engineResult.확인필요, _사유: engineResult.확인사유
            };
          } catch (e) {
            return {
              id: window.crypto.randomUUID(),
              구분: sheet.type, 행정동: '-', 이름: '파싱오류', 생년월일: '', 포수: 1, 휴대폰: '', 유선전화: '',
              주소: '', 문자수신: 'N', 특이사항: '엔진처리 실패', _에러: true, _사유: e.message
            };
          }
        });

        processed.push(...chunkResults);
        setProgress({ percent: 20 + Math.floor((processed.length / 5000) * 70), desc: `표준화 및 12단계 정제 중... (${processed.length.toLocaleString()}행 완료)` });
        await new Promise(r => requestAnimationFrame(r));
      }
    }
    setGridData(processed);
    setProgress({ percent: 100, desc: '정제 및 표준화 완료!' });
    setTimeout(() => setStep(5), 500);
  };

  const filteredData = useMemo(() => {
    let data = [...gridData];
    if (filter === 'ERROR') data = data.filter(d => d._에러);
    if (filter === 'SUCCESS') data = data.filter(d => !d._에러);
    
    data.sort((a, b) => {
      let cmp = a.행정동.localeCompare(b.행정동);
      if (cmp !== 0) return cmp;
      cmp = a.주소.localeCompare(b.주소);
      if (cmp !== 0) return cmp;
      cmp = a.이름.localeCompare(b.이름);
      if (cmp !== 0) return cmp;
      return a.포수 - b.포수; 
    });
    return data;
  }, [gridData, filter]);

  const handleExport = async () => {
    setProgress({ percent: 10, desc: '백그라운드 워커에서 엑셀 패키징 중...' });
    setStep(4); 
    
    const workerBlob = new Blob([`
      importScripts("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      self.onmessage = function(e) {
        try {
          const { finalRows, exportCols, fileName } = e.data;
          const ws = self.XLSX.utils.json_to_sheet(finalRows, { header: exportCols });
          const wb = self.XLSX.utils.book_new();
          self.XLSX.utils.book_append_sheet(wb, ws, "최종 표준 명단");
          const wbout = self.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          self.postMessage({ success: true, wbout, fileName });
        } catch (error) {
          self.postMessage({ success: false, error: error.message });
        }
      };
    `], { type: 'application/javascript' });

    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl);

    worker.onmessage = (e) => {
      URL.revokeObjectURL(workerUrl);
      if (e.data.success) {
        const blob = new Blob([e.data.wbout], { type: "application/octet-stream" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = e.data.fileName;
        link.click();
        setStep(5);
      } else {
        alert("다운로드 중 오류가 발생했습니다.");
        setStep(5);
      }
      worker.terminate();
    };

    const exportCols = ['NO', '구분', '행정동', '이름', '생년월일', '포수', '휴대폰', '유선전화', '주소', '특이사항', '사유'];
    
    const finalRows = filteredData.map((r, i) => ({
      'NO': i + 1, '구분': r.구분, '행정동': r.행정동, '이름': r.이름, '생년월일': r.생년월일, '포수': r.포수, '휴대폰': r.휴대폰,
      '유선전화': r.유선전화, '주소': r.주소, '특이사항': r.특이사항, '사유': r._에러 ? r._사유 : '정상'
    }));

    const now = new Date();
    const mmdd = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const timeSeq = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
    const fileName = `[정제완료]_${meta.city || '미상'}_${meta.month || '미상'}_${mmdd}_${timeSeq}.xlsx`;

    worker.postMessage({ finalRows, exportCols, fileName });
  };

  const handleCellEdit = (id, field, value) => {
    setGridData(prev => prev.map(row => row.id === id ? { ...row, [field]: value, _에러: field === '주소' && value.length >= 3 ? false : row._에러 } : row));
  };

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage]);

  const suCount = worksheets.filter(s => s.selected && s.type === '수급자').reduce((a, b) => a + b.qty, 0);
  const chaCount = worksheets.filter(s => s.selected && s.type === '차상위').reduce((a, b) => a + b.qty, 0);
  const totalCount = suCount + chaCount;

  // ============================================================================
  // 🔥 AUTH (Google Login) VIEW
  // ============================================================================
  if (authStatus === 'checking') {
    return <div className="h-screen w-full bg-black flex items-center justify-center animate-pulse"><img src="ttlogo.jpg" className="w-20 h-20 rounded-full shadow-[0_0_30px_rgba(212,175,55,0.5)]" alt="Loading"/></div>;
  }

  if (authStatus === 'unauthenticated') {
    return (
      <div className="h-screen w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1710] via-[#050505] to-black flex items-center justify-center p-4">
        <div className="w-full max-w-md relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#d4af37] via-[#f3e5ab] to-[#8b6508] rounded-3xl blur opacity-30 animate-pulse"></div>
          
          <div className="relative bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] p-10 flex flex-col items-center">
            <img src="ttlogo.jpg" alt="NEXUS Logo" className="w-32 h-32 rounded-full border-4 border-[#d4af37]/80 shadow-[0_0_30px_rgba(212,175,55,0.8)] mb-6" onError={(e) => e.target.style.display='none'} />
            
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#d4af37] via-[#f3e5ab] to-[#8b6508] mb-2 tracking-tighter">NEXUS CORE</h1>
            <p className="text-gray-400 text-sm font-medium mb-10">지자체 명단 정제 및 표준화 시스템</p>

            <button onClick={handleGoogleLogin} disabled={authLoading} className="w-full py-4 bg-[#d4af37] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(212,175,55,0.5)] hover:bg-[#f3e5ab] hover:scale-105 transition-all flex items-center justify-center gap-3 text-base">
              <svg className="w-6 h-6" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>
              {authLoading ? '로그인 처리 중...' : 'Google 계정으로 접속/신청'}
            </button>
            <p className="mt-6 text-gray-500 text-xs text-center">최초 접속 시 자동 승인 신청되며, 관리자의 수락 후 사용할 수 있습니다.</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 🔥 PIPELINE VIEWS (Step 1 ~ 5 & Admin Console)
  // ============================================================================
  return (
    <div className="h-screen w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1710] via-[#050505] to-black text-gray-200 font-sans selection:bg-[#d4af37]/40 flex flex-col text-[13px]">
      
      {showAdmin && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[100] flex flex-col p-6 animate-fade-in">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black text-[#d4af37] flex items-center gap-3"><ShieldCheck size={28}/> 관리자 통합 콘솔</h2>
            <button onClick={() => setShowAdmin(false)} className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 font-bold border border-gray-600 transition-colors">닫기 (메인으로)</button>
          </div>
          <div className="flex gap-4 border-b border-gray-800 pb-4">
            {['사용자 권한', 'API 키 모니터링', 'AI 패턴 학습', '글로벌 시설명 DB', '커스텀 룰 (오타사전)', '보안 감사 로그'].map(tab => (
              <button key={tab} className="px-5 py-2.5 rounded-lg bg-[#111] text-gray-400 hover:text-[#d4af37] hover:bg-[#1a1710] border border-[#333] transition-all font-bold focus:ring-1 focus:ring-[#d4af37]">{tab}</button>
            ))}
          </div>
          <div className="flex-1 mt-6 border border-gray-800 rounded-xl bg-[#0a0a0a] flex items-center justify-center text-gray-500 flex-col gap-4">
            <Activity size={48} className="text-[#333]"/>
            <p className="text-lg font-bold">현재 연결된 파이어베이스 인스턴스에서 데이터를 불러오는 중입니다...</p>
            <p className="text-xs">v32.0 기획에 맞춘 6개 탭 구조 스켈레톤입니다. (실제 DB 연동 모듈 로딩 대기)</p>
          </div>
        </div>
      )}

      <header className="bg-black/40 backdrop-blur-xl border-b border-white/10 px-6 py-3 flex items-center justify-between shrink-0 h-16 z-50 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center space-x-6">
          <div className="text-2xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#d4af37] via-[#f3e5ab] to-[#8b6508] pr-6 border-r border-white/10 flex items-center gap-3 drop-shadow-[0_2px_10px_rgba(212,175,55,0.4)]">
            <img src="ttlogo.jpg" alt="Logo" className="w-10 h-10 rounded-full border-2 border-[#d4af37]/80 shadow-[0_0_15px_rgba(212,175,55,0.6)]" onError={(e) => e.target.style.display='none'} />
            NEXUS CORE
          </div>
          
          {step >= 2 && (
            <div className="flex space-x-3 font-mono items-center">
              <div className={`px-3 py-1 bg-black/60 border ${!meta.city ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-[#d4af37]/40'} text-[#d4af37] rounded-lg shadow-inner flex gap-2 items-center transition-all`}>
                📍 <input value={meta.city} onChange={(e)=>setMeta({...meta, city: e.target.value})} className="bg-transparent w-36 outline-none font-bold placeholder-red-400" placeholder="지자체 필수입력"/>
              </div>
              <span className="px-3 py-1 bg-black/60 border border-white/10 text-gray-300 rounded-lg shadow-inner flex gap-2 items-center">📅 <input value={meta.month} onChange={(e)=>setMeta({...meta, month: e.target.value})} className="bg-transparent w-12 outline-none font-bold placeholder-gray-600" placeholder="월"/></span>
              <span className="px-4 py-1 bg-gradient-to-r from-[#1a1710] to-black border border-[#d4af37]/30 text-gray-300 rounded-lg flex space-x-4 ml-2 shadow-[0_0_15px_rgba(212,175,55,0.15)]">
                <span className="text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]">수급자: <b className="text-white">{suCount.toLocaleString()}</b>포</span>
                <span className="text-purple-400 drop-shadow-[0_0_5px_rgba(192,132,252,0.5)]">차상위: <b className="text-white">{chaCount.toLocaleString()}</b>포</span>
                <span className="text-[#d4af37] font-black border-l border-white/10 pl-4 drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]">총계: {totalCount.toLocaleString()}포</span>
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-4 text-sm">
          <button onClick={() => setShowAdmin(true)} className="text-[#d4af37] hover:text-white flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors border border-transparent hover:border-white/20">
            <Settings size={16}/> 관리자
          </button>
          <div className="h-6 w-px bg-white/10 mx-1"></div>
          <span className="text-[#d4af37] bg-black/80 px-4 py-1.5 rounded-full border border-[#d4af37]/50 flex items-center gap-2 font-black shadow-[0_0_20px_rgba(212,175,55,0.3)] backdrop-blur-md">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"></span> 
            {step === 1 ? '1단계: 데이터 인입' : step === 2 ? '2단계: 시트 프로파일링' : step === 3 ? '3단계: AI 매핑' : step === 4 ? '12단계 엔진 가동 중...' : '최종 검수 및 추출'}
          </span>
          <div className="h-6 w-px bg-white/10 mx-2"></div>
          <button onClick={handleLogout} className="text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1 font-bold" title="로그아웃">
            <LogOut size={16}/>
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden flex flex-col p-6 z-10">
        
        {/* STEP 1: Upload */}
        {step === 1 && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-2xl relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#d4af37] via-[#f3e5ab] to-[#8b6508] rounded-[2.5rem] blur opacity-20 group-hover:opacity-70 transition duration-1000 animate-pulse"></div>
              <label onDragOver={handleDragOver} onDrop={handleDrop} className="relative flex flex-col items-center py-20 px-12 bg-[#0a0a0a]/80 backdrop-blur-xl border-2 border-dashed border-[#d4af37]/40 hover:border-[#d4af37] hover:bg-[#111]/90 rounded-[2rem] cursor-pointer shadow-[0_10px_40px_rgba(0,0,0,0.8)] transform group-hover:-translate-y-2 transition-all duration-300">
                <img src="ttlogo.jpg" alt="Logo" className="w-24 h-24 rounded-full border-4 border-[#d4af37]/50 shadow-[0_0_20px_rgba(212,175,55,0.8)] mb-6 drop-shadow-2xl" onError={(e) => e.target.style.display='none'} />
                <h3 className="text-3xl font-black text-white mb-3 tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">명단 엑셀 드롭</h3>
                <p className="text-gray-400 text-center text-base font-medium leading-relaxed">파일을 드래그하거나 클릭하여 업로드하면<br/>시트 분석 및 지자체 추론이 시작됩니다.</p>
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => { handleFileUpload(e); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        )}

        {/* STEP 2: Sheet Analysis */}
        {step === 2 && (
          <div className="flex flex-col h-full bg-[#0a0a0a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] max-w-6xl mx-auto w-full overflow-hidden">
            <div className="bg-gradient-to-b from-[#1a1710] to-[#0a0a0a] px-8 py-5 border-b border-[#333] flex justify-between items-center shrink-0 shadow-lg">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3 drop-shadow-md"><FileSpreadsheet size={24} className="text-[#d4af37]"/> 2단계: 워크시트 분류</h2>
                <p className="text-gray-400 mt-1.5 font-medium">처리할 대상을 켜고 분류(수급/차상위)를 확인하세요.</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="px-6 py-3 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-xl hover:bg-gray-700 transition-all shadow-md flex items-center gap-2">
                  <ChevronLeft size={18} strokeWidth={3}/> 업로드로 돌아가기
                </button>
                <button onClick={proceedToMapping} className="px-8 py-3 bg-[#d4af37] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(212,175,55,0.6)] hover:bg-[#f3e5ab] hover:scale-105 transition-all flex items-center gap-2 uppercase tracking-wide">
                  컬럼 매핑 진행 <ArrowRight size={18} strokeWidth={3}/>
                </button>
              </div>
            </div>

            {!meta.city && (
              <div className="bg-red-950/80 border-b border-red-500/50 px-8 py-3 flex items-center gap-3 text-red-400 font-bold shadow-inner">
                <AlertTriangle className="animate-pulse" size={18}/>
                <span>엑셀 파일 및 내부 데이터에서 지자체 정보가 검출되지 않았습니다. 상단 입력란에 필수 입력해주세요.</span>
              </div>
            )}

            <div className="flex-1 overflow-auto p-8 scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent">
              <div className="border border-white/10 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.5)] bg-black/40">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-[#111] border-b border-[#333] text-[#d4af37] font-extrabold text-sm tracking-wide">
                    <tr>
                      <th className="px-6 py-4 w-20 text-center">선택</th>
                      <th className="px-6 py-4">엑셀 시트명</th>
                      <th className="px-6 py-4 text-center">유효 행 개수</th>
                      <th className="px-6 py-4">분류 매칭</th>
                      <th className="px-6 py-4 text-right">예상 포수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-200 text-sm">
                    {worksheets.map((ws, idx) => (
                      <tr key={idx} className={`transition-all duration-200 ${ws.selected ? 'hover:bg-[#1a1710]/50' : 'opacity-40 bg-black'}`}>
                        <td className="px-6 py-4 text-center">
                          <input type="checkbox" checked={ws.selected} onChange={(e) => handleSheetUpdate(idx, 'selected', e.target.checked)} className="w-5 h-5 accent-[#d4af37] cursor-pointer"/>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-white text-base">{ws.name}</td>
                        <td className="px-6 py-4 text-center font-mono text-gray-400 bg-black/20">{ws.rowsCount.toLocaleString()} 행</td>
                        <td className="px-6 py-4">
                          <select value={ws.type} onChange={(e) => handleSheetUpdate(idx, 'type', e.target.value)} disabled={!ws.selected} className="bg-[#111] border border-[#444] text-white px-4 py-2 rounded-lg outline-none focus:border-[#d4af37] font-bold">
                            <option value="수급자">수급자</option>
                            <option value="차상위">차상위</option>
                            <option value="제외">🚫 제외</option>
                          </select>
                        </td>
                        <td className="px-6 py-4 text-right font-black text-[#d4af37] text-base">{ws.qty.toLocaleString()} 포</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Mapping */}
        {step === 3 && (
          <div className="flex flex-col h-full bg-[#0a0a0a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="bg-gradient-to-b from-[#1a1710] to-[#0a0a0a] px-6 py-4 border-b border-[#333] flex justify-between items-center shrink-0 shadow-lg">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3 drop-shadow-md"><Columns size={24} className="text-[#d4af37]"/> 3단계: AI 헤더 매핑</h2>
                <p className="text-gray-400 mt-1.5 font-medium">자동 매핑을 확인하고 누락된 항목을 지정하세요.</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setStep(2)} className="px-6 py-3 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-xl hover:bg-gray-700 transition-all shadow-md flex items-center gap-2">
                  <ChevronLeft size={18} strokeWidth={3}/> 시트 선택으로
                </button>
                <button onClick={startProcessing} className="px-8 py-3 bg-[#d4af37] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(212,175,55,0.6)] hover:bg-[#f3e5ab] hover:scale-105 transition-all flex items-center gap-2 uppercase tracking-wide">
                  12단계 정제 가동 <Database size={18} strokeWidth={3}/>
                </button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div className="w-80 bg-black/40 border-r border-white/10 p-6 overflow-y-auto shrink-0 scrollbar-thin scrollbar-thumb-[#444]">
                <h3 className="text-white font-black mb-5 border-b border-white/10 pb-3 tracking-wide">필수 표준 항목 <span className="text-red-500 drop-shadow-[0_0_5px_red]">*</span></h3>
                {['name|성명 (이름)', 'contact1|연락처 (휴대폰 우선)', 'address|원본 주소', 'qty|수량 (포수)', 'admin|행정구역 (읍면동)'].map(pair => {
                  const [key, label] = pair.split('|');
                  return (
                    <div key={key} className="mb-5 group">
                      <label className="block text-gray-400 mb-1.5 text-xs font-bold group-hover:text-[#d4af37] transition-colors">{label}</label>
                      <select value={mapDef[key]} onChange={(e) => setMapDef({...mapDef, [key]: e.target.value})} className="w-full bg-[#111] border border-[#444] text-[#d4af37] font-black p-2.5 rounded-lg outline-none shadow-inner cursor-pointer">
                        <option value="">-- 매핑 유실됨 --</option>
                        {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  );
                })}

                <h3 className="text-gray-300 font-bold mb-4 mt-10 border-b border-white/10 pb-3 tracking-wide">보조 매핑 항목</h3>
                {['contact2|보조 연락처 (유선전화 등)', 'birth|생년월일 (YY.MM.DD 자동변환)', 'note|원본 특이사항', 'sms|문자수신 여부'].map(pair => {
                  const [key, label] = pair.split('|');
                  return (
                    <div key={key} className="mb-5 group">
                      <label className="block text-gray-500 mb-1.5 text-xs font-bold group-hover:text-gray-300 transition-colors">{label}</label>
                      <select value={mapDef[key]} onChange={(e) => setMapDef({...mapDef, [key]: e.target.value})} className="w-full bg-black border border-[#333] text-gray-300 p-2.5 rounded-lg outline-none shadow-inner cursor-pointer">
                        <option value="">-- 자동파싱 / 사용안함 --</option>
                        {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex-1 overflow-auto relative bg-[#050505] scrollbar-thin scrollbar-thumb-[#444]">
                <table className="w-full text-left whitespace-nowrap border-collapse">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      {rawHeaders.map(h => (
                        <th key={h} className={`px-5 py-3 border-r border-[#222] font-bold text-sm sticky top-0 ${Object.values(mapDef).includes(h) ? 'bg-[#1a1710] text-[#d4af37] border-b-2 border-b-[#d4af37]' : 'bg-[#0a0a0a] text-gray-600'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {previewData.map((row, idx) => (
                      <tr key={idx} className="border-b border-[#1a1a1a] hover:bg-[#1a1710]/40 transition-colors">
                        {rawHeaders.map(h => (
                          <td key={h} className={`px-5 py-2.5 border-r border-[#222] max-w-[200px] truncate ${Object.values(mapDef).includes(h) ? 'text-gray-200' : 'text-gray-600'}`}>{String(row[h] || '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Loading */}
        {step === 4 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-xl z-50 p-4">
            <div className="w-[30rem] p-10 bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-[0_0_80px_rgba(212,175,55,0.2)] flex flex-col items-center">
              <Database size={64} className="text-[#d4af37] mb-8 animate-bounce drop-shadow-[0_0_20px_rgba(212,175,55,1)]"/>
              <div className="flex justify-between w-full text-sm mb-3 font-mono">
                <span className="text-[#d4af37] font-black tracking-widest">NEXUS ADDRESS ENGINE</span>
                <span className="text-white font-bold">{progress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-black rounded-full overflow-hidden mb-5 border border-white/10 shadow-inner">
                <div className="h-full bg-gradient-to-r from-[#8b6508] via-[#d4af37] to-[#f3e5ab] transition-all duration-300" style={{width: `${progress.percent}%`}}></div>
              </div>
              <p className="text-center text-gray-400 text-sm font-bold">{progress.desc}</p>
            </div>
          </div>
        )}

        {/* STEP 5: Final Review */}
        {step === 5 && (
          <div className="flex flex-col h-full bg-[#0a0a0a]/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#333] bg-gradient-to-r from-[#111] to-[#050505] shrink-0">
              <div className="flex space-x-2 bg-black/50 p-1 rounded-lg border border-white/5">
                <button onClick={() => setFilter('ALL')} className={`px-5 py-2 text-xs rounded-md transition-all ${filter==='ALL' ? 'bg-[#222] border border-[#d4af37] text-[#d4af37] font-black shadow-[0_0_10px_rgba(212,175,55,0.2)]' : 'text-gray-400 hover:text-white'}`}>전체보기 ({gridData.length.toLocaleString()})</button>
                <button onClick={() => setFilter('ERROR')} className={`px-5 py-2 text-xs rounded-md flex items-center gap-1.5 transition-all ${filter==='ERROR' ? 'bg-red-950/50 border border-red-500 text-red-400 font-black shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'text-gray-400 hover:text-white'}`}><AlertTriangle size={14}/> 확인필요 ({gridData.filter(d=>d._에러).length.toLocaleString()})</button>
                <button onClick={() => setFilter('SUCCESS')} className={`px-5 py-2 text-xs rounded-md flex items-center gap-1.5 transition-all ${filter==='SUCCESS' ? 'bg-green-950/50 border border-green-500 text-green-400 font-black shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'text-gray-400 hover:text-white'}`}><CheckCircle size={14}/> 정제완료 ({gridData.filter(d=>!d._에러).length.toLocaleString()})</button>
              </div>
              
              <div className="flex items-center space-x-5">
                <button onClick={() => setStep(3)} className="px-5 py-2 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-lg hover:bg-gray-700 transition-all shadow-md flex items-center gap-2 text-xs">
                  <ChevronLeft size={16} strokeWidth={3}/> 매핑으로 돌아가기
                </button>
                <div className="flex items-center space-x-3 text-xs text-gray-300 bg-black/60 px-4 py-1.5 rounded-lg border border-white/10 shadow-inner">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="hover:text-[#d4af37] disabled:opacity-20 transition-colors"><ChevronLeft size={16}/></button>
                  <span className="font-mono font-bold">{currentPage} / {Math.ceil(filteredData.length / itemsPerPage) || 1} PAGE</span>
                  <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredData.length / itemsPerPage), p + 1))} disabled={currentPage === Math.ceil(filteredData.length / itemsPerPage) || filteredData.length===0} className="hover:text-[#d4af37] disabled:opacity-20 transition-colors"><ChevronRight size={16}/></button>
                </div>
                <button onClick={handleExport} className="px-8 py-3 bg-[#d4af37] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(212,175,55,0.6)] hover:bg-[#f3e5ab] hover:scale-105 transition-all flex items-center gap-2 uppercase tracking-tight text-xs">
                  <Download size={16} strokeWidth={2.5}/> 표준 명단 패키징
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-[#555] scrollbar-track-black/50">
              <table className="w-full text-left text-[12px] whitespace-nowrap border-collapse">
                <thead className="sticky top-0 bg-[#0a0a0a] z-20 text-gray-400 shadow-[0_5px_15px_rgba(0,0,0,0.8)] border-b-2 border-[#333]">
                  <tr>
                    {['NO', '구분', '행정구역', '성명', '생년월일', '포수', '메인(휴대폰)', '보조(유선)', '통합 주소 (클릭하여 텍스트 직접 수정)', '특이사항 / 비고', '오류 사유'].map((h, i) => (
                      <th key={h} className={`px-4 py-3 font-bold border-r border-[#222] tracking-wide ${i === 0 ? 'text-center sticky left-0 bg-[#0a0a0a] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)]' : ''} ${h.includes('주소') ? 'text-[#d4af37] bg-gradient-to-b from-[#1a1710] to-[#0a0a0a] text-sm min-w-[400px]' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono text-gray-200">
                  {paginatedData.map((row, idx) => (
                    <tr key={row.id} className={`border-b border-[#222] group h-10 transition-colors ${row._에러 ? 'bg-red-950/20 hover:bg-red-900/40' : 'bg-transparent hover:bg-[#1a1710]/60'}`}>
                      <td className={`px-4 py-1.5 border-r border-[#222] text-center sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] font-bold ${row._에러 ? 'bg-[#1a0505] text-red-400 border-l-4 border-l-red-500' : 'bg-[#0a0a0a] group-hover:bg-[#15120d] text-gray-500'}`}>
                        {((currentPage - 1) * itemsPerPage + idx + 1).toLocaleString()}
                      </td>
                      <td className="px-4 py-1.5 border-r border-[#222] text-center"><span className={`px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest shadow-inner ${row.구분==='수급자'?'bg-blue-900/40 text-blue-300 border border-blue-700/50':'bg-purple-900/40 text-purple-300 border border-purple-700/50'}`}>{row.구분}</span></td>
                      <td className="px-4 py-1.5 border-r border-[#222] max-w-[120px] truncate text-gray-400">{row.행정동}</td>
                      <td className="px-4 py-1.5 border-r border-[#222] font-black text-white text-[13px] drop-shadow-md">{row.이름}</td>
                      <td className="px-4 py-1.5 border-r border-[#222] text-center text-gray-300 font-mono tracking-wider">{row.생년월일}</td>
                      <td className="px-4 py-1.5 border-r border-[#222] text-center text-[#d4af37] font-black bg-black/20">{Number(row.포수).toLocaleString()}</td>
                      <td className="px-4 py-1.5 border-r border-[#222] text-green-400 font-bold tracking-wider">{row.휴대폰}</td>
                      <td className="px-4 py-1.5 border-r border-[#222] text-gray-500 tracking-wider">{row.유선전화}</td>
                      
                      <td className="px-1 py-1 border-r border-l-2 border-l-[#d4af37]/50 border-r-[#222] relative bg-black/40 group-hover:bg-black/60 transition-colors">
                        <input className={`w-full h-full bg-transparent px-3 py-1.5 rounded outline-none focus:bg-[#1a1710] focus:ring-2 focus:ring-[#d4af37] shadow-inner font-bold transition-all ${row._에러 ? 'text-red-400 placeholder-red-800' : 'text-[#d4af37]'}`} value={row.주소} onChange={(e) => handleCellEdit(row.id, '주소', e.target.value)} title={row._에러 ? `[오류사유] ${row._사유}` : ''} placeholder="주소가 비어있습니다."/>
                      </td>
                      
                      <td className="px-1 py-1 border-r border-[#222] bg-black/40 group-hover:bg-black/60 min-w-[200px] transition-colors">
                        <input className="w-full h-full bg-transparent px-3 py-1.5 rounded text-[#f3e5ab] outline-none focus:bg-[#1a1710] focus:ring-2 focus:ring-[#f3e5ab] shadow-inner font-medium transition-all" value={row.특이사항} onChange={(e) => handleCellEdit(row.id, '특이사항', e.target.value)} placeholder=""/>
                      </td>
                      <td className={`px-4 py-1.5 text-xs font-bold ${row._에러 ? 'text-red-400' : 'text-gray-600'}`}>{row._에러 ? row._사유 : '정상'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredData.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm font-bold bg-black/80 backdrop-blur-sm z-40">
                  <AlertTriangle size={48} className="text-[#333] mb-4"/>
                  데이터가 없습니다.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}