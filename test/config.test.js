'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readConfig } = require('../src/config');
const { workspace } = require('./helpers');

test('reads a valid configuration with defaults', () => {
  const { env, extension } = workspace();
  const config = readConfig(env);
  assert.equal(config.extension, extension);
  assert.equal(config.extensionName, 'acme/module-demo');
  assert.equal(config.label, 'Magento 2.4.8-p5 @ PHP 8.4');
  assert.equal(config.results, path.join(env.MEC_WORK_DIR, 'results'));
  assert.deepEqual(config.locales, ['en_US']);
  assert.equal(config.phpcs.scope, 'changed');
  assert.equal(config.annotations, true);
  assert.equal(config.testdox, false);
  assert.equal(config.stepSummary, true);
});

test('label without a Magento release names PHP only', () => {
  const { env } = workspace();
  assert.equal(readConfig({ ...env, MEC_MAGENTO_VERSION: '', MEC_CHECKS: 'validate' }).label, 'PHP 8.4');
});

for (const [name, override, message] of [
  ['php version', { MEC_PHP_VERSION: '8' }, /php-version/],
  ['magento version', { MEC_MAGENTO_VERSION: '2.4' }, /magento-version/],
  ['severity', { MEC_PHPCS_SEVERITY: 'high' }, /phpcs-severity/],
  ['level', { MEC_PHPSTAN_LEVEL: '11' }, /phpstan-level/],
  ['scope', { MEC_PHPCS_SCOPE: 'some' }, /phpcs-scope/],
  ['annotations', { MEC_ANNOTATIONS: 'yes' }, /annotations/],
  ['testdox', { MEC_PHPUNIT_TESTDOX: '1' }, /testdox/],
  ['locales', { MEC_LOCALES: 'en_US; rm -rf /' }, /locales/],
  ['database name', { MEC_DB_NAME: 'a`b' }, /db-name/],
  ['search engine', { MEC_SEARCH_ENGINE: 'solr' }, /search-engine/],
  ['path outside the workspace', { MEC_PATH: '..' }, /inside the workspace/],
  ['missing path', { MEC_PATH: 'nope' }, /does not exist/],
]) {
  test(`refuses an invalid ${name}`, () => {
    const { env } = workspace();
    assert.throws(() => readConfig({ ...env, ...override }), message);
  });
}

test('refuses a package without a valid name or composer.json', () => {
  assert.throws(() => readConfig(workspace({ 'composer.json': '{"name": "Not Valid"}' }).env), /valid package name/);
  assert.throws(() => readConfig(workspace({ 'composer.json': null }).env), /No composer.json/);
});

test('step summaries can be turned off', () => {
  const { env } = workspace();
  assert.equal(readConfig({ ...env, MAGENTO_EXTENSION_CHECK_SUMMARY: 'false' }).stepSummary, false);
});
