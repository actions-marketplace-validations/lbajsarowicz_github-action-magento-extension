'use strict';

const ICONS = { passed: '✅', failed: '❌', warning: '⚠️', skipped: '➖', blocked: '⛔' };

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cell(text) {
  return escapeHtml(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

/**
 * Markdown for the summary of one step.
 *
 * @param {Array<{check: string, status: string, seconds: number, note: string}>} checks rows of this step
 * @param {Object<string, string>} logTails last lines of the log of failed checks
 */
function stepSummary(label, status, checks, logTails = {}) {
  const lines = [`### ${ICONS[status] || ''} ${cell(label)}`, '', '| Check | Result | Time | Details |', '|---|---|---|---|'];
  for (const check of checks) {
    lines.push(`| \`${check.check}\` | ${ICONS[check.status] || ''} ${check.status} | ${check.seconds} s | ${cell(check.note)} |`);
  }
  lines.push('');
  for (const check of checks) {
    if (check.status !== 'failed' || !logTails[check.check]) {
      continue;
    }
    lines.push(`<details><summary>Last lines of <code>${check.check}</code></summary>`, '', '<pre>',
      escapeHtml(logTails[check.check]), '</pre>', '', '</details>', '');
  }
  return `${lines.join('\n')}\n`;
}

function tail(text, lines = 40, characters = 6000) {
  return String(text).split('\n').slice(-lines).join('\n').slice(-characters);
}

module.exports = { stepSummary, tail };
