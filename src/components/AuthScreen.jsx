import React from 'react';

export default function AuthScreen({ authStatus, authLoading, handleGoogleLogin }) {
  if (authStatus === 'checking') {
    return (
      <div className="h-screen w-full bg-black flex items-center justify-center animate-pulse">
        <img src="ttlogo.jpg" className="w-20 h-20 rounded-full shadow-[0_0_30px_rgba(59,130,246,0.5)]" alt="Loading"/>
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#071a0e] via-[#060c09] to-[#040707] flex items-center justify-center p-4">
      <div className="w-full max-w-md relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-[#3b82f6] via-[#93c5fd] to-[#1e3a8a] rounded-3xl blur opacity-30 animate-pulse"></div>
        
        <div className="relative bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] p-10 flex flex-col items-center">
          <img src="ttlogo.jpg" alt="NEXUS Logo" className="w-32 h-32 rounded-full border-4 border-[#3b82f6]/80 shadow-[0_0_30px_rgba(59,130,246,0.8)] mb-6" onError={(e) => e.target.style.display='none'} />
          
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#3b82f6] via-[#93c5fd] to-[#1e3a8a] mb-2 tracking-tighter">NEXUS CORE</h1>
          <p className="text-gray-400 text-sm font-medium mb-10">지자체 명단 정제 및 표준화 시스템</p>

          <button onClick={handleGoogleLogin} disabled={authLoading} className="w-full py-4 bg-[#3b82f6] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:bg-[#93c5fd] hover:scale-105 transition-all flex items-center justify-center gap-3 text-base">
            <svg className="w-6 h-6" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
              <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
              <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
              <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
            </svg>
            {authLoading ? '로그인 처리 중...' : 'Google 계정으로 로그인하여 시작'}
          </button>
          <p className="mt-6 text-gray-500 text-xs text-center">구글 계정으로 로그인하면 즉시 시스템을 이용할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
