<?php

declare(strict_types=1);

/**
 * Prints the `require-dev` entries of the extension that belong to a static-analysis tool, as
 * `name:constraint` lines, so the repository's own ruleset or PHPStan config finds the packages
 * and versions it was written for.
 */

[, $composerFile, $tool] = $argv;

$patterns = [
    'phpcs' => '#^(squizlabs/php_codesniffer|dealerdirect/phpcodesniffer-composer-installer|magento/magento-coding-standard'
        . '|slevomat/coding-standard|phpcompatibility/.+|phpcsstandards/.+|[^/]+/[^/]*(coding-standard|phpcs)[^/]*)$#',
    'phpstan' => '#^(phpstan/.+|bitexpert/phpstan-magento|[^/]+/[^/]*phpstan[^/]*)$#',
];

$requireDev = json_decode((string) file_get_contents($composerFile), true)['require-dev'] ?? [];
foreach ($requireDev as $name => $constraint) {
    if (is_string($constraint) && preg_match($patterns[$tool], strtolower((string) $name))
        && preg_match('#^[a-z0-9]([_.-]?[a-z0-9]+)*/[a-z0-9]([_.-]?[a-z0-9]+)*$#', strtolower((string) $name))
        && preg_match('/^[\w.*^~<>=|,@ -]+$/', $constraint)
    ) {
        echo strtolower((string) $name), ':', $constraint, "\n";
    }
}
