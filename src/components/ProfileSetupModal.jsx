import { useState } from 'react';
import { doc, setDoc, db, serverTimestamp } from '../config/firebase.js';
import { MapPin, User, AlertTriangle, LogOut } from 'lucide-react';

export default function ProfileSetupModal({ user, onComplete, onLogout }) {
  const [region, setRegion] = useState('');
  const [realName, setRealName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const r = region.trim();
    const n = realName.trim();
    if (!r) { setError('소속 지역을 입력해주세요.'); return; }
    if (!n || n.length < 2) { setError('담당자 성명을 2자 이상 입력해주세요.'); return; }
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        region: r,
        realName: n,
        profileCompleted: true,
        profileUpdatedAt: serverTimestamp(),
      }, { merge: true });
      onComplete();
    } catch (e) {
      setError('저장 오류: ' + e.message);
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#071a0e] via-[#060c08] to-[#040708] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[#0a100c] border border-[#22c55e]/30 rounded-3xl shadow-[0_0_60px_rgba(34,197,94,0.15)] p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 flex items-center justify-center">
                <User size={20} className="text-[#22c55e]"/>
              </div>
              <div>
                <h2 className="text-lg font-black text-white">이용자 정보 등록</h2>
                <p className="text-gray-500 text-xs font-mono">{user.email}</p>
              </div>
            </div>
            <button onClick={onLogout} className="text-gray-600 hover:text-red-400 transition-colors" title="로그아웃">
              <LogOut size={16}/>
            </button>
          </div>

          <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 mb-6 flex gap-3">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5"/>
            <p className="text-amber-300 text-sm font-bold leading-relaxed">
              어느 지역의 누구인지 적어주세요.
              <span className="block text-amber-400/70 text-xs font-normal mt-1">
                구분 못하거나 허위 기재 시 이용에 제한이 있을 수 있습니다.
              </span>
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[11px] text-gray-500 font-black mb-1.5 flex items-center gap-1.5 tracking-wide">
                <MapPin size={11}/> 소속 지역 (지자체명)
              </label>
              <input
                value={region}
                onChange={e => { setRegion(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="예: 동대문구청, 수원시청, 강원 춘천..."
                className="w-full bg-black/50 border border-[#1e2d22] focus:border-[#22c55e] text-white p-3.5 rounded-xl outline-none transition-colors text-sm placeholder-gray-700"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-black mb-1.5 flex items-center gap-1.5 tracking-wide">
                <User size={11}/> 담당자 성명
              </label>
              <input
                value={realName}
                onChange={e => { setRealName(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="예: 홍길동"
                className="w-full bg-black/50 border border-[#1e2d22] focus:border-[#22c55e] text-white p-3.5 rounded-xl outline-none transition-colors text-sm placeholder-gray-700"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs font-bold mt-3 flex items-center gap-1"><AlertTriangle size={12}/>{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full mt-6 py-4 bg-[#22c55e] text-black font-extrabold rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.4)] hover:bg-[#86efac] hover:scale-[1.02] transition-all disabled:opacity-50 disabled:scale-100"
          >
            {loading ? '저장 중...' : '등록하고 시작하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
