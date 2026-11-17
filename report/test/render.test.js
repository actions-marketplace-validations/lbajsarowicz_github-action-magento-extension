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
  assert.match(markdown, /### What failed\n\n#### Magento 2\.4\.9 @ PHP 8\.5\n\n\*\*Compile\*\*: Fatal error\n/);
  assert.match(markdown, /Not run: Unit tests\./);
  assert.equal(markdown.split('#### Magento 2.4.8-p5 @ PHP 8.4').length, 2);
  assert.match(markdown, /line &lt;b&gt;/);
});

test('a combination of the matrix without a result fails the report', () => {
  const report = buildReport(matrix, [
    { magento: '2.4.8-p5', php: '8.4', checks: [check('compile', 'passed')], logs: {} },
  ]);
  assert.equal(report.status, 'failed');
  assert.equal(report.rows[1].outcomes[0].status, 'missing');
  assert.match(renderMarkdown(report, 'Magento Check'), /#### Magento 2\.4\.9 @ PHP 8\.5\n\nThe job uploaded no result/);
});

test('skipped checks do not fail, blocked checks do', () => {
  const skipped = buildReport([], [{ magento: '2.4.9', php: '8.5', checks: [check('unit', 'skipped')], logs: {} }]);
  assert.equal(skipped.status, 'passed');
  const blocked = buildReport([], [{ magento: '2.4.9', php: '8.5', checks: [check('install', 'failed'), check('compile', 'blocked')], logs: {} }]);
  assert.equal(blocked.status, 'failed');
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
