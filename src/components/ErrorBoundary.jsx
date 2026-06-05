import { Component } from 'react';
import { APP_VERSION } from '../version.js';

const isChunkLoadError = (error) => {
  const message = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
};

const clearAppCachesAndReload = async () => {
  const key = `nexus_boundary_chunk_recovery_${APP_VERSION}`;
  try {
    // 이미 1회 캐시정리+새로고침을 시도했으면 더는 자동 reload 안 함(무한 새로고침 루프/탭 닫힘 방지).
    // 에러 화면(수동 복구 버튼)이 표시되도록 그대로 둔다.
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* ignore */ }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
  } catch { /* ignore */ }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(cacheKey => caches.delete(cacheKey)));
    }
  } catch { /* ignore */ }

  window.location.reload();
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[NEXUS ERROR]', error, info.componentStack);
    if (isChunkLoadError(error)) {
      clearAppCachesAndReload();
    }
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="h-screen w-full flex items-center justify-center bg-[#050505] text-gray-200 p-8">
          <div className="w-full max-w-lg bg-[#0a0a0a] border border-red-500/40 rounded-3xl p-10 shadow-[0_0_60px_rgba(231,76,60,0.2)] text-center">
            <div className="text-5xl mb-6">!</div>
            <h2 className="text-2xl font-black text-red-400 mb-3">
              {chunkError ? '새 버전 파일을 다시 불러오는 중입니다' : '예상치 못한 오류가 발생했습니다'}
            </h2>
            <p className="text-gray-400 text-sm mb-2 leading-relaxed">
              {chunkError
                ? '배포 직후 브라우저 캐시가 이전 파일을 잡은 상태입니다. 캐시를 정리한 뒤 새로고침하면 복구됩니다.'
                : '작업 중 오류가 발생했습니다. 데이터는 손실되지 않았을 수 있습니다.'}
            </p>
            <p className="text-gray-600 text-xs font-mono bg-black/40 rounded-xl p-4 mb-8 text-left break-all">
              {this.state.error?.message || '알 수 없는 오류'}
            </p>
            <button
              onClick={() => {
                if (chunkError) clearAppCachesAndReload();
                else this.setState({ hasError: false, error: null });
              }}
              className="w-full py-3 bg-[#3b82f6] text-black font-extrabold rounded-xl hover:bg-[#93c5fd] transition-all shadow-[0_0_20px_rgba(59,130,246,0.4)] mb-3"
            >
              {chunkError ? '캐시 정리 후 새로고침' : '다시 시도'}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-[#111] text-gray-400 font-bold rounded-xl border border-[#333] hover:bg-[#222] transition-colors"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
