<?php

declare(strict_types=1);

[, $resultsDir, $label, $overall, $php, $magento, $extension, $ran] = $argv;
$ran = array_filter(explode(' ', $ran));

$icons = ['passed' => '✅', 'failed' => '❌', 'skipped' => '➖', 'blocked' => '⛔'];
$checks = [];
foreach (file($resultsDir . '/results.tsv', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
    [$name, $status, $seconds, $note] = array_pad(explode("\t", $line), 4, '');
    $checks[] = ['check' => $name, 'status' => $status, 'seconds' => (int) $seconds, 'note' => $note];
}

$previous = json_decode((string) @file_get_contents($resultsDir . '/results.json'), true) ?: [];

file_put_contents(
    $resultsDir . '/results.json',
    json_encode(
        [
            'schema' => 1,
            'extension' => $extension,
            'magento' => $magento !== '' ? $magento : ($previous['magento'] ?? null),
            'php' => $php,
            'php_runtime' => PHP_VERSION,
            'status' => array_intersect(['failed', 'blocked'], array_column($checks, 'status')) ? 'failed' : 'passed',
            'checks' => $checks,
        ],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n"
);

$escape = static fn (string $text): string => str_replace(['|', "\n"], ['\\|', ' '], htmlspecialchars($text, ENT_QUOTES));

echo "### {$icons[$overall]} {$escape($label)}\n\n";
echo "| Check | Result | Time | Details |\n|---|---|---|---|\n";
$checks = array_filter($checks, static fn (array $check): bool => in_array($check['check'], $ran, true));

foreach ($checks as $check) {
    $icon = $icons[$check['status']] ?? '';
    echo "| `{$check['check']}` | {$icon} {$check['status']} | {$check['seconds']} s | {$escape($check['note'])} |\n";
}
echo "\n";

foreach ($checks as $check) {
    if ($check['status'] !== 'failed') {
        continue;
    }
    $log = @file($resultsDir . '/' . $check['check'] . '.log', FILE_IGNORE_NEW_LINES) ?: [];
    $tail = implode("\n", array_slice($log, -40));
    echo "<details><summary>Last lines of <code>{$check['check']}</code></summary>\n\n<pre>\n";
    echo htmlspecialchars(mb_substr($tail, -6000), ENT_QUOTES) . "\n</pre>\n\n</details>\n\n";
}
