import React, { useState } from 'react';
import { X, Layers, Download, Upload, AlertCircle, Clock, Send, CheckCircle2, History } from 'lucide-react';
import { db, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp } from '../config/firebase.js';

export default function UtilsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('merger');
  
  // Sheet Merger State
  const [mergerFile, setMergerFile] = useState(null);
  const [mergerFileName, setMergerFileName] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  // Audit Log State
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Load Logs
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
      const snap = await getDocs(q);
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  };

  React.useEffect(() => {
    if (activeTab === 'audit') fetchLogs();
  }, [activeTab]);

  const handleSendNotification = async (log) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        title: '기준명단 업데이트 알림',
        message: `[${log.targetName}] 님의 정보가 업데이트 되었습니다. (수정자: ${log.userEmail})`,
        read: false,
        timestamp: serverTimestamp(),
        type: 'AUDIT_ALERT',
        logId: log.id
      });
      alert('담당자에게 알림이 전송되었습니다!');
    } catch (e) {
      console.error(e);
      alert('알림 전송 실패: ' + e.message);
    }
  };

  const handleMergerUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMergerFile(file);
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    setMergerFileName(`${baseName}_통합`);
  };

  const executeMerge = async () => {
    if (!mergerFile) return alert('엑셀 파일을 먼저 첨부해주세요.');
    if (!mergerFileName.trim()) return alert('다운로드할 파일 이름을 입력해주세요.');
    
    setIsMerging(true);
    try {
      const buffer = await mergerFile.arrayBuffer();
      
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.onerror = (err) => { worker.terminate(); reject(err); };
        worker.postMessage({ action: 'MERGE_SHEETS', buffer, fileName: `${mergerFileName}.xlsx` }, [buffer]);
      });

      if (!result.ok) throw new Error(result.error);

      // Download
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = result.fileName;
      link.click();

      alert('시트 병합이 완료되었습니다!');
      setMergerFile(null);
      setMergerFileName('');
    } catch (e) {
      console.error(e);
      alert('시트 병합 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#111] border border-gray-700 rounded-3xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
          <h2 className="text-xl font-black text-white flex items-center gap-3">
            <Layers className="text-[#22c55e]" /> 관리자 부가 기능
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex h-[400px]">
          {/* Sidebar */}
          <div className="w-48 border-r border-gray-800 bg-black/30 p-4 flex flex-col gap-2">
            <button
              onClick={() => setActiveTab('merger')}
              className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 ${activeTab === 'merger' ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30' : 'text-gray-400 hover:bg-gray-800'}`}
            >
              <Layers size={16} /> 시트 병합 도구
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 mt-2 ${activeTab === 'audit' ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30' : 'text-gray-400 hover:bg-gray-800'}`}
            >
              <History size={16} /> 이력 및 알림 관리
            </button>
            <div className="mt-auto">
              <p className="text-[10px] text-gray-600 text-center">추가 기능이 곧 업데이트됩니다.</p>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'merger' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <h3 className="text-lg font-bold text-white mb-2">여러 시트를 하나로 합치기</h3>
                <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                  엑셀 파일 내의 모든 시트를 추출하여 하나의 단일 시트(통합시트)로 병합합니다. <br/>
                  각 시트의 열 구조가 동일해야 데이터가 온전히 맞춰집니다.
                </p>

                <div className="space-y-5">
                  <label className={`w-full py-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${mergerFile ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    <Upload size={30} className={mergerFile ? 'text-[#22c55e] mb-3' : 'text-gray-500 mb-3'} />
                    <span className={`font-bold ${mergerFile ? 'text-[#22c55e]' : 'text-gray-400'}`}>
                      {mergerFile ? mergerFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx, .xls" onChange={handleMergerUpload} className="hidden" />
                  </label>

                  {mergerFile && (
                    <div className="space-y-2 animate-in fade-in duration-300">
                      <label className="text-xs font-bold text-gray-400">새로운 다운로드 파일 이름 지정</label>
                      <input 
                        type="text" 
                        value={mergerFileName} 
                        onChange={e => setMergerFileName(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-[#22c55e] transition-colors font-bold"
                        placeholder="파일 이름을 입력하세요"
                      />
                    </div>
                  )}

                  <button 
                    onClick={executeMerge}
                    disabled={!mergerFile || isMerging}
                    className="w-full py-4 bg-[#22c55e] text-black font-extrabold rounded-xl hover:bg-[#86efac] transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                  >
                    {isMerging ? '병합 중...' : <><Download size={18} /> 병합 및 다운로드</>}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-bold text-white">클라우드 변경 이력 (Audit Log)</h3>
                  <button onClick={fetchLogs} className="text-xs text-[#22c55e] hover:underline font-bold">새로고침</button>
                </div>
                <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                  기준명단 갱신 및 시스템 주요 변경 이력이 이곳에 기록됩니다. <br/>
                  담당자에게 알림을 전송하여 변경사항을 즉시 공유하세요.
                </p>

                <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-[#444] pr-2">
                  {loadingLogs ? (
                    <div className="flex justify-center items-center h-32 text-gray-500 text-sm font-bold">로딩 중...</div>
                  ) : logs.length === 0 ? (
                    <div className="flex justify-center items-center h-32 text-gray-600 text-sm font-bold border-2 border-dashed border-gray-800 rounded-xl">기록된 이력이 없습니다.</div>
                  ) : (
                    logs.map(log => (
                      <div key={log.id} className="bg-black/40 border border-gray-800 rounded-xl p-4 transition-all hover:border-gray-600">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-900/50 text-blue-400 border border-blue-700/50">
                              {log.type === 'BASE_UPDATE' ? '기준명단 갱신' : log.type}
                            </span>
                            <span className="text-sm font-bold text-white">{log.targetName}</span>
                            <span className="text-[10px] text-gray-500">{log.city}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                            <Clock size={10} />
                            {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : '방금 전'}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 font-mono bg-[#0a0a0a] p-2 rounded-lg mb-3">
                          {Object.entries(log.updates || {}).map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2">
                              <span className="text-gray-500 w-16">{k}:</span>
                              <span className="text-[#22c55e]">{v}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-800/50">
                          <span className="text-[10px] text-gray-600">수정자: {log.userEmail}</span>
                          <button 
                            onClick={() => handleSendNotification(log)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-[#22c55e]/20 hover:text-[#22c55e] hover:border-[#22c55e]/50 border border-gray-700 text-gray-300 rounded-lg text-[10px] font-bold transition-all"
                          >
                            <Send size={12} /> 담당자 알림 전송
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
