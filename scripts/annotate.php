<?php

declare(strict_types=1);

/**
 * Turns a PHPCS or PHPStan JSON report into GitHub annotations shown inline in the pull request.
 * GitHub keeps 10 errors and 10 warnings per step, so findings in changed files go first and the
 * budget is shared between checks through a counter file.
 */

[, $tool, $reportFile, $resultsDir, $extensionPath, $failSeverity] = array_pad($argv, 6, '10');

$workspace = rtrim((string) realpath((string) getenv('GITHUB_WORKSPACE')), '/');
$changedFile = dirname($resultsDir) . '/changed-files.txt';
$changed = is_file($changedFile) ? array_flip(file($changedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : null;
$budgetFile = $resultsDir . '/annotation-budget.json';
$budget = json_decode((string) @file_get_contents($budgetFile), true) ?: ['error' => 10, 'warning' => 10];

$report = json_decode((string) @file_get_contents($reportFile), true);
if (!is_array($report)) {
    exit(0);
}

$relative = static function (string $path) use ($workspace, $extensionPath): ?string {
    $real = realpath($path) ?: (realpath($extensionPath . '/' . ltrim($path, '/')) ?: $path);

    return str_starts_with($real, $workspace . '/') ? substr($real, strlen($workspace) + 1) : null;
};

$findings = [];
foreach ($report['files'] ?? [] as $path => $file) {
    $repoPath = $relative((string) $path);
    if ($repoPath === null) {
        continue;
    }
    foreach ($file['messages'] ?? [] as $message) {
        if ($tool === 'phpcs') {
            $findings[] = [
                'level' => (int) ($message['severity'] ?? 0) >= (int) $failSeverity ? 'error' : 'warning',
                'file' => $repoPath,
                'line' => (int) ($message['line'] ?? 1),
                'col' => (int) ($message['column'] ?? 0),
                'title' => 'PHPCS ' . ($message['source'] ?? ''),
                'message' => (string) ($message['message'] ?? ''),
            ];
        } else {
            $findings[] = [
                'level' => 'error',
                'file' => $repoPath,
                'line' => (int) ($message['line'] ?? 1),
                'col' => 0,
                'title' => 'PHPStan' . (isset($message['identifier']) ? ' ' . $message['identifier'] : ''),
                'message' => (string) ($message['message'] ?? ''),
            ];
        }
    }
}

usort($findings, static function (array $a, array $b) use ($changed): int {
    $rank = static fn (array $f): int => ($changed !== null && isset($changed[$f['file']]) ? 0 : 2) + ($f['level'] === 'error' ? 0 : 1);

    return [$rank($a), $a['file'], $a['line']] <=> [$rank($b), $b['file'], $b['line']];
});

$property = static fn (string $value): string => str_replace(
    ['%', "\r", "\n", ':', ','],
    ['%25', '%0D', '%0A', '%3A', '%2C'],
    $value
);
$data = static fn (string $value): string => str_replace(['%', "\r", "\n"], ['%25', '%0D', '%0A'], $value);

$shown = 0;
foreach ($findings as $finding) {
    if (($budget[$finding['level']] ?? 0) <= 0) {
        continue;
    }
    $budget[$finding['level']]--;
    $shown++;
    $position = 'file=' . $property($finding['file']) . ',line=' . max(1, $finding['line']);
    if ($finding['col'] > 0) {
        $position .= ',col=' . $finding['col'];
    }
    echo "::{$finding['level']} {$position},title={$property($finding['title'])}::{$data($finding['message'])}\n";
}

file_put_contents($budgetFile, json_encode($budget));
if (count($findings) > $shown) {
    echo 'Showing ' . $shown . ' of ' . count($findings) . " {$tool} findings inline; the full list is in the log and the result files.\n";
}
