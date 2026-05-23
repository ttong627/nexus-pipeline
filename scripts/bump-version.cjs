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
  if (bumpType === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
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

const main = () => {
  const bumpType = (process.env.VERSION_BUMP || 'patch').toLowerCase();
  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    throw new Error('VERSION_BUMP must be patch, minor, or major.');
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

  console.log(`[version] ${previousVersion} -> ${nextVersion} (${appVersion}, ${buildTime} KST)`);
};

main();
