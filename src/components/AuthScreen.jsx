import React from 'react';

export default function AuthScreen({ authStatus, authLoading, handleGoogleLogin }) {
  if (authStatus === 'checking') {
    return (
      <div className="h-screen w-full bg-[#060908] flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-[#060908] flex items-center justify-center p-4"
      style={{ backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.07) 0%, transparent 70%)' }}
    >
      <div className="w-full max-w-sm relative">
        {/* subtle glow — static, no animation */}
        <div className="absolute -inset-px bg-gradient-to-b from-emerald-500/20 to-transparent rounded-3xl blur-xl pointer-events-none" />

        <div className="relative bg-[#0a0f0d]/90 backdrop-blur-xl border border-emerald-500/15 rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] p-10 flex flex-col items-center">

          {/* 로고 */}
          <div className="relative mb-7">
            <div className="absolute inset-0 rounded-full bg-emerald-400/20 blur-xl" />
            <img
              src="ttlogo.jpg"
              alt="NEXUS Logo"
              className="relative w-20 h-20 rounded-full border-2 border-emerald-500/50 shadow-[0_0_24px_rgba(16,185,129,0.35)] object-cover"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div
              style={{ display: 'none' }}
              className="w-20 h-20 rounded-full border-2 border-emerald-500/50 bg-emerald-950/40 items-center justify-center text-emerald-400 text-2xl font-black"
            >N</div>
          </div>

          {/* 타이틀 */}
          <h1 className="text-2xl font-black tracking-tighter mb-1"
            style={{ background: 'linear-gradient(135deg, #34d399 0%, #6ee7b7 50%, #a7f3d0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            NEXUS PIPELINE
          </h1>
          <p className="text-gray-500 text-[13px] font-medium mb-9 tracking-wide">지자체 명단 정제 및 배송 관리 시스템</p>

          {/* 로그인 버튼 */}
          <button
            onClick={handleGoogleLogin}
            disabled={authLoading}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-extrabold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:shadow-[0_0_28px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-3 text-[15px]"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
              <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
              <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
              <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
            </svg>
            {authLoading ? '로그인 처리 중...' : 'Google 계정으로 시작'}
          </button>

          <p className="mt-5 text-gray-600 text-xs text-center leading-relaxed">
            구글 계정으로 로그인하면 즉시 이용할 수 있습니다
          </p>
        </div>
      </div>
    </div>
  );
}
