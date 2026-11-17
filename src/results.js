'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FAILING = ['failed', 'blocked'];

function resultsFile(config) {
  return path.join(config.results, 'results.json');
}

function loadChecks(config) {
  try {
    const data = JSON.parse(fs.readFileSync(resultsFile(config), 'utf8'));
    return Array.isArray(data.checks) ? data.checks : [];
  } catch {
    return [];
  }
}

function oneLine(text, limit = 300) {
  return String(text).replace(/[\t\r\n]+/g, ' ').trim().slice(0, limit);
}

/**
 * Adds or replaces the row of one check and keeps the rows of earlier steps of the same job.
 */
function recordCheck(checks, row) {
  return [...checks.filter((existing) => existing.check !== row.check), { ...row, note: oneLine(row.note) }];
}

function overallStatus(checks) {
  return checks.some((check) => FAILING.includes(check.status)) ? 'failed' : 'passed';
}

function saveResults(config, checks, phpRuntime) {
  const previous = (() => {
    try {
      return JSON.parse(fs.readFileSync(resultsFile(config), 'utf8'));
    } catch {
      return {};
    }
  })();
  const data = {
    schema: 1,
    extension: config.extensionName,
    magento: config.magentoVersion || previous.magento || null,
    php: config.phpVersion,
    php_runtime: phpRuntime || previous.php_runtime || null,
    status: overallStatus(checks),
    checks,
  };
  fs.writeFileSync(resultsFile(config), `${JSON.stringify(data, null, 4)}\n`);
  return data;
}

module.exports = { FAILING, loadChecks, recordCheck, overallStatus, saveResults, oneLine };
