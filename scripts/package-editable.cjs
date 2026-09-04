#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ZipArchive } = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const displayVersion = packageJson.version.replace('-', ' ').replace(/alpha\.(\d+)/, 'alpha $1');
const releaseName = `DORN AI Windows ${displayVersion} Editable`;
const outputPath = path.resolve(
  process.argv[2] || path.join(projectRoot, '..', `DORN_AI_Windows_${packageJson.version}_Editable.zip`)
);
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dorn-editable-'));
const stagedProject = path.join(stageRoot, releaseName);

function relativeFromRoot(sourcePath) {
  return path.relative(projectRoot, sourcePath).split(path.sep).join('/');
}

function includeInEditable(sourcePath) {
  const relativePath = relativeFromRoot(sourcePath);
  if (!relativePath) return true;

  const [rootEntry] = relativePath.split('/');
  if (rootEntry === '.git' || rootEntry === 'build-cache' || rootEntry === 'tmp') return false;

  // Sólo se excluyen los resultados de la raíz. Las carpetas dist internas de
  // node_modules contienen código compilado y deben conservarse completas.
  if (rootEntry === 'dist') {
    return relativePath === 'dist' || relativePath === 'dist/app.asar';
  }

  return true;
}

function findElectronRuntime() {
  const candidates = [
    path.join(stagedProject, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(stagedProject, 'node_modules', 'electron', 'dist', 'electron'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function createZip() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath, { flags: 'w' });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completion = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.directory(stagedProject, releaseName);
  await archive.finalize();
  await completion;
}

async function main() {
  try {
    fs.cpSync(projectRoot, stagedProject, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
      filter: includeInEditable,
    });

    const runtimePath = findElectronRuntime();
    if (!runtimePath) {
      throw new Error('El editable está incompleto: falta node_modules/electron/dist. Ejecuta npm ci antes de empaquetar.');
    }
    const runtimeSize = fs.statSync(runtimePath).size;
    if (runtimeSize < 150 * 1024 * 1024) {
      throw new Error(`El runtime de Electron parece truncado: ${runtimeSize} bytes.`);
    }
    if (!fs.existsSync(path.join(stagedProject, 'dist', 'app.asar'))) {
      throw new Error('Falta dist/app.asar. Ejecuta npm run pack:asar antes de crear el editable.');
    }

    await createZip();
    const archiveSize = fs.statSync(outputPath).size;
    process.stdout.write(`${outputPath}\n${archiveSize} bytes\n`);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
