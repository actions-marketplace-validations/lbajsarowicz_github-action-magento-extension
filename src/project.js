'use strict';

/**
 * A repository that can never provide the extension itself, so that a published release of the
 * package cannot be installed in place of the checkout.
 */
function withoutExtension(repository, extensionName) {
  if (typeof repository.type !== 'string') {
    return repository;
  }
  // Composer accepts either `only` or `exclude` on a repository, not both.
  if (Array.isArray(repository.only)) {
    return { ...repository, only: repository.only.filter((name) => name !== extensionName) };
  }
  const exclude = Array.isArray(repository.exclude) ? repository.exclude : [];
  return { ...repository, exclude: [...new Set([...exclude, extensionName])] };
}

/**
 * Makes the checkout the first and only source of the extension in the Magento project.
 *
 * @param {Array<Object>} repositories where everything else comes from, in Composer's format
 */
function withExtension(project, extensionPath, extensionName, repositories) {
  return {
    ...project,
    repositories: [
      // Copied, not symlinked: Magento refuses to deploy view files that resolve outside its root.
      { type: 'path', url: extensionPath, options: { symlink: false } },
      ...repositories.map((repository) => withoutExtension(repository, extensionName)),
    ],
    require: { ...(project.require || {}), [extensionName]: '*@dev' },
  };
}

/** The Composer repository that `create-project` reads the Magento project template from. */
function templateRepositoryUrl(repositories) {
  const repository = repositories.find((candidate) => candidate.type === 'composer' && typeof candidate.url === 'string');
  return repository ? repository.url : null;
}

module.exports = { withExtension, withoutExtension, templateRepositoryUrl };
