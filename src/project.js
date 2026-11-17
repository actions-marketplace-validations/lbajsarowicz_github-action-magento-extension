'use strict';

/**
 * Makes the checkout the only source of the extension in the Magento project, so that a published
 * release of the same package can never be installed in its place.
 */
function withExtension(project, extensionPath, extensionName, mirror) {
  return {
    ...project,
    repositories: [
      // Copied, not symlinked: Magento refuses to deploy view files that resolve outside its root.
      { type: 'path', url: extensionPath, options: { symlink: false } },
      { type: 'composer', url: mirror, exclude: [extensionName] },
    ],
    require: { ...(project.require || {}), [extensionName]: '*@dev' },
  };
}

module.exports = { withExtension };
