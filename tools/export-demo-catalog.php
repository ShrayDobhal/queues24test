<?php
/**
 * Exports the blood-test catalog (tests, areas, slots, partner names) from the real seed data
 * into a static JSON file, so the Vercel demo shows exactly the same tests and prices.
 *   php tools/export-demo-catalog.php <path-to-_q24h> <out.json>
 * Uses a throwaway temp database; never touches real data.
 */
declare(strict_types=1);

[$_, $core, $out] = $argv + [null, null, null];
if (!$core || !$out) { fwrite(STDERR, "usage: php export-demo-catalog.php <_q24h dir> <out.json>\n"); exit(1); }
$tmp = sys_get_temp_dir() . '/q24h-demo-export-' . getmypid();
putenv('Q24H_DATA_DIR=' . $tmp);
define('Q24H_ROOT', realpath($core));
require Q24H_ROOT . '/core.php';
require Q24H_ROOT . '/storage.php';
require Q24H_ROOT . '/domain.php';
\Q24H\db();
$partners = [];
foreach (\Q24H\q("SELECT c.area_id, c.role, p.name FROM coverage c JOIN partners p ON p.id = c.partner_id") as $r) $partners[$r['area_id']][$r['role']] = $r['name'];
$areas = [];
foreach (\Q24H\q('SELECT id, name, kind, state FROM areas') as $a) $areas[$a['id']] = ['name' => $a['name'], 'kind' => $a['kind'], 'state' => $a['state'], 'primary' => $partners[$a['id']]['primary'] ?? null, 'backup' => $partners[$a['id']]['backup'] ?? null];
$data = [
    'tests' => \Q24H\catalog_tests(),
    'areas' => \Q24H\areas_catalog(),
    'slots' => \Q24H\SLOT_WINDOWS,
    'genders' => \Q24H\GENDERS,
    'otpTestMode' => true,
    'acceptTimeoutMin' => 30,
    'areaInfo' => $areas,
];
file_put_contents($out, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
array_map("unlink", array_filter(glob("$tmp/*") ?: [], "is_file")); @unlink("$tmp/.secret");
@rmdir("$tmp/files"); @rmdir($tmp);
echo 'Exported ' . count($data['tests']) . ' tests, ' . count($data['areas']) . " states → $out\n";
