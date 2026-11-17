<?php

declare(strict_types=1);

[, $composerFile, $extensionPath, $extensionName, $mirror] = $argv;

$project = json_decode((string) file_get_contents($composerFile), true, 512, JSON_THROW_ON_ERROR);

// The checkout comes first and is the only source allowed to provide the extension, so a published
// release of the same package can never be installed in its place.
$project['repositories'] = [
    [
        'type' => 'path',
        'url' => $extensionPath,
        // Copied, not symlinked: Magento refuses to deploy view files that resolve outside its root.
        'options' => ['symlink' => false],
    ],
    [
        'type' => 'composer',
        'url' => $mirror,
        'exclude' => [$extensionName],
    ],
];
$project['require'][$extensionName] = '*@dev';

file_put_contents(
    $composerFile,
    json_encode($project, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n"
);
