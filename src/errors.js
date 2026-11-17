'use strict';

/** An input or the repository layout makes it impossible to start. */
class ConfigError extends Error {}

/** A check did not pass; `note` is the one-line reason shown in the report. */
class CheckFailed extends Error {
  constructor(note = '') {
    super(note || 'check failed');
    this.note = note;
  }
}

module.exports = { ConfigError, CheckFailed };
