<?php

declare(strict_types=1);

/**
 * Static content deployment normally reads store views and themes from the database. Magento also
 * accepts them from app/etc/config.php (the "build without a database" mode used by Adobe Commerce
 * Cloud), so the default single-store scopes and every registered theme are written there.
 */

[, $magentoRoot] = $argv;

require $magentoRoot . '/vendor/autoload.php';

$configFile = $magentoRoot . '/app/etc/config.php';
$config = require $configFile;

$config['scopes'] = [
    'websites' => [
        'admin' => ['website_id' => '0', 'code' => 'admin', 'name' => 'Admin', 'sort_order' => '0', 'default_group_id' => '0', 'is_default' => '0'],
        'base' => ['website_id' => '1', 'code' => 'base', 'name' => 'Main Website', 'sort_order' => '0', 'default_group_id' => '1', 'is_default' => '1'],
    ],
    'groups' => [
        0 => ['group_id' => '0', 'website_id' => '0', 'name' => 'Default', 'root_category_id' => '0', 'default_store_id' => '0', 'code' => 'default'],
        1 => ['group_id' => '1', 'website_id' => '1', 'name' => 'Main Website Store', 'root_category_id' => '2', 'default_store_id' => '1', 'code' => 'main_website_store'],
    ],
    'stores' => [
        'admin' => ['store_id' => '0', 'code' => 'admin', 'website_id' => '0', 'group_id' => '0', 'name' => 'Admin', 'sort_order' => '0', 'is_active' => '1'],
        'default' => ['store_id' => '1', 'code' => 'default', 'website_id' => '1', 'group_id' => '1', 'name' => 'Default Store View', 'sort_order' => '0', 'is_active' => '1'],
    ],
];

$config['themes'] = [];
$registrar = new \Magento\Framework\Component\ComponentRegistrar();
foreach ($registrar->getPaths(\Magento\Framework\Component\ComponentRegistrar::THEME) as $fullPath => $directory) {
    [$area, $vendor, $name] = array_pad(explode('/', $fullPath, 3), 3, '');
    $xml = @simplexml_load_file($directory . '/theme.xml');
    $code = $vendor . '/' . $name;
    $config['themes'][$fullPath] = [
        'parent_id' => $xml && (string) $xml->parent !== '' ? (string) $xml->parent : null,
        'theme_path' => $code,
        'theme_title' => $xml && (string) $xml->title !== '' ? (string) $xml->title : $code,
        'is_featured' => '0',
        'area' => $area,
        'type' => '0',
        'code' => $code,
    ];
}

file_put_contents($configFile, "<?php\nreturn " . var_export($config, true) . ";\n");
echo count($config['themes']), " theme(s): ", implode(', ', array_keys($config['themes'])), "\n";
