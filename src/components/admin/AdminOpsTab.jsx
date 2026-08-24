// 관리자 패널 · 운영현황 탭 — AdminPanel.jsx 에서 분리(2026-08-24 정밀점검 · 파일 800줄 원칙).
//   ★JSX 는 한 줄도 바꾸지 않고 그대로 옮겼다(들여쓰기만 조정). 동작 변화 0 이 목적이다.
//   ★prop 을 하나라도 빠뜨리면 **그 버튼만 조용히 죽는다** — `scripts/component-wiring.test.mjs` 가 잡는다.

import { CheckCircle2, TrendingUp, AlertCircle, UserX, Activity, Zap, RefreshCw } from 'lucide-react';
import { fmt, TIER_DEFAULT_CITIES } from './adminShared.js';
import TierBadge from './TierBadge.jsx';

export default function AdminOpsTab({
  auditLoading,
  auditLogs,
  churnRisk,
  cityUsageStats,
  companyMigStatus,
  errorLoading,
  errorLogs,
  fetchErrorLogs,
  fetchUsageEvents,
  migrationStatus,
  nearLimit,
  noteCleanStatus,
  nowSec,
  promoteMigStatus,
  runCompanyUnifyMigration,
  runNoteCleanMigration,
  runOfficeMigration,
  runPromotePersonalCompanies,
  usageEvents,
  usageLoading,
}) {
  return (
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-6 space-y-6">

        {/* ── 이용 현황 (누가·어디서·쉬운/일반 정제를 얼마나) ───────────── */}
        <div>
          <h3 className="text-emerald-400 font-black text-base flex items-center gap-2 mb-3">
            <Activity size={18}/> 이용 현황
            <span className="text-[11px] text-emerald-700 font-normal ml-1">— 정제 실행 기록 · 접속 IP (180일 후 자동 삭제)</span>
            <button onClick={fetchUsageEvents} disabled={usageLoading}
              className="ml-auto flex items-center gap-1 px-3 py-1 rounded-lg bg-[#111] border border-[#333] text-gray-400 text-[11px] font-bold hover:text-white disabled:opacity-40">
              <RefreshCw size={11} className={usageLoading ? 'animate-spin' : ''}/> {usageLoading ? '불러오는 중' : '불러오기'}
            </button>
          </h3>

          {usageEvents.length === 0 ? (
            <div className="bg-[#0d0d0d] border border-[#222] rounded-xl p-5 text-gray-600 text-xs">
              {usageLoading ? '불러오는 중…' : '[불러오기]를 누르면 최근 300건을 조회합니다. (기록은 새 버전 배포 이후 정제부터 쌓입니다)'}
            </div>
          ) : (
            <>
              {(() => {
                const easy = usageEvents.filter(e => e.mode === 'easy').length;
                const normal = usageEvents.length - easy;
                const rows = usageEvents.reduce((s, e) => s + (e.rows || 0), 0);
                const users = new Set(usageEvents.map(e => e.email || e.uid)).size;
                const ips = new Set(usageEvents.map(e => e.ip).filter(Boolean)).size;
                const cards = [
                  ['쉬운 정제', easy, 'text-emerald-400'],
                  ['일반 정제', normal, 'text-blue-400'],
                  ['처리 건수', rows.toLocaleString(), 'text-white'],
                  ['사용자', `${users}명`, 'text-amber-400'],
                  ['접속 IP', `${ips}개`, 'text-purple-400'],
                ];
                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    {cards.map(([label, val, cls]) => (
                      <div key={label} className="bg-[#0d0d0d] border border-[#222] rounded-xl p-3">
                        <p className="text-gray-600 text-[10px] font-bold mb-1">{label}</p>
                        <p className={`${cls} font-black text-lg`}>{val}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 사용자별 집계 */}
              <div className="bg-[#0d0d0d] border border-[#222] rounded-xl overflow-hidden mb-4">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#111] text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-black">사용자</th>
                      <th className="text-right px-3 py-2 font-black">쉬운</th>
                      <th className="text-right px-3 py-2 font-black">일반</th>
                      <th className="text-right px-3 py-2 font-black">처리 건수</th>
                      <th className="text-left px-3 py-2 font-black">접속 IP</th>
                      <th className="text-left px-3 py-2 font-black">최근 이용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const byUser = new Map();
                      usageEvents.forEach(e => {
                        const k = e.email || e.uid || '?';
                        const cur = byUser.get(k) || { easy: 0, normal: 0, rows: 0, ips: new Set(), last: null };
                        if (e.mode === 'easy') cur.easy++; else cur.normal++;
                        cur.rows += e.rows || 0;
                        if (e.ip) cur.ips.add(e.ip);
                        const t = e.at?.seconds || 0;
                        if (!cur.last || t > cur.last) cur.last = t;
                        byUser.set(k, cur);
                      });
                      return [...byUser.entries()]
                        .sort((a, b) => (b[1].easy + b[1].normal) - (a[1].easy + a[1].normal))
                        .map(([email, v]) => (
                          <tr key={email} className="border-t border-[#1a1a1a]">
                            <td className="px-3 py-2 text-gray-300 font-mono">{email}</td>
                            <td className="px-3 py-2 text-right text-emerald-400 font-black">{v.easy}</td>
                            <td className="px-3 py-2 text-right text-blue-400 font-black">{v.normal}</td>
                            <td className="px-3 py-2 text-right text-gray-400">{v.rows.toLocaleString()}</td>
                            <td className="px-3 py-2 text-purple-300 font-mono">
                              {[...v.ips].slice(0, 2).join(', ')}{v.ips.size > 2 ? ` 외 ${v.ips.size - 2}` : ''}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {v.last ? new Date(v.last * 1000).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                            </td>
                          </tr>
                        ));
                    })()}
                  </tbody>
                </table>
              </div>

              {/* 최근 기록 */}
              <div className="bg-[#0d0d0d] border border-[#222] rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#111] text-gray-500 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-black">시각</th>
                      <th className="text-left px-3 py-2 font-black">사용자</th>
                      <th className="text-left px-3 py-2 font-black">구분</th>
                      <th className="text-left px-3 py-2 font-black">지자체 · 월</th>
                      <th className="text-right px-3 py-2 font-black">건수</th>
                      <th className="text-left px-3 py-2 font-black">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageEvents.map(e => (
                      <tr key={e.id} className="border-t border-[#1a1a1a]">
                        <td className="px-3 py-1.5 text-gray-600">
                          {e.at?.seconds ? new Date(e.at.seconds * 1000).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400 font-mono">{e.email || e.uid}</td>
                        <td className="px-3 py-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
                            e.mode === 'easy'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}>{e.mode === 'easy' ? '쉬운' : '일반'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{e.city} {e.month}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{(e.rows || 0).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-purple-300 font-mono">{e.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* 이탈 위험 */}
        {churnRisk.length > 0 && (
          <div>
            <h3 className="text-amber-400 font-black text-base flex items-center gap-2 mb-3">
              <UserX size={18}/> 이탈 위험 사용자 <span className="text-[11px] text-amber-600 font-normal ml-1">— 60일 이상 미접속</span>
              <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-black">{churnRisk.length}명</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {churnRisk.map(u => {
                const daysSince = Math.floor((nowSec - (u.lastLogin?.seconds || 0)) / 86400);
                return (
                  <div key={u.id} className="bg-amber-950/20 border border-amber-700/30 rounded-xl p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-white font-black text-sm">{u.realName || '이름없음'}</p>
                      <p className="text-gray-500 text-[11px] font-mono">{u.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <TierBadge tier={u.tier || 'basic'} />
                      <p className="text-amber-400 font-black text-sm mt-1">{daysSince}일 전</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 한도 근접 */}
        {nearLimit.length > 0 && (
          <div>
            <h3 className="text-red-400 font-black text-base flex items-center gap-2 mb-3">
              <AlertCircle size={18}/> 지자체 한도 근접 <span className="text-[11px] text-red-600 font-normal ml-1">— 80% 이상 사용</span>
              <span className="bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] px-2 py-0.5 rounded-full font-black">{nearLimit.length}명</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {nearLimit.map(u => {
                const max = u.maxCities ?? TIER_DEFAULT_CITIES[u.tier || 'basic'] ?? 1;
                const used = (u.citiesApproved || []).length;
                const pct = Math.round((used / max) * 100);
                return (
                  <div key={u.id} className="bg-red-950/20 border border-red-700/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-white font-black text-sm">{u.realName || '이름없음'}</p>
                        <p className="text-gray-500 text-[11px] font-mono">{u.email}</p>
                      </div>
                      <TierBadge tier={u.tier || 'basic'} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-black/50 rounded-full h-2 overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(100, pct)}%` }}/>
                      </div>
                      <span className="text-red-400 font-black text-xs shrink-0">{used}/{max} ({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {churnRisk.length === 0 && nearLimit.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-[#3b82f6]/5 border border-[#3b82f6]/20 rounded-xl">
            <CheckCircle2 size={20} className="text-[#3b82f6] shrink-0"/>
            <p className="text-[#3b82f6] font-bold text-sm">이탈 위험 및 한도 근접 사용자가 없습니다.</p>
          </div>
        )}

        {/* 지자체별 업로드 통계 */}
        <div>
          <h3 className="text-[#3b82f6] font-black text-base flex items-center gap-2 mb-3">
            <TrendingUp size={18}/> 지자체별 업로드 통계
            <span className="text-gray-600 text-[11px] font-normal">— 전체 {auditLogs.length}건 배치 저장</span>
          </h3>
          {auditLoading ? (
            <div className="text-center text-gray-500 py-8 text-sm">불러오는 중...</div>
          ) : cityUsageStats.length === 0 ? (
            <div className="text-center text-gray-600 py-8 text-sm">기록된 데이터가 없습니다.</div>
          ) : (
            <div className="bg-black/40 border border-[#0f1a2e] rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[#0a100c] border-b border-[#0f1a2e]">
                  <tr className="text-[#3b82f6] font-black">
                    <th className="px-4 py-2.5 text-left">지자체</th>
                    <th className="px-4 py-2.5 text-center">배치 횟수</th>
                    <th className="px-4 py-2.5 text-center">신규 저장</th>
                    <th className="px-4 py-2.5 text-center">업데이트</th>
                    <th className="px-4 py-2.5 text-center">마지막 업로드</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0f1a2e]">
                  {cityUsageStats.map(s => (
                    <tr key={s.city} className="hover:bg-white/3 transition-colors">
                      <td className="px-4 py-2.5 text-white font-bold">{s.city}</td>
                      <td className="px-4 py-2.5 text-center text-[#3b82f6] font-black">{s.sessions.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-center text-blue-400">{s.added.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-center text-amber-400">{s.updated.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-center text-gray-500 font-mono">{s.lastSec > 0 ? fmt({ seconds: s.lastSec }) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* DB 마이그레이션 — 동사무소→주민센터 */}
        <div>
          <h3 className="text-orange-400 font-black text-base flex items-center gap-2 mb-3">
            <RefreshCw size={18}/> DB 마이그레이션
          </h3>
          <div className="bg-orange-950/20 border border-orange-700/30 rounded-xl p-4">
            <p className="text-orange-200/80 text-sm mb-1 font-bold">동사무소 / 읍사무소 / 면사무소 → 주민센터</p>
            <p className="text-gray-500 text-xs mb-4">base_lists 전체의 note·address 필드에서 구식 명칭을 일괄 변경합니다.</p>
            {migrationStatus === 'running' && (
              <div className="flex items-center gap-2 text-orange-400 text-sm mb-3">
                <RefreshCw size={14} className="animate-spin"/> 마이그레이션 진행 중...
                {typeof migrationStatus === 'object' && <span className="text-xs text-gray-500">스캔 {migrationStatus.done}건 / 변경 {migrationStatus.updated}건</span>}
              </div>
            )}
            {migrationStatus && migrationStatus !== 'running' && typeof migrationStatus === 'object' && (
              <div className={`text-sm mb-3 font-bold ${migrationStatus.error ? 'text-red-400' : 'text-emerald-400'}`}>
                {migrationStatus.error
                  ? `오류: ${migrationStatus.error}`
                  : `완료 — 스캔 ${migrationStatus.done}건 / 변경 ${migrationStatus.updated}건`}
              </div>
            )}
            <button
              onClick={runOfficeMigration}
              disabled={migrationStatus === 'running'}
              className="px-4 py-2 bg-orange-900/60 border border-orange-600/50 text-orange-300 font-black rounded-xl hover:bg-orange-800/60 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={migrationStatus === 'running' ? 'animate-spin' : ''}/> 마이그레이션 실행
            </button>
          </div>

          {/* 특이사항 주소괄호(법정동, 건물명) 오염 제거 */}
          <div className="bg-rose-950/20 border border-rose-700/30 rounded-xl p-4 mt-3">
            <p className="text-rose-200/80 text-sm mb-1 font-bold">특이사항 정리 — 주소 괄호(법정동, 건물명) 오염 제거</p>
            <p className="text-gray-500 text-xs mb-4">버그로 특이사항/비고에 들어간 "답십리1동, 래미안위브" 같은 조각을 base_lists·cloud_lists 전체에서 삭제합니다. 실제 메모는 보존됩니다.</p>
            {noteCleanStatus === 'running' && (
              <div className="flex items-center gap-2 text-rose-400 text-sm mb-3">
                <RefreshCw size={14} className="animate-spin"/> 정리 진행 중...
                {typeof noteCleanStatus === 'object' && <span className="text-xs text-gray-500">스캔 {noteCleanStatus.done}건 / 정리 {noteCleanStatus.updated}건</span>}
              </div>
            )}
            {noteCleanStatus && noteCleanStatus !== 'running' && typeof noteCleanStatus === 'object' && (
              <div className={`text-sm mb-3 font-bold ${noteCleanStatus.error ? 'text-red-400' : 'text-emerald-400'}`}>
                {noteCleanStatus.error
                  ? `오류: ${noteCleanStatus.error}`
                  : `완료 — 스캔 ${noteCleanStatus.done}건 / 정리 ${noteCleanStatus.updated}건`}
              </div>
            )}
            <button
              onClick={runNoteCleanMigration}
              disabled={noteCleanStatus === 'running'}
              className="px-4 py-2 bg-rose-900/60 border border-rose-600/50 text-rose-300 font-black rounded-xl hover:bg-rose-800/60 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={noteCleanStatus === 'running' ? 'animate-spin' : ''}/> 특이사항 정리 실행
            </button>
          </div>

          {/* 소속사·기업 단일 모델 통합 (Phase 0 — 추가 전용·재실행 안전) */}
          <div className="bg-sky-950/20 border border-sky-700/30 rounded-xl p-4 mt-3">
            <p className="text-sky-200/80 text-sm mb-1 font-bold">소속사 · 기업 단일 모델 통합</p>
            <p className="text-gray-500 text-xs mb-4">기존 기업에 welshareMember 백필 + 소속사를 기업 문서로 생성합니다. 사용자·기사·기존 데이터는 보존되며 재실행해도 안전합니다.</p>
            {companyMigStatus === 'running' && (
              <div className="flex items-center gap-2 text-sky-400 text-sm mb-3">
                <RefreshCw size={14} className="animate-spin"/> 통합 진행 중...
              </div>
            )}
            {companyMigStatus && companyMigStatus !== 'running' && typeof companyMigStatus === 'object' && (
              <div className={`text-sm mb-3 font-bold ${companyMigStatus.error ? 'text-red-400' : 'text-emerald-400'}`}>
                {companyMigStatus.error
                  ? `오류: ${companyMigStatus.error}`
                  : `완료 — 백필 ${companyMigStatus.backfilled}건 / 소속사 기업화 ${companyMigStatus.orgCreated}건 (스킵 ${companyMigStatus.orgSkipped})`}
              </div>
            )}
            <button
              onClick={runCompanyUnifyMigration}
              disabled={companyMigStatus === 'running'}
              className="px-4 py-2 bg-sky-900/60 border border-sky-600/50 text-sky-300 font-black rounded-xl hover:bg-sky-800/60 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={companyMigStatus === 'running' ? 'animate-spin' : ''}/> 소속사·기업 통합 실행
            </button>
          </div>

          {/* 개인 권한 → 정식 기업 무손실 승격 */}
          <div className="bg-emerald-950/20 border border-emerald-700/30 rounded-xl p-4 mt-3">
            <p className="text-emerald-200/80 text-sm mb-1 font-bold">개인 권한 → 정식 기업 승격 (무손실)</p>
            <p className="text-gray-500 text-xs mb-4">개인에게 자동 생성됐던 기업을 정식 기업으로 올려 목록에 표시합니다. 현재 등급·지역·담당자 그대로 보존되며 재실행해도 안전합니다.</p>
            {promoteMigStatus === 'running' && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm mb-3">
                <RefreshCw size={14} className="animate-spin"/> 승격 진행 중...
              </div>
            )}
            {promoteMigStatus && promoteMigStatus !== 'running' && typeof promoteMigStatus === 'object' && (
              <div className={`text-sm mb-3 font-bold ${promoteMigStatus.error ? 'text-red-400' : 'text-emerald-400'}`}>
                {promoteMigStatus.error ? `오류: ${promoteMigStatus.error}` : `완료 — 정식 기업으로 승격 ${promoteMigStatus.promoted}건`}
              </div>
            )}
            <button
              onClick={runPromotePersonalCompanies}
              disabled={promoteMigStatus === 'running'}
              className="px-4 py-2 bg-emerald-900/60 border border-emerald-600/50 text-emerald-300 font-black rounded-xl hover:bg-emerald-800/60 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={promoteMigStatus === 'running' ? 'animate-spin' : ''}/> 개인 기업 승격 실행
            </button>
          </div>
        </div>

        {/* 최근 배치 저장 로그 */}
        <div>
          <h3 className="text-gray-400 font-black text-base flex items-center gap-2 mb-3">
            <Zap size={18}/> 최근 배치 저장 로그
          </h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#333]">
            {auditLogs.slice(0, 50).map(log => (
              <div key={log.id} className="flex items-center justify-between px-4 py-2 bg-black/30 border border-[#0f1a2e] rounded-lg text-xs hover:bg-white/3">
                <div className="flex items-center gap-3">
                  <span className="text-[#3b82f6] font-black">{log.city || '-'}</span>
                  <span className="text-gray-600 font-mono text-[10px]">{log.adminEmail || '-'}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-blue-400">+{log.addCount || 0}</span>
                  <span className="text-amber-400">~{log.updateCount || 0}</span>
                  <span className="text-gray-600 font-mono">{fmt(log.timestamp || log.createdAt)}</span>
                </div>
              </div>
            ))}
            {auditLogs.length === 0 && !auditLoading && (
              <p className="text-center text-gray-700 py-6 text-xs">기록된 로그가 없습니다.</p>
            )}
          </div>
        </div>

        {/* 최근 클라이언트 오류 로그 — "모르게 생기는 에러" 가시화 */}
        <div>
          <h3 className="text-gray-400 font-black text-base flex items-center gap-2 mb-3">
            <span className="text-red-400">⚠</span> 최근 오류 로그
            {errorLogs.length > 0 && (
              <span className="text-red-400 text-xs font-bold bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">{errorLogs.length}건</span>
            )}
            <button onClick={fetchErrorLogs} className="ml-auto text-[11px] text-gray-500 hover:text-gray-300 font-bold flex items-center gap-1">
              <RefreshCw size={12} className={errorLoading ? 'animate-spin' : ''}/> 새로고침
            </button>
          </h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#333]">
            {errorLogs.slice(0, 50).map(log => (
              <div key={log.id} className="px-4 py-2 bg-red-950/20 border border-red-900/30 rounded-lg text-xs hover:bg-red-950/30">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-red-300 font-bold truncate" title={log.message}>{log.message || '-'}</span>
                  <span className="text-gray-600 font-mono text-[10px] shrink-0">{fmt(log.timestamp)}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
                  <span className="text-amber-500/80">{log.source || '-'}</span>
                  <span className="font-mono">{log.appVersion || '-'}</span>
                  <span className="font-mono truncate">{log.userEmail || '-'}</span>
                </div>
              </div>
            ))}
            {errorLogs.length === 0 && !errorLoading && (
              <p className="text-center text-gray-700 py-6 text-xs">기록된 오류가 없습니다. 👍</p>
            )}
          </div>
        </div>
      </div>
  );
}
