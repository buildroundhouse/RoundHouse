const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(`${__dirname}/preview.cjs`, 'utf8');

async function daemon(portBusy = false) {
  let handler;
  const launches = [], timers = [], kills = [], exits = [];
  const probe = new EventEmitter(); probe.destroy = () => {};
  const processMock = new EventEmitter();
  Object.assign(processMock, { argv: ['node', 'preview.cjs', '--daemon'], getuid: () => 1000,
    env: {}, kill: (...args) => kills.push(args), exit: code => exits.push(code) });
  const mocks = {
    'node:fs': { mkdirSync() {}, unlinkSync() {} },
    'node:net': {
      createServer(fn) { handler = fn; return { on() {}, listen(_socket, ready) { ready(); } }; },
      createConnection() { return probe; },
    },
    'node:child_process': { spawn(command, args, options) {
      const child = new EventEmitter(); child.pid = 1234;
      launches.push({ command, args, options, child }); return child;
    } },
  };
  vm.runInNewContext(source, { require: name => mocks[name] || require(name),
    __dirname, __filename: `${__dirname}/preview.cjs`, process: processMock,
    console: { log() {}, error() {} }, setTimeout(fn, delay) { timers.push({ fn, delay }); return 1; },
    clearTimeout() {}, setImmediate: fn => fn(), });
  await new Promise(resolve => setImmediate(resolve));
  probe.emit(portBusy ? 'connect' : 'error', { code: 'ECONNREFUSED' });
  return { launches, timers, kills, exits, command(command) {
    const client = new EventEmitter(); client.setTimeout = () => {}; client.end = text => { client.response = text; };
    handler(client); client.emit('data', Buffer.from(command)); return client.response;
  } };
}

test('does not replace a server already on port 8081', async () => {
  const runner = await daemon(true);
  assert.equal(runner.launches.length, 0);
  assert.match(runner.command('status'), /already running/);
});
test('starts detached Expo, retries crashes with backoff, and limits rapid failures', async () => {
  const runner = await daemon();
  assert.equal(runner.launches[0].options.detached, true);
  assert.equal(runner.launches[0].options.stdio[0], 'ignore');
  assert.ok(runner.launches[0].args.includes('--tunnel'));
  for (let i = 0; i < 5; i++) {
    runner.launches[i].child.emit('close', 1);
    if (i < 4) runner.timers[i].fn();
  }
  assert.equal(runner.launches.length, 5);
  assert.equal(runner.timers.length, 4);
  assert.match(runner.command('status'), /failed repeatedly/);
});
test('stop signals only its own child process group', async () => {
  const runner = await daemon();
  assert.match(runner.command('stop'), /Stopping/);
  assert.deepEqual(runner.kills, [[-1234, 'SIGTERM']]);
  runner.launches[0].child.emit('close', 0);
  assert.deepEqual(runner.exits, [0]);
});
