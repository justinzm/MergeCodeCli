#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const targetPlatform = String(process.env.CLI_TARGET_PLATFORM || process.platform).toLowerCase();
const targetArch = String(process.env.CLI_TARGET_ARCH || process.arch).toLowerCase();
const key = `${targetPlatform}-${targetArch}`;

const outputRoot = path.join(rootDir, 'build', 'cli-runtime', key);
const workDir = path.join(rootDir, '.tmp', 'cli-runtime', key);

const cliVersions = {
  '@anthropic-ai/claude-code': '2.1.98',
  '@openai/codex': '0.121.0',
  '@google/gemini-cli': '0.35.3'
};

function run(cmd, args, cwd, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_platform: targetPlatform,
      npm_config_arch: targetArch,
      ...extraEnv
    }
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function ensureCleanDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function writePackageJson(target) {
  const pkg = {
    name: 'mergecodecli-cli-runtime',
    private: true,
    description: 'Bundled CLI runtime for MergeCodeCli',
    version: '0.0.0',
    dependencies: cliVersions
  };
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2));
}

function writeManifest(target) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: targetPlatform,
    arch: targetArch,
    cliVersions
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function walkDir(root, onEntry) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      onEntry(full, entry);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      }
    }
  }
}

function pruneRuntime(target) {
  const symlinks = [];
  const binDirs = [];

  walkDir(target, (full, entry) => {
    if (entry.isSymbolicLink()) symlinks.push(full);
    if (entry.isDirectory() && entry.name === ".bin") binDirs.push(full);
  });

  for (const binDir of binDirs) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
  for (const link of symlinks) {
    fs.rmSync(link, { force: true });
  }
}

function main() {
  console.log(`[cli-runtime] Preparing runtime for ${key}`);
  ensureCleanDir(workDir);
  writePackageJson(workDir);

  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], workDir, {
    npm_config_update_notifier: 'false'
  });

  ensureCleanDir(outputRoot);

  for (const fileName of ['package.json', 'package-lock.json']) {
    const src = path.join(workDir, fileName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outputRoot, fileName));
    }
  }

  const srcNodeModules = path.join(workDir, 'node_modules');
  if (!fs.existsSync(srcNodeModules)) {
    throw new Error('[cli-runtime] Missing node_modules after npm install');
  }
  fs.cpSync(srcNodeModules, path.join(outputRoot, 'node_modules'), {
    recursive: true,
    dereference: true
  });
  pruneRuntime(outputRoot);

  writeManifest(outputRoot);
  console.log(`[cli-runtime] Runtime ready at ${outputRoot}`);
}

main();
