const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packagePath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
const versionPath = path.join(rootDir, 'src', 'version.js');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const pad2 = (value) => String(value).padStart(2, '0');
const getKstParts = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}.${map.month}.${map.day}`,
    time: `${map.year}.${map.month}.${map.day} ${map.hour}:${map.minute}`,
  };
};

const parseSemver = (version) => {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`package.json version must be semver x.y.z. Current value: ${version}`);
  }
  return match.slice(1).map(Number);
};

const bumpVersion = ([major, minor, patch], bumpType) => {
  if (bumpType === 'major') return [major + 1, 0, 0];
  if (bumpType === 'patch') return [major, minor, patch + 1];
  // 'minor'(기본) — 빠른 버전업. 표기는 V{major}.{minor} 2자리 유지.
  // minor가 100에 도달하면 major를 올리고 minor=0 으로 롤오버(번호가 과도하게 커지지 않게).
  const nextMinor = minor + 1;
  return nextMinor >= 100 ? [major + 1, 0, 0] : [major, nextMinor, 0];
};

const formatSemver = ([major, minor, patch]) => `${major}.${minor}.${patch}`;
const formatAppVersion = ([major, minor, patch]) => (
  patch === 0 ? `V${major}.${minor}` : `V${major}.${minor}.${patch}`
);

const updateVersionFile = ({ appVersion, buildDate, buildTime }) => {
  let source = fs.readFileSync(versionPath, 'utf8');

  source = source.replace(
    /export const APP_VERSION = ['"`][^'"`]+['"`];/,
    `export const APP_VERSION = '${appVersion}';`,
  );
  source = source.replace(
    /export const APP_BUILD = ['"`][^'"`]+['"`];/,
    `export const APP_BUILD = '${buildDate}';`,
  );

  if (/export const APP_BUILD_TIME = /.test(source)) {
    source = source.replace(
      /export const APP_BUILD_TIME = ['"`][^'"`]+['"`];/,
      `export const APP_BUILD_TIME = '${buildTime}';`,
    );
  } else {
    source = source.replace(
      /(export const APP_BUILD = ['"`][^'"`]+['"`];\r?\n)/,
      `$1export const APP_BUILD_TIME = '${buildTime}';\n`,
    );
  }

  fs.writeFileSync(versionPath, source, 'utf8');
};

// CHANGELOG 맨 앞에 새 버전 블록을 삽입(append-only — 과거 항목은 절대 수정/삭제하지 않음).
// items 가 비어 있으면 아무것도 하지 않고 false 반환.
const prependChangelog = ({ appVersion, buildDate, items }) => {
  if (!Array.isArray(items) || items.length === 0) return false;

  let source = fs.readFileSync(versionPath, 'utf8');
  const marker = 'export const CHANGELOG = [';
  const idx = source.indexOf(marker);
  if (idx === -1) {
    console.warn('[changelog] CHANGELOG 배열을 찾지 못해 변경내역 삽입을 건너뜁니다.');
    return false;
  }

  // 같은 버전 블록이 이미 있으면 중복 삽입 방지
  if (new RegExp(`\\{\\s*v:\\s*['"\`]${appVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(source)) {
    console.warn(`[changelog] ${appVersion} 블록이 이미 존재하여 삽입을 건너뜁니다.`);
    return false;
  }

  const insertPos = idx + marker.length;
  const itemLines = items
    .map((it) => String(it).trim())
    .filter(Boolean)
    .map((it) => `    ${JSON.stringify(it)},`)
    .join('\n');
  const block = `\n  { v: ${JSON.stringify(appVersion)}, date: ${JSON.stringify(buildDate)}, items: [\n${itemLines}\n  ]},`;

  source = source.slice(0, insertPos) + block + source.slice(insertPos);
  fs.writeFileSync(versionPath, source, 'utf8');
  return true;
};

// 인자 파싱: [patch|minor|major] "변경항목1" "변경항목2" ...
//   - bump 종류: env VERSION_BUMP > 첫 위치인자 > 'minor'
//   - 나머지 인자(또는 --note 뒤): CHANGELOG 항목(있으면 자동 삽입, 없으면 버전/빌드시간만 갱신)
const parseArgs = () => {
  const argv = process.argv.slice(2);
  let bumpType = (process.env.VERSION_BUMP || '').toLowerCase();
  const notes = [];

  for (const raw of argv) {
    const a = String(raw).trim();
    if (!a) continue;
    if (!bumpType && ['patch', 'minor', 'major'].includes(a.toLowerCase())) {
      bumpType = a.toLowerCase();
      continue;
    }
    if (a === '--note' || a === '--notes') continue; // 구분자(무시)
    if (a.startsWith('--')) continue;                 // 기타 플래그 무시
    notes.push(a);
  }

  if (!bumpType) bumpType = 'minor';
  return { bumpType, notes };
};

const main = () => {
  const { bumpType, notes } = parseArgs();
  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    throw new Error('bump 종류는 patch, minor, major 중 하나여야 합니다.');
  }

  const pkg = readJson(packagePath);
  const previousVersion = pkg.version;
  const nextParts = bumpVersion(parseSemver(previousVersion), bumpType);
  const nextVersion = formatSemver(nextParts);
  const appVersion = formatAppVersion(nextParts);
  const { date: buildDate, time: buildTime } = getKstParts();

  pkg.version = nextVersion;
  writeJson(packagePath, pkg);

  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = nextVersion;
    }
    writeJson(lockPath, lock);
  }

  updateVersionFile({ appVersion, buildDate, buildTime });
  const wroteChangelog = prependChangelog({ appVersion, buildDate, items: notes });

  console.log(`[version] ${previousVersion} -> ${nextVersion} (${appVersion}, ${buildTime} KST)`);
  if (wroteChangelog) {
    console.log(`[changelog] ${appVersion} 변경내역 ${notes.length}건 추가됨`);
  } else {
    console.log('[changelog] 변경내역 인자 없음 — 버전/빌드시간만 갱신(CHANGELOG 유지)');
  }
};

main();
