import React from 'react';
import { Database } from 'lucide-react';

export default function LoadingScreen({ progress }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-xl z-50 p-4">
      <div className="w-[30rem] p-10 bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-[0_0_80px_rgba(59,130,246,0.2)] flex flex-col items-center">
        <Database size={64} className="text-[#3b82f6] mb-8 animate-bounce drop-shadow-[0_0_20px_rgba(59,130,246,1)]"/>
        <div className="flex justify-between w-full text-sm mb-3 font-mono">
          <span className="text-[#3b82f6] font-black tracking-widest">NEXUS ADDRESS ENGINE</span>
          <span className="text-white font-bold">{progress.percent}%</span>
        </div>
        <div className="w-full h-2 bg-black rounded-full overflow-hidden mb-5 border border-white/10 shadow-inner">
          <div className="h-full bg-gradient-to-r from-[#1e3a8a] via-[#3b82f6] to-[#93c5fd] transition-all duration-300" style={{width: `${progress.percent}%`}}></div>
        </div>
        <p className="text-center text-gray-400 text-sm font-bold">{progress.desc}</p>
      </div>
    </div>
  );
}
