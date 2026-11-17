<?php

declare(strict_types=1);

/**
 * Prepares Magento's integration test framework for the extension: connection settings for the
 * services of this job, and the release's own phpunit.xml.dist with its test suites replaced by
 * the extension's, so listeners and extensions match that release's PHPUnit generation.
 */

[, $magentoRoot, $outputConfig] = $argv;
$directories = array_slice($argv, 3);
$integration = $magentoRoot . '/dev/tests/integration';

$install = [
    'db-host' => getenv('MEC_DB_HOST') . ':' . getenv('MEC_DB_PORT'),
    'db-user' => getenv('MEC_DB_USER'),
    'db-password' => getenv('MEC_DB_PASSWORD'),
    'db-name' => getenv('MEC_DB_NAME'),
    'db-prefix' => '',
    'backend-frontname' => 'backend',
    'search-engine' => getenv('MEC_SEARCH_ENGINE'),
    getenv('MEC_SEARCH_ENGINE') . '-host' => getenv('MEC_SEARCH_HOST'),
    getenv('MEC_SEARCH_ENGINE') . '-port' => (int) getenv('MEC_SEARCH_PORT'),
    'admin-user' => 'user',
    'admin-password' => 'password1',
    'admin-email' => 'admin@example.com',
    'admin-firstname' => 'firstname',
    'admin-lastname' => 'lastname',
];
file_put_contents($integration . '/etc/install-config-mysql.php', "<?php\nreturn " . var_export($install, true) . ";\n");

if (!is_file($integration . '/etc/config-global.php')) {
    copy($integration . '/etc/config-global.php.dist', $integration . '/etc/config-global.php');
}

$document = new DOMDocument();
$document->preserveWhiteSpace = false;
$document->formatOutput = true;
$document->load($integration . '/phpunit.xml.dist');
$xpath = new DOMXPath($document);

foreach ($xpath->query('/phpunit/testsuites') as $node) {
    $node->parentNode->removeChild($node);
}
// The reporting extension is not part of every release's dependencies and is not needed here.
foreach ($xpath->query('//*[contains(translate(@class, "ALURE", "alure"), "allure")]') as $node) {
    $node->parentNode->removeChild($node);
}

$suites = $document->createElement('testsuites');
$suite = $document->createElement('testsuite');
$suite->setAttribute('name', 'extension');
foreach ($directories as $directory) {
    $suite->appendChild($document->createElement('directory', $directory));
}
$suites->appendChild($suite);
$document->documentElement->insertBefore($suites, $document->documentElement->firstChild);
$document->save($outputConfig);
