'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createShell, CommandFailed } = require('../src/shell');
const { readConfig } = require('../src/config');
const { runChecks } = require('../src/run');
const checks = require('../src/checks');
const { workspace } = require('./helpers');

const hasPhp = spawnSync('php', ['-v']).status === 0;

test('the shell returns output, echoes it and fails on a non-zero exit', async () => {
  const written = [];
  const sh = createShell((text) => written.push(text));
  const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(Number(process.argv[1]))';

  const ok = await sh.exec(process.execPath, ['-e', script, '0']);
  assert.equal(ok.stdout, 'out');
  assert.equal(ok.output.length, 6);
  assert.equal(written.join('').length, 6);

  await assert.rejects(sh.exec(process.execPath, ['-e', script, '3']), CommandFailed);
  assert.equal((await sh.exec(process.execPath, ['-e', script, '3'], { allowFailure: true })).code, 3);

  written.length = 0;
  await sh.exec(process.execPath, ['-e', script, '0'], { echo: false });
  assert.deepEqual(written, []);

  await assert.rejects(sh.exec('mec-command-that-does-not-exist'), CommandFailed);
});

test('standard output can go to a file instead of the log', async () => {
  const { root } = workspace();
  const written = [];
  const file = path.join(root, 'report.json');
  await createShell((text) => written.push(text)).exec(process.execPath, ['-e', 'console.log("{}"); console.error("note")'], { stdoutFile: file });
  assert.equal(fs.readFileSync(file, 'utf8'), '{}\n');
  assert.equal(written.join(''), 'note\n');
});

test('lint passes on valid PHP and names the number of broken files', { skip: !hasPhp }, async () => {
  const { env } = workspace({ 'view/templates/broken.phtml': '<?php if (' });
  const config = readConfig({ ...env, MEC_MAGENTO_VERSION: '', MEC_CHECKS: 'lint' });
  const output = [];
  const result = await runChecks(config, checks, { write: (text) => output.push(text) });
  assert.equal(result.status, 'failed');
  assert.equal(result.ran[0].note, '1 of 3 files have syntax errors');
  assert.match(output.join(''), /broken\.phtml/);

  const clean = workspace();
  const passed = await runChecks(readConfig({ ...clean.env, MEC_MAGENTO_VERSION: '', MEC_CHECKS: 'lint' }), checks, { write: () => {} });
  assert.deepEqual(passed.ran.map((row) => [row.status, row.note]), [['passed', '2 files']]);
});
