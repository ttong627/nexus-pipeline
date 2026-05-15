import { Component } from 'react';

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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-[#050505] text-gray-200 p-8">
          <div className="w-full max-w-lg bg-[#0a0a0a] border border-red-500/40 rounded-3xl p-10 shadow-[0_0_60px_rgba(231,76,60,0.2)] text-center">
            <div className="text-5xl mb-6">⚠️</div>
            <h2 className="text-2xl font-black text-red-400 mb-3">예상치 못한 오류가 발생했습니다</h2>
            <p className="text-gray-400 text-sm mb-2 leading-relaxed">
              작업 중 오류가 발생했습니다. 데이터는 손실되지 않았을 수 있습니다.
            </p>
            <p className="text-gray-600 text-xs font-mono bg-black/40 rounded-xl p-4 mb-8 text-left break-all">
              {this.state.error?.message || '알 수 없는 오류'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="w-full py-3 bg-[#22c55e] text-black font-extrabold rounded-xl hover:bg-[#86efac] transition-all shadow-[0_0_20px_rgba(34,197,94,0.4)] mb-3"
            >
              다시 시도
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
