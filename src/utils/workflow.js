export const WORKFLOW_MODES = {
  cleaningOnly: {
    id: 'cleaningOnly',
    title: '정제 명단 만들기',
    shortTitle: '정제 명단',
    tone: 'emerald',
    description: '주소를 표준화하고 오류를 골라낸 뒤 저장하거나 엑셀로 내려받습니다.',
    steps: ['upload', 'cleaning', 'issues', 'saveExport'],
  },
  geoOnly: {
    id: 'geoOnly',
    title: '위치까지 확인하기',
    shortTitle: '위치 확인',
    tone: 'cyan',
    description: '정제된 주소에 좌표를 붙이고 지도에서 위치를 확인합니다.',
    steps: ['upload', 'cleaning', 'issues', 'geocode', 'mapPreview', 'saveExport'],
  },
  deliveryFull: {
    id: 'deliveryFull',
    title: '배송 배정까지 하기',
    shortTitle: '배송 배정',
    tone: 'amber',
    description: '좌표를 기준으로 기사 구역과 배송순번까지 확정합니다.',
    steps: ['upload', 'cleaning', 'issues', 'geocode', 'drivers', 'assignment', 'sequence', 'qualityCheck', 'finalSave'],
  },
};

export const WORKFLOW_STEP_LABELS = {
  upload: '명단 업로드',
  cleaning: '주소 정제',
  issues: '오류 검토',
  geocode: '좌표 매칭',
  mapPreview: '지도 확인',
  drivers: '기사 설정',
  assignment: '기사 배정',
  sequence: '배송순번',
  qualityCheck: '품질 점검',
  saveExport: '저장/다운로드',
  finalSave: '최종 저장',
};

export const getWorkflowMode = (mode) => WORKFLOW_MODES[mode] || WORKFLOW_MODES.cleaningOnly;

export const buildStepStatus = ({ step, gridData = [], fileInfo = null, worksheets = [] }) => {
  const rows = Array.isArray(gridData) ? gridData : [];
  const total = rows.length;
  const coordTarget = rows.filter(r => !r._isApt).length;
  const coordCount = rows.filter(r => r._lat && r._lng).length;
  const driverCount = rows.filter(r => (r.기사 || '').trim()).length;
  const sequenceCount = rows.filter(r => String(r.배송순번 || '').trim()).length;
  const errorCount = rows.filter(r => r._에러).length;

  return {
    upload: fileInfo || worksheets.length ? 'done' : step >= 1 ? 'active' : 'pending',
    cleaning: step === 4 ? 'running' : total > 0 ? 'done' : step >= 2 ? 'active' : 'pending',
    issues: total > 0 ? (errorCount > 0 ? 'attention' : 'done') : 'locked',
    geocode: total === 0 ? 'locked' : coordTarget > 0 && coordCount < coordTarget ? 'attention' : 'done',
    mapPreview: total === 0 ? 'locked' : coordCount > 0 ? 'done' : 'pending',
    drivers: total === 0 ? 'locked' : driverCount > 0 ? 'done' : 'pending',
    assignment: total === 0 ? 'locked' : driverCount > 0 ? 'done' : 'pending',
    sequence: total === 0 ? 'locked' : sequenceCount > 0 ? 'done' : 'pending',
    qualityCheck: total === 0 ? 'locked' : errorCount > 0 ? 'attention' : 'done',
    saveExport: total > 0 ? 'active' : 'locked',
    finalSave: total === 0 ? 'locked' : driverCount > 0 && sequenceCount > 0 ? 'done' : 'pending',
    metrics: {
      total,
      errorCount,
      coordCount,
      coordTarget,
      driverCount,
      sequenceCount,
    },
  };
};

export const getVisibleWorkflowSteps = (mode) => getWorkflowMode(mode).steps;

export const getWorkflowMeta = (mode, stepStatus) => ({
  mode: getWorkflowMode(mode).id,
  modeLabel: getWorkflowMode(mode).title,
  completedSteps: Object.entries(stepStatus || {})
    .filter(([key, value]) => key !== 'metrics' && value === 'done')
    .map(([key]) => key),
  stepStatus: Object.fromEntries(
    Object.entries(stepStatus || {}).filter(([key]) => key !== 'metrics')
  ),
  metrics: stepStatus?.metrics || {},
  workflowVersion: '2026-05-23-purpose-flow-v1',
});
