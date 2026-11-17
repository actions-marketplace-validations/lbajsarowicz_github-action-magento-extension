'use strict';

const { ConfigError } = require('./errors');

// phpcs comes after install so that it can use the coding standard the Magento release resolves.
const ALL_CHECKS = ['validate', 'lint', 'install', 'phpcs', 'compile', 'static-content', 'unit', 'integration', 'phpstan'];
const MAGENTO_CHECKS = ['install', 'compile', 'static-content', 'unit', 'integration', 'phpstan'];
const NEEDS_INSTALL = ['compile', 'static-content', 'unit', 'integration', 'phpstan'];
const DEFAULT_WITH_MAGENTO = ['validate', 'lint', 'install', 'phpcs', 'compile', 'unit', 'phpstan'];
const DEFAULT_STATIC = ['validate', 'lint', 'phpcs'];

/**
 * Turns the `checks` input into the ordered list of checks to run.
 */
function selectChecks(input, magentoVersion) {
  let requested = String(input).split(/[\s,]+/).filter(Boolean);
  if (requested.length === 1 && requested[0] === 'default') {
    requested = magentoVersion ? DEFAULT_WITH_MAGENTO : DEFAULT_STATIC;
  }
  const selected = new Set();
  for (const check of requested) {
    if (!ALL_CHECKS.includes(check)) {
      throw new ConfigError(`Unknown check '${check}'. Available: ${ALL_CHECKS.join(', ')}.`);
    }
    if (MAGENTO_CHECKS.includes(check)) {
      if (!magentoVersion) {
        throw new ConfigError(`Check '${check}' needs magento-version.`);
      }
      selected.add('install');
    }
    selected.add(check);
  }
  if (selected.size === 0) {
    throw new ConfigError('No checks selected.');
  }
  return ALL_CHECKS.filter((check) => selected.has(check));
}

module.exports = { ALL_CHECKS, MAGENTO_CHECKS, NEEDS_INSTALL, selectChecks };
