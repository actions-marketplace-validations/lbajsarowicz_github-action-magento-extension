'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildReport, renderMarkdown, CHECKS } = require('./render');

const LOG_LINES = 40;
const LOG_CHARACTERS = 6000;

function input(name, fallback) {
  const value = process.env[`INPUT_${name.toUpperCase()}`];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function findResults(directory, depth = 0) {
  if (depth > 3 || !fs.existsSync(directory)) {
    return [];
  }
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...findResults(full, depth + 1));
    } else if (entry.isFile() && entry.name === 'results.json') {
      found.push(full);
    }
  }
  return found;
}

function readResult(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const logs = {};
  for (const check of checks) {
    if (check.status !== 'failed' || !/^[a-z-]+$/.test(String(check.check))) {
      continue;
    }
    const log = path.join(path.dirname(file), `${check.check}.log`);
    if (fs.existsSync(log)) {
      logs[check.check] = fs.readFileSync(log, 'utf8').split('\n').slice(-LOG_LINES).join('\n').slice(-LOG_CHARACTERS);
    }
  }
  return { magento: data.magento || null, php: String(data.php), checks, logs };
}

function expectedCells(matrix) {
  if (matrix === '') {
    return [];
  }
  const parsed = JSON.parse(matrix);
  const cells = Array.isArray(parsed) ? parsed : parsed.include;
  if (!Array.isArray(cells)) {
    throw new Error('matrix must be the JSON output of the matrix action.');
  }
  return cells.filter((cell) => cell && cell.php).map((cell) => ({ magento: cell.magento || null, php: String(cell.php) }));
}

function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const directory = path.resolve(workspace, input('path', 'magento-check-results'));
  const results = findResults(directory).map(readResult);
  const expectedChecks = input('checks', '').split(/[\s,]+/).filter(Boolean);
  const unknown = expectedChecks.filter((name) => !CHECKS.some(([check]) => check === name));
  if (unknown.length > 0) {
    throw new Error(`checks names unknown checks: ${unknown.join(', ')}.`);
  }
  const report = buildReport(expectedCells(input('matrix', '')), results, expectedChecks);
  const markdown = renderMarkdown(report, input('title', 'Magento Check'));

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${report.status}\n`);
  }

  for (const row of report.rows) {
    const marks = row.outcomes.map((outcome) => `${outcome.title}: ${outcome.status.replace('-', ' ')}`).join(', ');
    console.log(`${row.failed ? 'FAILED' : 'passed'}  ${row.label}  ${marks}`);
  }
  if (report.status !== 'passed') {
    const reason = report.rows.length === 0
      ? 'No results were found.'
      : `${report.failedCount} of ${report.rows.length} version combinations failed. The job summary shows which checks.`;
    console.log(`::error title=Magento Check::${reason}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.log(`::error title=Magento Check::${String(error.message).replace(/[\r\n]+/g, ' ')}`);
  process.exitCode = 1;
}
