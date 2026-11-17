'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CheckFailed } = require('../errors');
const { testDirectories } = require('../extension');
const { junitTotals } = require('../reports');
const { HELPERS } = require('./magento');

function unitConfiguration(directories) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<phpunit bootstrap="./framework/bootstrap.php" colors="false">',
    '    <testsuites>',
    '        <testsuite name="extension">',
    ...directories.map((directory) => `            <directory>${directory.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</directory>`),
    '        </testsuite>',
    '    </testsuites>',
    '    <php>',
    '        <ini name="date.timezone" value="UTC"/>',
    '    </php>',
    '</phpunit>',
    '',
  ].join('\n');
}

/**
 * Runs the PHPUnit that the Magento release resolved. Zero executed tests is a failure.
 */
async function runPhpunit(ctx, name, args, cwd) {
  const { config } = ctx;
  const binary = path.join(config.magentoRoot, 'vendor', 'bin', 'phpunit');
  const junit = path.join(config.results, `${name}.junit.xml`);
  const run = await ctx.sh.exec(binary, [...args, '--log-junit', junit, ...(config.testdox ? ['--testdox'] : [])], { cwd, allowFailure: true });
  let xml = '';
  try {
    xml = fs.readFileSync(junit, 'utf8');
  } catch {
    xml = '';
  }
  const totals = junitTotals(xml);
  const version = (/PHPUnit [0-9.]+/.exec((await ctx.sh.exec(binary, ['--version'], { echo: false, allowFailure: true })).stdout) || ['PHPUnit'])[0];
  if (totals.tests === 0) {
    throw new CheckFailed(`${version}: no tests were run`);
  }
  const note = `${version} (from Magento ${config.magentoVersion}); ${totals.tests} tests, ${totals.assertions} assertions, ${totals.broken} failing`;
  return { status: run.code === 0 ? 'passed' : 'failed', note };
}

async function unit(ctx) {
  const { config } = ctx;
  const directories = testDirectories(ctx.installedPath(), 'Unit');
  if (directories.length === 0) {
    return { status: 'skipped', note: 'no Test/Unit directory' };
  }
  const configuration = path.join(config.magentoRoot, 'dev', 'tests', 'unit', 'phpunit.extension-check.xml');
  fs.writeFileSync(configuration, unitConfiguration(directories));
  return runPhpunit(ctx, 'unit', ['-c', configuration], config.magentoRoot);
}

async function integration(ctx) {
  const { config } = ctx;
  const { database, search } = config;
  const directories = testDirectories(ctx.installedPath(), 'Integration');
  if (directories.length === 0) {
    return { status: 'skipped', note: 'no Test/Integration directory' };
  }
  // Magento creates triggers during installation, which MySQL refuses with binary logging on.
  const prepared = await ctx.sh.exec('mysql', ['--protocol=tcp', '-h', database.host, '-P', database.port, '-u', database.user,
    '-e', `SET GLOBAL log_bin_trust_function_creators = 1; CREATE DATABASE IF NOT EXISTS \`${database.name}\`;`],
  { env: { MYSQL_PWD: database.password }, allowFailure: true }).catch(() => ({ code: 127 }));
  if (prepared.code !== 0 && prepared.code !== 127) {
    throw new CheckFailed(`database at ${database.host}:${database.port} is not reachable; the job needs a MySQL or MariaDB service`);
  }
  try {
    const response = await fetch(`http://${search.host}:${search.port}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
  } catch {
    throw new CheckFailed(`search engine at ${search.host}:${search.port} is not reachable; the job needs an OpenSearch service`);
  }
  const tests = path.join(config.magentoRoot, 'dev', 'tests', 'integration');
  const configuration = path.join(tests, 'phpunit.extension-check.xml');
  await ctx.sh.exec('php', [path.join(HELPERS, 'integration-config.php'), config.magentoRoot, configuration, ...directories], {
    env: {
      MEC_DB_HOST: database.host,
      MEC_DB_PORT: database.port,
      MEC_DB_USER: database.user,
      MEC_DB_PASSWORD: database.password,
      MEC_DB_NAME: database.name,
      MEC_SEARCH_ENGINE: search.engine,
      MEC_SEARCH_HOST: search.host,
      MEC_SEARCH_PORT: search.port,
    },
  });
  return runPhpunit(ctx, 'integration', ['-c', configuration], tests);
}

module.exports = { unit, integration, unitConfiguration };
