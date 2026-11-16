<?php

declare(strict_types=1);

/**
 * Writes the repository-relative paths changed by the current pull request or push, one per line.
 * Exit code 2 means the list could not be determined and the caller should check every file.
 */

[, $outputFile] = $argv;

$event = json_decode((string) @file_get_contents((string) getenv('GITHUB_EVENT_PATH')), true) ?: [];
$repository = (string) getenv('GITHUB_REPOSITORY');
$api = rtrim((string) (getenv('GITHUB_API_URL') ?: 'https://api.github.com'), '/');
$token = (string) getenv('MEC_TOKEN');

if (!preg_match('#^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$#', $repository)) {
    fwrite(STDERR, "Repository name is not available.\n");
    exit(2);
}

$request = static function (string $url) use ($token): ?array {
    $headers = ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28', 'User-Agent: magento-extension-check'];
    if ($token !== '') {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    $body = @file_get_contents($url, false, stream_context_create([
        'http' => ['header' => implode("\r\n", $headers), 'timeout' => 20, 'ignore_errors' => false],
    ]));
    $decoded = $body === false ? null : json_decode($body, true);

    return is_array($decoded) ? $decoded : null;
};

$paths = [];
$collect = static function (array $files) use (&$paths): void {
    foreach ($files as $file) {
        if (isset($file['filename']) && ($file['status'] ?? '') !== 'removed') {
            $paths[] = (string) $file['filename'];
        }
    }
};

$number = $event['pull_request']['number'] ?? null;
$before = (string) ($event['before'] ?? '');
$after = (string) ($event['after'] ?? '');

if (is_int($number)) {
    for ($page = 1; $page <= 30; $page++) {
        $files = $request("{$api}/repos/{$repository}/pulls/{$number}/files?per_page=100&page={$page}");
        if ($files === null) {
            fwrite(STDERR, "Could not read the files of pull request #{$number}.\n");
            exit(2);
        }
        $collect($files);
        if (count($files) < 100) {
            break;
        }
    }
} elseif (preg_match('/^[0-9a-f]{40}$/', $before) && preg_match('/^[0-9a-f]{40}$/', $after) && trim($before, '0') !== '') {
    $comparison = $request("{$api}/repos/{$repository}/compare/{$before}...{$after}");
    if ($comparison === null || !isset($comparison['files']) || count($comparison['files']) >= 300) {
        fwrite(STDERR, "Could not read the files changed by this push.\n");
        exit(2);
    }
    $collect($comparison['files']);
} else {
    fwrite(STDERR, "This event has no base to compare with.\n");
    exit(2);
}

file_put_contents($outputFile, $paths === [] ? '' : implode("\n", array_unique($paths)) . "\n");
echo count(array_unique($paths)) . " changed file(s)\n";
