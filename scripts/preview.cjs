#!/usr/bin/env node
// Detached Expo runner for Linux Codespaces. No credentials or .env files are copied.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const id = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
const dir = path.join(os.tmpdir(), `roundhouse-preview-${process.getuid()}-${id}`);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const socket = path.join(dir, 'control.sock');
const log = path.join(dir, 'expo.log');
const action = process.argv[2] || 'start';

function request(command) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socket);
    let data = '';
    client.setTimeout(2000, () => client.destroy(new Error('Preview control timed out')));
    client.on('connect', () => client.write(command));
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => resolve(data));
    client.on('error', reject);
  });
}

async function main() {
  if (action === 'logs') {
    if (fs.existsSync(log)) console.log(fs.readFileSync(log, 'utf8').split('\n').slice(-80).join('\n'));
    else console.log('No preview log yet.');
    return;
  }
  if (!['start', 'status', 'stop', '--daemon'].includes(action)) throw new Error('Use start, status, logs, or stop.');
  if (action !== '--daemon') {
    try { console.log(await request(action === 'stop' ? 'stop' : 'status')); return; }
    catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      if (action !== 'start') { console.log('Preview is stopped.'); return; }
    }
    // A refused connection means the old daemon has exited. Remove only its socket.
    try { fs.unlinkSync(socket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const fd = fs.openSync(log, 'w', 0o600);
    const daemon = spawn(process.execPath, [__filename, '--daemon'], {
      cwd: root, detached: true, stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    daemon.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        console.log(await request('status'));
        console.log('You can close this terminal tab. Keep the Codespace running.');
        console.log('For the current Expo link: node scripts/preview.cjs logs');
        return;
      } catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    }
    throw new Error(`Preview did not start. Read ${log}`);
  }

  let child, timer, stopping = false, failures = 0;
  let state = 'Starting Expo; tunnel readiness is shown in the log.';
  function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} process.exit(0); }, 5000);
    } else process.exit(0);
  }
  const server = net.createServer(client => {
    client.setTimeout(2000, () => client.destroy());
    client.on('error', () => {});
    client.once('data', data => {
      if (data.toString() === 'stop') { client.end('Stopping preview.'); setImmediate(stop); }
      else client.end(`${state}\nLog: ${log}`);
    });
  });
  server.on('error', error => { console.error(error.message); process.exit(1); });
  await new Promise(resolve => server.listen(socket, resolve));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('exit', () => { try { fs.unlinkSync(socket); } catch {} });

  function launch() {
    const started = Date.now();
    state = 'Expo process starting; check logs for tunnel readiness.';
    child = spawn('pnpm', ['exec', 'expo', 'start', '--tunnel', '--port', '8081'], {
      cwd: path.join(root, 'artifacts/round-house'), detached: true,
      stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CI: '1' },
    });
    child.on('error', error => console.error(`Could not launch Expo: ${error.message}`));
    child.once('close', code => {
      if (stopping) { process.exit(0); return; }
      if (Date.now() - started > 60000) failures = 0;
      failures++;
      if (failures >= 5) {
        state = 'Expo failed repeatedly. Fix the error in logs, then stop and start preview.';
        console.error(state); return;
      }
      const delay = Math.min(30000, 2000 * 2 ** (failures - 1));
      state = `Expo exited (${code}); restarting in ${delay / 1000} seconds.`;
      console.log(state);
      timer = setTimeout(launch, delay);
    });
  }
  // Never stop or replace another server already using the Expo port.
  const probe = net.createConnection({ host: '127.0.0.1', port: 8081 });
  probe.on('connect', () => {
    probe.destroy();
    state = 'Port 8081 is already running. Stop your old Expo terminal with Ctrl+C, then stop/start this runner.';
    console.error(state);
  });
  probe.on('error', error => {
    if (error.code === 'ECONNREFUSED') launch();
    else { state = `Cannot check port 8081: ${error.message}`; console.error(state); }
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
