'use strict';

const CHECKS = [
  ['validate', 'Composer'],
  ['lint', 'Syntax'],
  ['install', 'Install'],
  ['phpcs', 'PHPCS'],
  ['compile', 'Compile'],
  ['static-content', 'Static content'],
  ['unit', 'Unit tests'],
  ['integration', 'Integration tests'],
  ['phpstan', 'PHPStan'],
];
const ICONS = {
  passed: '✅',
  failed: '❌',
  skipped: '➖',
  blocked: '⛔',
  'not-run': '⚪',
  missing: '❔',
};
const FAILING = ['failed', 'blocked', 'missing'];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  return escapeHtml(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function cellLabel(cell) {
  return cell.magento ? `Magento ${cell.magento} @ PHP ${cell.php}` : `PHP ${cell.php}`;
}

function cellKey(cell) {
  return `${cell.magento || ''}|${cell.php}`;
}

/**
 * @param {Array<{magento: string, php: string}>} expected cells of the matrix
 * @param {Array<{magento: ?string, php: string, checks: Array, logs: Object}>} results one per uploaded result
 */
function buildReport(expected, results) {
  const byKey = new Map(results.map((result) => [cellKey(result), result]));
  const cells = expected.map((cell) => ({ magento: cell.magento, php: String(cell.php) }));
  for (const result of results) {
    if (!cells.some((cell) => cellKey(cell) === cellKey(result))) {
      cells.push({ magento: result.magento, php: String(result.php) });
    }
  }

  const present = new Set(results.flatMap((result) => result.checks.map((check) => check.check)));
  const columns = CHECKS.filter(([name]) => present.has(name));

  const rows = cells.map((cell) => {
    const result = byKey.get(cellKey(cell));
    const outcomes = columns.map(([name, title]) => {
      if (!result) {
        return { check: name, title, status: 'missing', note: 'no result was uploaded', seconds: 0 };
      }
      const check = result.checks.find((candidate) => candidate.check === name);
      return check
        ? { check: name, title, status: check.status, note: check.note || '', seconds: check.seconds || 0 }
        : { check: name, title, status: 'not-run', note: 'not run because an earlier check failed', seconds: 0 };
    });
    const failed = !result || outcomes.some((outcome) => FAILING.includes(outcome.status));
    return { cell, label: cellLabel(cell), outcomes, failed, logs: result ? result.logs || {} : {} };
  });

  const failedRows = rows.filter((row) => row.failed);
  return {
    columns,
    rows,
    status: rows.length > 0 && failedRows.length === 0 ? 'passed' : 'failed',
    failedCount: failedRows.length,
  };
}

function renderMarkdown(report, title) {
  const lines = [];
  const { rows, columns } = report;
  if (rows.length === 0) {
    return `## ❌ ${escapeHtml(title)}\n\nNo results were found. The check jobs did not upload any.\n`;
  }

  const verdict = report.status === 'passed'
    ? `all ${rows.length} version combinations passed`
    : `${report.failedCount} of ${rows.length} version combinations failed`;
  lines.push(`## ${report.status === 'passed' ? '✅' : '❌'} ${escapeHtml(title)}: ${verdict}`, '');

  if (columns.length === 0) {
    lines.push('| Magento @ PHP | Result |', '|---|---|');
    for (const row of rows) {
      lines.push(`| ${inline(row.label)} | ${ICONS.missing} no result |`);
    }
  } else {
    lines.push(`| Magento @ PHP | ${columns.map(([, columnTitle]) => columnTitle).join(' | ')} |`);
    lines.push(`|---|${columns.map(() => ':---:').join('|')}|`);
    for (const row of rows) {
      lines.push(`| ${inline(row.label)} | ${row.outcomes.map((outcome) => ICONS[outcome.status] || '').join(' | ')} |`);
    }
  }
  lines.push('', '✅ passed · ❌ failed · ➖ nothing to run · ⛔ blocked by a failed install · ⚪ not run · ❔ no result', '');

  const failures = rows.flatMap((row) => row.outcomes
    .filter((outcome) => outcome.status === 'failed')
    .map((outcome) => ({ row, outcome })));
  const lost = rows.filter((row) => row.outcomes.length === 0 || row.outcomes.every((outcome) => outcome.status === 'missing'));

  if (failures.length > 0 || lost.length > 0) {
    lines.push('### What failed', '');
    for (const { row, outcome } of failures) {
      lines.push(`**${inline(row.label)}: ${outcome.title}**`);
      if (outcome.note) {
        lines.push('', inline(outcome.note));
      }
      const log = row.logs[outcome.check];
      if (log) {
        lines.push('', '<details><summary>Last lines of the log</summary>', '', '<pre>', escapeHtml(log), '</pre>', '', '</details>');
      }
      lines.push('');
    }
    for (const row of lost) {
      lines.push(`**${inline(row.label)}**`, '', 'The job uploaded no result. See its log.', '');
    }
  }

  const detailed = rows.filter((row) => row.outcomes.some((outcome) => !['missing', 'not-run'].includes(outcome.status)));
  if (detailed.length > 0) {
    lines.push('<details><summary>Every check with its details</summary>', '');
    for (const row of detailed) {
      lines.push(`#### ${inline(row.label)}`, '', '| Check | Result | Time | Details |', '|---|---|---|---|');
      for (const outcome of row.outcomes) {
        if (outcome.status === 'missing') {
          continue;
        }
        const time = outcome.status === 'not-run' ? '' : `${outcome.seconds} s`;
        lines.push(`| ${outcome.title} | ${ICONS[outcome.status] || ''} ${outcome.status.replace('-', ' ')} | ${time} | ${inline(outcome.note)} |`);
      }
      lines.push('');
    }
    lines.push('</details>', '');
  }

  return lines.join('\n');
}

module.exports = { buildReport, renderMarkdown };
