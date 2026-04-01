#!/usr/bin/env node

/**
 * Trakend OS Setup Script
 * =======================
 * First-run setup for Trakend OS. Installs dependencies, initializes the database,
 * and prepares the system for operation.
 *
 * Usage: node scripts/setup.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function log(msg) {
  console.log(`\x1b[36m[Trakend OS Setup]\x1b[0m ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
}

function error(msg) {
  console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function checkPrerequisites() {
  log('Checking prerequisites...');

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major < 18) {
    error(`Node.js 18+ required. Found: ${nodeVersion}`);
    process.exit(1);
  }
  success(`Node.js ${nodeVersion}`);

  // Check npm
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
    success(`npm ${npmVersion}`);
  } catch {
    error('npm not found');
    process.exit(1);
  }

  // Check git
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
    success(gitVersion);
  } catch {
    warn('git not found — update system will not work');
  }

  // Check Docker
  try {
    const dockerVersion = execSync('docker --version', { encoding: 'utf-8' }).trim();
    success(dockerVersion);
  } catch {
    warn('Docker not found — container management will be limited');
  }

  // Check if Docker socket is accessible
  if (fs.existsSync('/var/run/docker.sock')) {
    success('Docker socket accessible');
  } else {
    warn('Docker socket not found at /var/run/docker.sock');
  }
}

function installDependencies() {
  log('Installing backend dependencies...');
  execSync('npm install', { cwd: BACKEND, stdio: 'inherit' });
  success('Backend dependencies installed');

  log('Installing frontend dependencies...');
  execSync('npm install', { cwd: FRONTEND, stdio: 'inherit' });
  success('Frontend dependencies installed');
}

function setupEnvironment() {
  log('Setting up environment...');

  // Backend .env
  const backendEnvExample = path.join(BACKEND, '.env.example');
  const backendEnv = path.join(BACKEND, '.env');
  if (!fs.existsSync(backendEnv) && fs.existsSync(backendEnvExample)) {
    fs.copyFileSync(backendEnvExample, backendEnv);
    success('Backend .env created from .env.example');
  } else if (fs.existsSync(backendEnv)) {
    success('Backend .env already exists');
  }

  // Frontend .env
  const frontendEnvExample = path.join(FRONTEND, '.env.example');
  const frontendEnv = path.join(FRONTEND, '.env');
  if (!fs.existsSync(frontendEnv) && fs.existsSync(frontendEnvExample)) {
    fs.copyFileSync(frontendEnvExample, frontendEnv);
    success('Frontend .env created from .env.example');
  } else if (fs.existsSync(frontendEnv)) {
    success('Frontend .env already exists');
  }

  // Create data directories
  const dataDir = path.join(ROOT, 'data');
  const dirs = [dataDir, path.join(dataDir, 'db'), path.join(dataDir, 'logs')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      success(`Created ${dir}`);
    }
  }
}

function buildProject() {
  log('Building backend...');
  try {
    execSync('npm run build', { cwd: BACKEND, stdio: 'inherit' });
    success('Backend built');
  } catch {
    warn('Backend build failed — you can build later with: npm run build:backend');
  }

  log('Building frontend...');
  try {
    execSync('npm run build', { cwd: FRONTEND, stdio: 'inherit' });
    success('Frontend built');
  } catch {
    warn('Frontend build failed — you can build later with: npm run build:frontend');
  }
}

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Trakend OS Setup v1.0        ║');
  console.log('  ║     Server Management Platform       ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  checkPrerequisites();
  console.log('');

  installDependencies();
  console.log('');

  setupEnvironment();
  console.log('');

  const shouldBuild = await ask('Build the project now? (y/n): ');
  if (shouldBuild.toLowerCase() === 'y') {
    buildProject();
  }
  console.log('');

  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Setup Complete!               ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  log('Default login credentials:');
  log('  Username: admin');
  log('  Password: trakend');
  log('  (Change this immediately after first login!)');
  console.log('');
  log('To start in development mode:');
  log('  npm run dev');
  console.log('');
  log('To start in production mode:');
  log('  npm run build && npm start');
  console.log('');

  rl.close();
}

main().catch((err) => {
  error(`Setup failed: ${err.message}`);
  rl.close();
  process.exit(1);
});
