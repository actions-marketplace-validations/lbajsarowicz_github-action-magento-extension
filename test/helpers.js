'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** A workspace with a minimal extension; returns the environment the action would pass. */
function workspace(files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mec-test-')));
  const defaults = {
    'composer.json': JSON.stringify({ name: 'acme/module-demo', 'require-dev': {} }),
    'registration.php': "<?php ComponentRegistrar::register(ComponentRegistrar::MODULE, 'Acme_Demo', __DIR__);",
    'etc/module.xml': '<config><module name="Acme_Demo"/></config>',
    'Model/Demo.php': '<?php class Demo {}',
  };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) {
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(root, 'ext', name)), { recursive: true });
    fs.writeFileSync(path.join(root, 'ext', name), content);
  }
  return {
    root,
    extension: path.join(root, 'ext'),
    env: {
      GITHUB_WORKSPACE: path.join(root, 'ext'),
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'check',
      MEC_WORK_DIR: path.join(root, 'work'),
      MEC_PHP_VERSION: '8.4',
      MEC_MAGENTO_VERSION: '2.4.8-p5',
      MEC_CHECKS: 'default',
      MEC_PATH: '.',
    },
  };
}

module.exports = { workspace };
