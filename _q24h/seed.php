<?php
/**
 * First-run data: India service areas, starter lab-partner accounts, test catalog.
 * Partner names/emails are placeholders — rename them in Admin → Lab partners.
 * Prices are starter values — edit them in Admin → Lab partners → Tests.
 */
declare(strict_types=1);

namespace Q24H;

use PDO;

/** Metro areas get a primary AND a backup partner. Cities may sit in neighbouring states (NCR). */
const METROS = [
    ['DEL', 'Delhi NCR', 'Delhi', [['New Delhi', 'Delhi'], ['Gurugram', 'Haryana'], ['Faridabad', 'Haryana'], ['Noida', 'Uttar Pradesh'], ['Greater Noida', 'Uttar Pradesh'], ['Ghaziabad', 'Uttar Pradesh']]],
    ['MUM', 'Mumbai', 'Maharashtra', [['Mumbai', 'Maharashtra'], ['Thane', 'Maharashtra'], ['Navi Mumbai', 'Maharashtra']]],
    ['PUN', 'Pune', 'Maharashtra', [['Pune', 'Maharashtra'], ['Pimpri-Chinchwad', 'Maharashtra']]],
    ['BLR', 'Bengaluru', 'Karnataka', [['Bengaluru', 'Karnataka']]],
    ['CHE', 'Chennai', 'Tamil Nadu', [['Chennai', 'Tamil Nadu']]],
    ['KOL', 'Kolkata', 'West Bengal', [['Kolkata', 'West Bengal'], ['Howrah', 'West Bengal']]],
    ['HYD', 'Hyderabad', 'Telangana', [['Hyderabad', 'Telangana'], ['Secunderabad', 'Telangana']]],
    ['AMD', 'Ahmedabad', 'Gujarat', [['Ahmedabad', 'Gujarat'], ['Gandhinagar', 'Gujarat']]],
];

/** Every other state/UT gets one partner (city = where that partner lab sits). Delhi is fully covered by the NCR metro. */
const STATES = [
    ['AP', 'Andhra Pradesh', 'Vijayawada'], ['AR', 'Arunachal Pradesh', 'Itanagar'], ['AS', 'Assam', 'Guwahati'], ['BR', 'Bihar', 'Patna'],
    ['CG', 'Chhattisgarh', 'Raipur'], ['GA', 'Goa', 'Panaji'], ['GJ', 'Gujarat', 'Surat'], ['HR', 'Haryana', 'Panipat'],
    ['HP', 'Himachal Pradesh', 'Shimla'], ['JH', 'Jharkhand', 'Ranchi'], ['KA', 'Karnataka', 'Mysuru'], ['KL', 'Kerala', 'Kochi'],
    ['MP', 'Madhya Pradesh', 'Bhopal'], ['MH', 'Maharashtra', 'Nagpur'], ['MN', 'Manipur', 'Imphal'], ['ML', 'Meghalaya', 'Shillong'],
    ['MZ', 'Mizoram', 'Aizawl'], ['NL', 'Nagaland', 'Dimapur'], ['OD', 'Odisha', 'Bhubaneswar'], ['PB', 'Punjab', 'Ludhiana'],
    ['RJ', 'Rajasthan', 'Jaipur'], ['SK', 'Sikkim', 'Gangtok'], ['TN', 'Tamil Nadu', 'Coimbatore'], ['TS', 'Telangana', 'Warangal'],
    ['TR', 'Tripura', 'Agartala'], ['UP', 'Uttar Pradesh', 'Lucknow'], ['UK', 'Uttarakhand', 'Dehradun'], ['WB', 'West Bengal', 'Siliguri'],
    ['AN', 'Andaman and Nicobar Islands', 'Port Blair'], ['CH', 'Chandigarh', 'Chandigarh'], ['DD', 'Dadra and Nagar Haveli and Daman and Diu', 'Daman'],
    ['JK', 'Jammu and Kashmir', 'Srinagar'], ['LA', 'Ladakh', 'Leh'], ['LD', 'Lakshadweep', 'Kavaratti'], ['PY', 'Puducherry', 'Puducherry'],
];

function seed_all(PDO $pdo): void
{
    $insArea = $pdo->prepare('INSERT INTO areas (code, name, state, kind, cities) VALUES (?, ?, ?, ?, ?)');
    $insPartner = $pdo->prepare('INSERT INTO partners (code, name, contact_person, email, phone, city, state, password_hash, password_enc) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)');
    $insCov = $pdo->prepare('INSERT INTO coverage (area_id, role, partner_id) VALUES (?, ?, ?)');
    $mkPartner = function (string $code, string $name, string $city, string $state) use ($pdo, $insPartner): int {
        $pw = generate_password();
        $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $code));
        $insPartner->execute([$code, $name, 'Lab manager', "lab-$slug@partners.queue24.com", $city, $state, hash_pw($pw), enc_pw($pw)]);
        return (int) $pdo->lastInsertId();
    };

    foreach (METROS as [$code, $name, $state, $cities]) {
        $insArea->execute(["M-$code", $name, $state, 'metro', json_encode(array_map(fn($c) => ['name' => $c[0], 'state' => $c[1]], $cities))]);
        $area = (int) $pdo->lastInsertId();
        $insCov->execute([$area, 'primary', $mkPartner("$code-P", "$name Partner Lab (Primary)", $cities[0][0], $state)]);
        $insCov->execute([$area, 'backup', $mkPartner("$code-B", "$name Partner Lab (Backup)", $cities[0][0], $state)]);
    }
    foreach (STATES as [$code, $state, $city]) {
        $insArea->execute(["S-$code", $state, $state, 'state', '[]']);
        $area = (int) $pdo->lastInsertId();
        $insCov->execute([$area, 'primary', $mkPartner("$code-01", "$city Partner Lab ($state)", $city, $state)]);
    }
    seed_tests($pdo);
}

function seed_tests(PDO $pdo): void
{
    // code, name, category, sample, fasting h, report h, parameters, price, mrp, popular, description
    $tests = [
        ['CBC', 'Complete Blood Count (CBC)', 'blood', 'Blood', 0, 12, 24, 299, 450, 1, 'Checks red cells, white cells, haemoglobin and platelets. Screens for anaemia, infection and many other conditions.'],
        ['HBA1C', 'HbA1c (Glycated Haemoglobin)', 'diabetes', 'Blood', 0, 12, 3, 449, 650, 1, 'Your average blood sugar over the last 3 months. The key test for diagnosing and monitoring diabetes.'],
        ['FBS', 'Fasting Blood Sugar (FBS)', 'diabetes', 'Blood', 10, 6, 1, 99, 150, 0, 'Blood glucose after an overnight fast.'],
        ['PPBS', 'Post Prandial Blood Sugar (PPBS)', 'diabetes', 'Blood', 0, 6, 1, 99, 150, 0, 'Blood glucose 2 hours after a meal.'],
        ['INSF', 'Insulin – Fasting', 'diabetes', 'Blood', 10, 24, 1, 699, 1100, 0, 'Measures insulin levels; helps assess insulin resistance.'],
        ['THY', 'Thyroid Profile (T3, T4, TSH)', 'thyroid', 'Blood', 0, 12, 3, 499, 750, 1, 'Checks how well your thyroid gland is working.'],
        ['TSH', 'TSH (Thyroid Stimulating Hormone)', 'thyroid', 'Blood', 0, 12, 1, 249, 400, 0, 'First-line screening test for thyroid disorders.'],
        ['LIPID', 'Lipid Profile', 'heart', 'Blood', 12, 12, 8, 449, 800, 1, 'Cholesterol (HDL, LDL), triglycerides and ratios. Assesses heart disease risk.'],
        ['CRP', 'C-Reactive Protein (CRP)', 'heart', 'Blood', 0, 12, 1, 449, 700, 0, 'A marker of inflammation and infection.'],
        ['LFT', 'Liver Function Test (LFT)', 'liver', 'Blood', 0, 12, 11, 549, 900, 1, 'Bilirubin, enzymes (SGOT, SGPT, ALP) and proteins to check liver health.'],
        ['KFT', 'Kidney Function Test (KFT)', 'kidney', 'Blood', 0, 12, 9, 549, 900, 1, 'Urea, creatinine, uric acid and electrolytes to check kidney health.'],
        ['URIC', 'Uric Acid', 'kidney', 'Blood', 0, 12, 1, 199, 300, 0, 'High uric acid can cause gout and kidney stones.'],
        ['ELEC', 'Electrolytes (Sodium, Potassium, Chloride)', 'kidney', 'Blood', 0, 12, 3, 349, 550, 0, 'Checks the body\'s salt and fluid balance.'],
        ['VITD', 'Vitamin D (25-OH)', 'vitamins', 'Blood', 0, 24, 1, 999, 1600, 1, 'Vitamin D deficiency is very common and affects bones, immunity and energy.'],
        ['VITB12', 'Vitamin B12', 'vitamins', 'Blood', 0, 24, 1, 799, 1200, 1, 'Low B12 can cause tiredness, tingling and anaemia.'],
        ['IRON', 'Iron Studies', 'vitamins', 'Blood', 0, 24, 4, 699, 1100, 0, 'Serum iron, TIBC, transferrin saturation and ferritin.'],
        ['CALC', 'Calcium', 'vitamins', 'Blood', 0, 12, 1, 199, 300, 0, 'Calcium level for bone, muscle and nerve health.'],
        ['URINE', 'Urine Routine & Microscopy', 'kidney', 'Urine', 0, 12, 20, 199, 300, 0, 'Screens for urinary infection, kidney problems and diabetes.'],
        ['ESR', 'ESR (Erythrocyte Sedimentation Rate)', 'fever', 'Blood', 0, 12, 1, 149, 250, 0, 'A general marker of inflammation.'],
        ['DENGUE', 'Dengue NS1 Antigen', 'fever', 'Blood', 0, 12, 1, 599, 900, 1, 'Detects dengue in the first days of fever.'],
        ['MALARIA', 'Malaria Antigen (Rapid)', 'fever', 'Blood', 0, 6, 2, 399, 600, 0, 'Detects malaria parasites (P. vivax and P. falciparum).'],
        ['WIDAL', 'Widal Test (Typhoid)', 'fever', 'Blood', 0, 12, 4, 249, 400, 0, 'Screening test for typhoid fever.'],
        ['BGRP', 'Blood Group & Rh Type', 'blood', 'Blood', 0, 6, 2, 149, 250, 0, 'ABO blood group and Rh factor.'],
        ['PSA', 'PSA (Prostate Specific Antigen)', 'hormones', 'Blood', 0, 24, 1, 699, 1100, 0, 'Prostate health screening for men over 50.'],
        ['TESTO', 'Testosterone – Total', 'hormones', 'Blood', 0, 24, 1, 699, 1100, 0, 'Male hormone level; checks low testosterone.'],
        ['BHCG', 'Beta hCG (Pregnancy)', 'women', 'Blood', 0, 12, 1, 599, 900, 0, 'Confirms and tracks pregnancy.'],
        ['PRL', 'Prolactin', 'women', 'Blood', 0, 24, 1, 499, 800, 0, 'Hormone linked to fertility and menstrual health.'],
        ['AMH', 'AMH (Anti-Müllerian Hormone)', 'women', 'Blood', 0, 48, 1, 1599, 2500, 0, 'Indicates ovarian reserve; used in fertility planning.'],
        ['HIV', 'HIV 1 & 2 Antibody', 'infection', 'Blood', 0, 24, 1, 499, 800, 0, 'Screening test for HIV. Results are confidential.'],
        ['HBSAG', 'Hepatitis B Surface Antigen (HBsAg)', 'infection', 'Blood', 0, 24, 1, 349, 550, 0, 'Screening test for hepatitis B infection.'],
    ];
    $ins = $pdo->prepare('INSERT INTO tests (code, name, kind, category, description, sample_type, fasting_hours, tat_hours, parameters, includes, price, mrp, popular, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $params = [];
    foreach ($tests as $i => [$code, $name, $cat, $sample, $fast, $tat, $par, $price, $mrp, $pop, $desc]) {
        $ins->execute([$code, $name, 'test', $cat, $desc, $sample, $fast, $tat, $par, '[]', $price, $mrp, $pop, 100 + $i]);
        $params[$code] = $par;
    }
    // code, name, category, includes, price, mrp, description
    $packages = [
        ['PKG-FB1', 'Full Body Checkup – Essential', 'full-body', ['CBC', 'LFT', 'KFT', 'LIPID', 'THY', 'FBS', 'URINE'], 1499, 3200, 'Head-to-toe screening of blood, liver, kidney, heart, thyroid and sugar. Ideal yearly check-up.'],
        ['PKG-FB2', 'Full Body Checkup – Advanced', 'full-body', ['CBC', 'LFT', 'KFT', 'LIPID', 'THY', 'FBS', 'URINE', 'HBA1C', 'VITD', 'VITB12', 'IRON'], 2499, 5600, 'Everything in Essential plus HbA1c, Vitamin D, Vitamin B12 and Iron studies.'],
        ['PKG-DIA', 'Diabetes Care Package', 'diabetes', ['FBS', 'PPBS', 'HBA1C', 'KFT', 'URINE'], 899, 1800, 'Complete diabetes monitoring: sugar levels, 3-month average and kidney health.'],
        ['PKG-HRT', 'Heart Health Package', 'heart', ['LIPID', 'CRP', 'CBC', 'FBS', 'ELEC'], 1199, 2400, 'Cholesterol, inflammation, sugar and electrolytes for heart-risk assessment.'],
        ['PKG-WOM', "Women's Wellness Package", 'women', ['CBC', 'THY', 'IRON', 'VITD', 'VITB12', 'CALC', 'PRL'], 1999, 4200, 'Thyroid, hormones, iron and vitamins, designed for women\'s health.'],
        ['PKG-FEV', 'Fever Panel', 'fever', ['CBC', 'DENGUE', 'MALARIA', 'WIDAL', 'CRP', 'URINE'], 1299, 2300, 'Find the cause of fever: dengue, malaria, typhoid and infection markers.'],
        ['PKG-VIT', 'Vitamin Profile (D + B12)', 'vitamins', ['VITD', 'VITB12'], 1499, 2800, 'The two most common deficiencies in India, tested together.'],
    ];
    foreach ($packages as $i => [$code, $name, $cat, $inc, $price, $mrp, $desc]) {
        $fast = in_array('LIPID', $inc, true) ? 12 : (in_array('FBS', $inc, true) ? 10 : 0);
        $ins->execute([$code, $name, 'package', $cat, $desc, in_array('URINE', $inc, true) ? 'Blood + Urine' : 'Blood', $fast, 24,
            array_sum(array_map(fn($c) => $params[$c] ?? 1, $inc)), json_encode($inc), $price, $mrp, 1, $i]);
    }
}
