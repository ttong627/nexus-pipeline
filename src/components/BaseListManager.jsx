import React, { useState, useEffect, useRef } from 'react';
import { db, collection, getDocs, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp } from '../config/firebase.js';
import { Database, Upload, Trash2, ArrowLeft, AlertCircle, CheckCircle, ChevronDown, Plus, Minus } from 'lucide-react';
import { normalizeBirth, parsePhoneNumbers } from '../utils/parsers.js';
import { REGIONS } from '../utils/regions.js';

export default function BaseListManager({ user, onBack }) {
  const [selectedSido, setSelectedSido] = useState('');
  const [selectedSigungu, setSelectedSigungu] = useState('');
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [conflicts, setConflicts] = useState([]); // [{ newRow, existingRows, resolved: false/true, selectedId: null }]
  const [showConflictModal, setShowConflictModal] = useState(false);
  
  const TIER_QUOTAS = { basic: 0, vip: 2, vvip: 10, sapphire: 999 };
  const maxCities = TIER_QUOTAS[user?.tier || 'basic'] || 0;
  const citiesUsed = user?.citiesUsed || [];

  // 1. Fetch Records for Selected City
  useEffect(() => {
    if (!selectedCity) { setRecords([]); return; }
    fetchRecords(selectedCity);
  }, [selectedCity]);

  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  const fetchRecords = async (cityId) => {
    setLoading(true);
    try {
      const cityDoc = await getDoc(doc(db, 'base_lists', cityId));
      if (cityDoc.exists() && cityDoc.data().updatedAt) {
        const date = cityDoc.data().updatedAt.toDate();
        setLastUpdatedAt(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
      } else {
        setLastUpdatedAt('');
      }

      const snap = await getDocs(collection(db, `base_lists/${cityId}/records`));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecords(data);
    } catch (e) {
      console.error(e);
      alert('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Upload Excel
  const handleFileUpload = async (e) => {
    if (!selectedCity) return alert('먼저 관리할 지자체를 입력해주세요. (예: 부천시 원미구)');
    if (!citiesUsed.includes(selectedCity) && citiesUsed.length >= maxCities && user?.role !== 'admin') {
      return alert(`현재 등급(${user?.tier})의 지자체 등록 한도(${maxCities}개)를 초과했습니다.`);
    }

    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.onerror = (err) => { worker.terminate(); reject(err); };
        worker.postMessage({ buffer, fileName: file.name }, [buffer]);
      });

      if (!result.ok) throw new Error(result.error);
      
      // Merge sheets logic
      const validSheets = result.sheetsData.filter(s => s.type !== '제외');
      if (validSheets.length === 0) throw new Error('유효한 시트가 없습니다.');

      const newRows = [];
      validSheets.forEach(sheet => {
        const h = sheet.headers;
        sheet.bodyRows.forEach(row => {
          const rowObj = {};
          h.forEach((header, idx) => { rowObj[header] = row[idx]; });
          // Basic field extraction
          const name = String(rowObj['성명'] || rowObj['이름'] || rowObj['대상자명'] || '').trim();
          const birthRaw = String(rowObj['생년월일'] || rowObj['주민번호'] || '').trim();
          const p1Raw = String(rowObj['연락처'] || rowObj['휴대폰'] || '').trim();
          const p2Raw = String(rowObj['전화번호'] || rowObj['유선'] || '').trim();
          const dong = String(rowObj['행정동'] || rowObj['읍면동'] || '').trim();
          const note = String(rowObj['특이사항'] || rowObj['비고'] || '').trim();
          const address = String(rowObj['주소'] || '').trim();
          const sms = String(rowObj['문자수신여부'] || rowObj['문자'] || '').trim();
          const driver = String(rowObj['기사'] || rowObj['담당기사'] || '').trim();
          const seqNo = parseInt(rowObj['배송순번'] || rowObj['순번'] || 0) || 0;
          
          if (name) {
            newRows.push({
              name, dong, note, address, sms, driver, seqNo,
              birthKey: normalizeBirth(birthRaw),
              mobile: parsePhoneNumbers(p1Raw, '').mobile.replace(/[^0-9]/g, ''),
              landline: parsePhoneNumbers('', p2Raw).landline.replace(/[^0-9]/g, ''),
              raw: rowObj // store original for reference if needed
            });
          }
        });
      });

      // Match against existing records
      await processMatching(newRows);

    } catch (err) {
      console.error(err);
      alert('업로드 중 오류: ' + err.message);
      setUploading(false);
    }
  };

  const processMatching = async (newRows) => {
    // 4-step matching logic
    const updates = [];
    const adds = [];
    const newConflicts = [];

    newRows.forEach(row => {
      let matched = null;
      let possibleMatches = [];
      
      // 1. Name + Birth
      if (row.birthKey) matched = records.find(r => r.name === row.name && r.birthKey === row.birthKey);
      
      // 2. Name + Mobile
      if (!matched && row.mobile.length >= 9) matched = records.find(r => r.name === row.name && r.mobile === row.mobile);
      
      // 3. Name + Landline
      if (!matched && row.landline.length >= 9) matched = records.find(r => r.name === row.name && r.landline === row.landline);

      // 4. Name + Dong (Namesake conflict check)
      if (!matched && row.dong) {
        possibleMatches = records.filter(r => r.name === row.name && r.dong === row.dong);
        if (possibleMatches.length > 0) {
          // Check if completely different from ALL possible matches
          const isCompletelyDifferentFromAll = possibleMatches.every(p => {
            const hasMobileConflict = p.mobile && row.mobile && p.mobile !== row.mobile;
            const hasLandlineConflict = p.landline && row.landline && p.landline !== row.landline;
            return hasMobileConflict && hasLandlineConflict; // if both phone numbers exist and are different
          });

          if (isCompletelyDifferentFromAll) {
            // It's a namesake but completely different contact info. Treat as new.
            possibleMatches = []; // clear to force add
          } else if (possibleMatches.length === 1) {
            matched = possibleMatches[0];
          } else {
            // Conflict! Needs manual resolution
            newConflicts.push({ newRow: row, existingRows: possibleMatches, resolved: false, selectedId: null });
            return;
          }
        }
      }

      if (matched) {
        // Only update if there are actual changes to prevent unnecessary DB writes
        let hasChanges = false;
        const updatedData = {};
        
        ['birthKey', 'mobile', 'landline', 'dong', 'note', 'address', 'sms', 'driver', 'seqNo'].forEach(key => {
          if (updateFields[key] && row[key] !== undefined && row[key] !== matched[key]) {
             updatedData[key] = row[key];
             hasChanges = true;
          }
        });
        
        // Add month tag if not present
        const months = matched.months || [];
        if (!months.includes(targetMonth)) {
          months.push(targetMonth);
          hasChanges = true;
        }

        if (hasChanges) {
          updates.push({ ...matched, ...updatedData, id: matched.id, months }); // merge data
        }
      } else if (possibleMatches.length === 0) {
        // Initialize history array and months for new records
        adds.push({ 
          ...row, 
          months: [targetMonth],
          history: [{ date: new Date().toISOString().split('T')[0], note: `[${targetMonth}] 초기 명단 등록`, author: user?.name || '관리자' }] 
        });
      }
    });

    if (newConflicts.length > 0) {
      setConflicts(newConflicts);
      setShowConflictModal(true);
      // Wait for user to resolve conflicts before committing adds/updates
      // For now, we will just hold adds/updates in state or commit them and process conflicts later.
      alert(`동명이인 충돌이 ${newConflicts.length}건 발생했습니다. 확인 후 승인해주세요.`);
    } else {
      await commitBatch(adds, updates);
    }
  };

  const commitBatch = async (adds, updates) => {
    try {
      const batch = writeBatch(db);
      const cityRef = doc(db, 'base_lists', selectedCity);
      batch.set(cityRef, { city: selectedCity, updatedAt: serverTimestamp(), author: user.uid }, { merge: true });

      adds.forEach(a => {
        const rRef = doc(collection(db, `base_lists/${selectedCity}/records`));
        batch.set(rRef, { ...a, id: rRef.id });
      });

      updates.forEach(u => {
        const rRef = doc(db, `base_lists/${selectedCity}/records`, u.id);
        batch.set(rRef, u, { merge: true });
      });

      await batch.commit();
      alert(`명단 업데이트 완료! (신규: ${adds.length}건, 업데이트: ${updates.length}건)`);
      fetchRecords(selectedCity);
    } catch (e) {
      alert('DB 저장 오류: ' + e.message);
    } finally {
      setUploading(false);
      setShowConflictModal(false);
    }
  };

  const [historyModalRecord, setHistoryModalRecord] = useState(null);
  const [newHistoryNote, setNewHistoryNote] = useState('');
  const [notifyManager, setNotifyManager] = useState(false);
  const [targetMonth, setTargetMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [updateFields, setUpdateFields] = useState({
    birthKey: true,
    mobile: true,
    landline: true,
    dong: true,
    note: true,
    address: true,
    sms: true,
    driver: true,
    seqNo: true
  });

  const handleAddHistory = async () => {
    if (!newHistoryNote.trim()) return;
    const updatedRecord = { ...historyModalRecord };
    const historyEntry = { date: new Date().toISOString().split('T')[0], note: newHistoryNote, author: user?.name || '관리자' };
    updatedRecord.history = [historyEntry, ...(updatedRecord.history || [])];
    
    try {
      await setDoc(doc(db, `base_lists/${selectedCity}/records`, updatedRecord.id), updatedRecord, { merge: true });
      
      // 알림 발송 로직
      if (notifyManager) {
        // 실제 운영에서는 Cloud Functions 나 Email/Slack Webhook을 연동.
        // 현재는 DB notifications 컬렉션에 기록.
        const notiRef = doc(collection(db, 'notifications'));
        await setDoc(notiRef, {
          type: 'HISTORY_ALERT',
          city: selectedCity,
          recordName: updatedRecord.name,
          note: newHistoryNote,
          author: user?.name || '관리자',
          createdAt: new Date(),
          read: false
        });
        alert(`담당자에게 알림이 전송되었습니다.\n[내용: ${newHistoryNote}]`);
      }

      setHistoryModalRecord(updatedRecord);
      setNewHistoryNote('');
      setNotifyManager(false);
      setRecords(prev => prev.map(r => r.id === updatedRecord.id ? updatedRecord : r));
    } catch (e) {
      alert('이력 저장 오류');
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#0a0a0a] flex flex-col p-6 animate-in slide-in-from-right-8 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-gray-800/50 hover:bg-gray-700 rounded-xl text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Database className="text-[#22c55e]" /> 지자체 기본 명단 및 이력 관리 (CRM)
            </h1>
            <div className="flex items-center gap-4 mt-1">
              <p className="text-gray-400 text-sm">VIP 이상 전용 기능 (현재 등급: {user?.tier}, 등록된 지자체: {citiesUsed.length}/{maxCities})</p>
              {lastUpdatedAt && (
                <p className="text-[#22c55e] text-sm font-bold bg-[#22c55e]/10 px-2 py-0.5 rounded border border-[#22c55e]/30">
                  마지막 적용된 날짜: {lastUpdatedAt}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Left Panel: City & Upload */}
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-bold mb-3">1. 지자체 선택</h3>
            <div className="flex flex-col gap-2">
              <select 
                value={selectedSido} 
                onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-white outline-none focus:border-[#22c55e]"
              >
                <option value="">시/도 선택</option>
                {Object.keys(REGIONS).map(sido => (
                  <option key={sido} value={sido}>{sido}</option>
                ))}
              </select>
              <select 
                value={selectedSigungu} 
                onChange={e => setSelectedSigungu(e.target.value)}
                disabled={!selectedSido}
                className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-white outline-none focus:border-[#22c55e] disabled:opacity-50"
              >
                <option value="">시/군/구 선택</option>
                {selectedSido && REGIONS[selectedSido].map(sigungu => (
                  <option key={sigungu} value={sigungu}>{sigungu}</option>
                ))}
              </select>
            </div>
            {selectedCity && (
              <p className="text-xs text-[#22c55e] mt-2 font-bold">선택됨: {selectedCity}</p>
            )}
          </div>

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 flex-1 flex flex-col">
            <h3 className="text-white font-bold mb-3">2. 엑셀 업로드 (월별 업데이트)</h3>
            <div className="mb-4">
              <label className="text-xs text-gray-400 block mb-1">업데이트 대상 월 (Month)</label>
              <input 
                type="month" 
                value={targetMonth} 
                onChange={e => setTargetMonth(e.target.value)}
                className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-[#22c55e] text-sm"
              />
            </div>
            <div className="mb-4">
              <label className="text-xs text-gray-400 block mb-2">업데이트 허용 항목 (기존 명단 갱신 시 적용)</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'birthKey', label: '생년월일' },
                  { key: 'mobile', label: '휴대전화' },
                  { key: 'landline', label: '유선전화' },
                  { key: 'dong', label: '행정동' },
                  { key: 'note', label: '특이사항' },
                  { key: 'address', label: '주소' },
                  { key: 'sms', label: '문자수신여부' },
                  { key: 'driver', label: '기사' },
                  { key: 'seqNo', label: '배송순번' }
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
                    <input 
                      type="checkbox" 
                      checked={updateFields[key]} 
                      onChange={e => setUpdateFields(prev => ({ ...prev, [key]: e.target.checked }))}
                      className="accent-[#22c55e]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              선택한 월에 해당하는 데이터를 명단에 추가하거나 체크된 항목에 한하여 기존 이력을 업데이트합니다.
            </p>
            <label className={`w-full py-4 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-[#22c55e]/50 hover:bg-[#22c55e]/5 transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={24} className="text-[#22c55e] mb-2" />
              <span className="text-gray-300 font-bold">엑셀 파일 선택</span>
              <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
            </label>
            {uploading && <p className="text-[#22c55e] text-sm font-bold text-center mt-3 animate-pulse">데이터 병합 및 분석 중...</p>}
          </div>
        </div>

        {/* Right Panel: Data Grid */}
        <div className="flex-1 bg-[#111] border border-gray-800 rounded-2xl p-5 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-white font-bold">등록된 명단 ({records.length}건)</h3>
          </div>
          <div className="flex-1 overflow-auto rounded-xl border border-gray-800 bg-black">
            {loading ? (
              <div className="h-full flex items-center justify-center text-[#22c55e] animate-pulse">불러오는 중...</div>
            ) : records.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-2">
                <Database size={40} />
                <p>등록된 명단이 없습니다.</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left text-gray-300">
                <thead className="text-xs text-gray-400 uppercase bg-gray-900 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">성명</th>
                    <th className="px-4 py-3">생년월일</th>
                    <th className="px-4 py-3">연락처</th>
                    <th className="px-4 py-3">행정동</th>
                    <th className="px-4 py-3 text-center">이력 관리</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="px-4 py-2 font-bold text-white">{r.name}</td>
                      <td className="px-4 py-2">{r.birthKey}</td>
                      <td className="px-4 py-2">{r.mobile}</td>
                      <td className="px-4 py-2">{r.dong}</td>
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => setHistoryModalRecord(r)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs rounded border border-gray-600 flex items-center gap-1 mx-auto transition-colors text-gray-300">
                          📝 이력 ({r.history?.length || 0})
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* History Modal */}
      {historyModalRecord && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#111] border border-gray-700 rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.1)]">
            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
              <h2 className="text-lg font-bold text-white">📝 {historyModalRecord.name}님의 이력 (타임라인)</h2>
              <button onClick={() => setHistoryModalRecord(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-5 bg-black/50">
              {historyModalRecord.history?.length > 0 ? (
                <div className="space-y-4">
                  {historyModalRecord.history.map((h, i) => (
                    <div key={i} className="border-l-2 border-[#22c55e] pl-4 py-1 relative">
                      <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-[#22c55e]"></div>
                      <div className="text-xs text-gray-400 mb-1">{h.date} | {h.author}</div>
                      <div className="text-sm text-gray-200">{h.note}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">기록된 이력이 없습니다.</p>
              )}
            </div>
            <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex flex-col gap-3">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newHistoryNote} 
                  onChange={e => setNewHistoryNote(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && handleAddHistory()}
                  placeholder="새로운 이력(메모)을 입력하세요..." 
                  className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#22c55e]"
                />
                <button onClick={handleAddHistory} className="px-4 py-2 bg-[#22c55e] text-black font-bold rounded-lg text-sm hover:bg-[#1ea34d]">추가</button>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer w-max hover:text-gray-200">
                <input 
                  type="checkbox" 
                  checked={notifyManager} 
                  onChange={e => setNotifyManager(e.target.checked)}
                  className="accent-[#22c55e]"
                />
                저장 시 담당자(관리자)에게 긴급 알림 전송
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Modal */}
      {showConflictModal && conflicts.length > 0 && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#111] border border-gray-700 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
              <h2 className="text-xl font-black text-amber-400 flex items-center gap-2"><AlertCircle /> 동명이인 충돌 해결 ({conflicts.filter(c=>!c.resolved).length}건 남음)</h2>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-8">
              {conflicts.map((conflict, idx) => {
                if (conflict.resolved) return null;
                const row = conflict.newRow;
                return (
                  <div key={idx} className="bg-black border border-amber-500/30 rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                    <div className="mb-4 flex items-center gap-2">
                      <span className="px-3 py-1 bg-amber-500/20 text-amber-400 font-bold rounded text-sm">충돌 대상</span>
                      <h3 className="text-lg font-bold text-white">{row.name} ({row.dong})</h3>
                      <p className="text-gray-400 text-sm ml-2">업로드 데이터: {row.mobile || '-'} / {row.landline || '-'}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* 기존 명단들 */}
                      {conflict.existingRows.map((ex, exIdx) => (
                        <div key={exIdx} className="bg-[#1a1a1a] border border-gray-700 hover:border-[#22c55e] rounded-lg p-4 cursor-pointer transition-colors" onClick={() => {
                          const updated = [...conflicts];
                          updated[idx].resolved = true;
                          updated[idx].selectedId = ex.id;
                          setConflicts(updated);
                        }}>
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-[#22c55e]">기존 명단 #{exIdx + 1} 병합</h4>
                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">선택</span>
                          </div>
                          <div className="text-sm text-gray-300 space-y-1">
                            <p><span className="text-gray-500 inline-block w-16">연락처</span> {ex.mobile || '-'}</p>
                            <p><span className="text-gray-500 inline-block w-16">추가번호</span> {ex.landline || '-'}</p>
                            <p><span className="text-gray-500 inline-block w-16">특이사항</span> {ex.note || '-'}</p>
                          </div>
                        </div>
                      ))}

                      {/* 신규 등록 */}
                      <div className="bg-blue-900/10 border border-blue-500/30 hover:border-blue-500 rounded-lg p-4 cursor-pointer transition-colors" onClick={() => {
                        const updated = [...conflicts];
                        updated[idx].resolved = true;
                        updated[idx].selectedId = 'NEW';
                        setConflicts(updated);
                      }}>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-blue-400">완전히 새로운 사람으로 등록</h4>
                          <span className="text-xs text-blue-500 bg-blue-900/30 px-2 py-0.5 rounded">신규추가</span>
                        </div>
                        <p className="text-sm text-gray-400 mt-2">위 기존 명단들과 관련 없는 동명이인입니다.</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-5 border-t border-gray-800 bg-gray-900/50 flex justify-end gap-3">
              <button
                onClick={async () => {
                  if (conflicts.some(c => !c.resolved)) {
                    if (!confirm('해결되지 않은 충돌이 있습니다. 이 항목들은 무시하고 완료하시겠습니까?')) return;
                  }
                  const resolvedAdds = [];
                  const resolvedUpdates = [];
                  conflicts.forEach(c => {
                    if (!c.resolved) return;
                    if (c.selectedId === 'NEW') {
                      resolvedAdds.push({
                        ...c.newRow,
                        months: [targetMonth],
                        history: [{ date: new Date().toISOString().split('T')[0], note: `[${targetMonth}] 동명이인 분리 등록`, author: user?.name || '관리자' }]
                      });
                    } else {
                      const matched = c.existingRows.find(ex => ex.id === c.selectedId);
                      if (matched) {
                        const months = matched.months || [];
                        if (!months.includes(targetMonth)) months.push(targetMonth);
                        resolvedUpdates.push({ ...matched, ...c.newRow, id: matched.id, months });
                      }
                    }
                  });
                  await commitBatch(resolvedAdds, resolvedUpdates);
                  setShowConflictModal(false);
                }}
                className="px-6 py-2 bg-[#22c55e] text-black font-bold rounded-lg hover:bg-[#1ea34d]"
              >
                병합 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
