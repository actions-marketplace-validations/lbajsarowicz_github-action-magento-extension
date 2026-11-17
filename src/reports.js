'use strict';

/** Test counts of the first test suite of a JUnit report. */
function junitTotals(xml) {
  const suite = /<testsuite\b[^>]*>/.exec(String(xml || ''));
  const attribute = (name) => {
    const match = suite ? new RegExp(`\\b${name}="(\\d+)"`).exec(suite[0]) : null;
    return match ? Number(match[1]) : 0;
  };
  return { tests: attribute('tests'), assertions: attribute('assertions'), broken: attribute('failures') + attribute('errors') };
}

/**
 * Counts PHPCS messages that fail the check and the rest. `threshold` is a severity or `errors`.
 *
 * @returns {?{failing: number, other: number}} null when the report is not a PHPCS report
 */
function phpcsTotals(report, threshold) {
  if (!report || typeof report !== 'object' || !report.files) {
    return null;
  }
  let failing = 0;
  let other = 0;
  for (const file of Object.values(report.files)) {
    for (const message of file.messages || []) {
      const fails = threshold === 'errors' ? message.type === 'ERROR' : Number(message.severity) >= Number(threshold);
      if (fails) {
        failing += 1;
      } else {
        other += 1;
      }
    }
  }
  return { failing, other };
}

/**
 * @returns {?{count: number, lines: string[]}} null when PHPStan could not load its configuration
 */
function phpstanTotals(report) {
  if (!report || typeof report !== 'object' || !report.totals) {
    return null;
  }
  const lines = [...(report.errors || []).map(String)];
  for (const [file, entry] of Object.entries(report.files || {})) {
    for (const message of entry.messages || []) {
      lines.push(`${file}:${message.line ?? '?'}  ${message.message}`);
    }
  }
  return { count: Number(report.totals.file_errors || 0) + Number(report.totals.errors || 0), lines };
}

function firstVersion(text) {
  const match = /[0-9]+\.[0-9]+\.[0-9]+/.exec(String(text));
  return match ? match[0] : 'unknown';
}

module.exports = { junitTotals, phpcsTotals, phpstanTotals, firstVersion };
