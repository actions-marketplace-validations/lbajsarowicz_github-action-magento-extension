'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectChecks } = require('../src/plan');
const { ConfigError } = require('../src/errors');

test('default with a Magento release', () => {
  assert.deepEqual(selectChecks('default', '2.4.9'), ['validate', 'lint', 'install', 'phpcs', 'compile', 'unit', 'phpstan']);
});

test('default without a Magento release is static only', () => {
  assert.deepEqual(selectChecks('default', ''), ['validate', 'lint', 'phpcs']);
});

test('a Magento check brings install and the order is fixed', () => {
  assert.deepEqual(selectChecks('phpstan, unit', '2.4.9'), ['install', 'unit', 'phpstan']);
  assert.deepEqual(selectChecks('static-content,compile', '2.4.9'), ['install', 'compile', 'static-content']);
});

test('phpcs alone does not need Magento', () => {
  assert.deepEqual(selectChecks('phpcs', ''), ['phpcs']);
});

test('unknown, empty and Magento checks without a release are refused', () => {
  assert.throws(() => selectChecks('compile,nope', '2.4.9'), ConfigError);
  assert.throws(() => selectChecks(' , ', '2.4.9'), /No checks selected/);
  assert.throws(() => selectChecks('compile', ''), /needs magento-version/);
});
