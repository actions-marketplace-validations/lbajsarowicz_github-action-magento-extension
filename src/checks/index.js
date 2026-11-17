'use strict';

const { validate, lint, phpcs } = require('./static');
const { install, compile, staticContent } = require('./magento');
const { unit, integration } = require('./phpunit');
const { phpstan } = require('./phpstan');

module.exports = {
  validate,
  lint,
  install,
  phpcs,
  compile,
  'static-content': staticContent,
  unit,
  integration,
  phpstan,
};
