'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, renderMarkdown } = require('../render');

const check = (name, status, note = '') => ({ check: name, status, seconds: 1, note });
const matrix = [
  { magento: '2.4.8-p5', php: '8.4' },
  { magento: '2.4.9', php: '8.5' },
];

test('all combinations passed', () => {
  const report = buildReport(matrix, [
    { magento: '2.4.8-p5', php: '8.4', checks: [check('validate', 'passed'), check('compile', 'passed')], logs: {} },
    { magento: '2.4.9', php: '8.5', checks: [check('validate', 'passed'), check('compile', 'passed')], logs: {} },
  ]);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.columns.map(([name]) => name), ['validate', 'compile']);
  assert.match(renderMarkdown(report, 'Magento Check'), /all 2 version combinations passed/);
});

test('a failed check fails the report and later checks show as not run', () => {
  const report = buildReport(matrix, [
    { magento: '2.4.8-p5', php: '8.4', checks: [check('compile', 'passed'), check('unit', 'passed')], logs: {} },
    { magento: '2.4.9', php: '8.5', checks: [check('compile', 'failed', 'Fatal error')], logs: { compile: 'line <b>' } },
  ]);
  assert.equal(report.status, 'failed');
  assert.equal(report.failedCount, 1);
  assert.deepEqual(report.rows[1].outcomes.map((outcome) => outcome.status), ['failed', 'not-run']);
  const markdown = renderMarkdown(report, 'Magento Check');
  assert.match(markdown, /1 of 2 version combinations failed/);
  assert.match(markdown, /### What failed\n\n---\n\n#### ❌ Magento 2\.4\.9 @ PHP 8\.5\n\n/);
  assert.match(markdown, /\| ❌ \| \*\*Compile\*\* \| Fatal error \|\n\| ⚪ \| Unit tests \| Not run\. \|/);
  assert.match(markdown, /<summary>Compile: last lines of the log<\/summary>/);
  assert.doesNotMatch(markdown, /#### ❌ Magento 2\.4\.8-p5 @ PHP 8\.4/);
  assert.match(markdown, /line &lt;b&gt;/);
});

test('a combination of the matrix without a result fails the report', () => {
  const report = buildReport(matrix, [
    { magento: '2.4.8-p5', php: '8.4', checks: [check('compile', 'passed')], logs: {} },
  ]);
  assert.equal(report.status, 'failed');
  assert.equal(report.rows[1].outcomes[0].status, 'missing');
  assert.match(renderMarkdown(report, 'Magento Check'), /#### ❌ Magento 2\.4\.9 @ PHP 8\.5\n\nThe job uploaded no result/);
});

test('skipped checks do not fail, blocked checks do', () => {
  const skipped = buildReport([], [{ magento: '2.4.9', php: '8.5', checks: [check('unit', 'skipped')], logs: {} }]);
  assert.equal(skipped.status, 'passed');
  const blocked = buildReport([], [{ magento: '2.4.9', php: '8.5', checks: [check('install', 'failed'), check('compile', 'blocked')], logs: {} }]);
  assert.equal(blocked.status, 'failed');
});

test('the failure table of a combination separates skipped from passed checks', () => {
  const report = buildReport([], [
    { magento: '2.4.9', php: '8.5', checks: [check('compile', 'passed'), check('unit', 'skipped'), check('phpstan', 'failed', '13 findings')], logs: {} },
  ]);
  const markdown = renderMarkdown(report, 'Magento Check');
  assert.match(markdown, /\| ❌ \| \*\*PHPStan\*\* \| 13 findings \|\n\| ➖ \| Unit tests \| Nothing to run\. \|\n\| ✅ \| Compile \| Passed\. \|/);
});

test('expected checks that no job reached are shown as not run', () => {
  const report = buildReport(matrix, [
    { magento: '2.4.8-p5', php: '8.4', checks: [check('compile', 'failed')], logs: {} },
    { magento: '2.4.9', php: '8.5', checks: [check('compile', 'failed')], logs: {} },
  ], ['compile', 'unit', 'phpstan']);
  assert.deepEqual(report.columns.map(([name]) => name), ['compile', 'unit', 'phpstan']);
  assert.deepEqual(report.rows[0].outcomes.map((outcome) => outcome.status), ['failed', 'not-run', 'not-run']);
  assert.match(renderMarkdown(report, 'Magento Check'), /\| ⚪ \| PHPStan \| Not run\. \|/);
});

test('no results at all is a failure', () => {
  const report = buildReport([], []);
  assert.equal(report.status, 'failed');
  assert.match(renderMarkdown(report, 'Magento Check'), /No results were found/);
});

test('notes cannot break the table or inject markup', () => {
  const report = buildReport([], [
    { magento: '2.4.9', php: '8.5', checks: [check('unit', 'failed', 'a | b\n<script>')], logs: {} },
  ]);
  const markdown = renderMarkdown(report, 'Magento Check');
  assert.ok(!markdown.includes('<script>'));
  assert.match(markdown, /a \\\| b &lt;script&gt;/);
});

test('a warning passes and shows its note in the failure table', () => {
  const warned = buildReport([], [{ magento: '2.4.9', php: '8.5', checks: [check('unit', 'warning', 'no tests were run')], logs: {} }]);
  assert.equal(warned.status, 'passed');
  const report = buildReport([], [
    { magento: '2.4.9', php: '8.5', checks: [check('unit', 'warning', 'no tests were run'), check('phpstan', 'failed', '1 finding')], logs: {} },
  ]);
  assert.match(renderMarkdown(report, 'Magento Check'), /\| ⚠️ \| Unit tests \| no tests were run \|/);
});
