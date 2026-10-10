import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('worker analysis links contact rows, sequence and 3D, caches results and exports provenance',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toContainText('Fresh result');
  await expect(page.locator('.sequence-residue.binding-residue').first()).toBeAttached();
  await page.getByRole('button',{name:/Inspect Salt-bridge candidate with ASP A:189/}).click();
  await expect(page.locator('.residue-identity')).toContainText('ASP');
  await expect(page.getByTestId('interaction-detail')).toContainText('positive_group');
  await expect(page.getByTestId('interaction-detail')).toContainText('candidate');
  await expect(page.locator('.sequence-residue[data-selected="true"]')).toHaveCount(1);
  // Picking the result focuses actual assembly atoms and draws a non-pickable dashed line.
  await page.locator('canvas').screenshot();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'JSON + provenance'}).click();
  const saved=await download;const json=JSON.parse(await readFile((await saved.path())!,'utf8'));
  expect(json.analysis.sourceHash).toHaveLength(64);expect(json.analysis.chemistrySources.some((s:{componentId:string})=>s.componentId==='BEN')).toBe(true);
  expect(json.analysis.interactions.some((i:{type:string})=>i.type==='salt_bridge')).toBe(true);
  expect(json.structure.positionsAngstrom).toHaveLength(1701*3);
  const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).click();
  const csv=await readFile((await (await csvDownload).path())!,'utf8');
  expect(csv).toContain('minimum_distance_angstrom');expect(csv).toContain('salt_bridge');
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toContainText('Cached result');
  await page.getByRole('spinbutton',{name:'Proximity cutoff',exact:true}).fill('4');
  await expect(page.locator('.analysis-summary')).toHaveCount(0);
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toContainText('Fresh result');
  await page.selectOption('[aria-label="Interaction type filter"]','proximity_contact');
  await expect(page.locator('.interaction-table tbody tr').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('missing ligand chemistry preserves contacts and changing structures cancels pending analysis',async({page})=>{
  await page.route('https://files.rcsb.org/ligands/**',route=>route.abort());
  await page.goto('/');await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/identity-edge-cases.cif'));
  await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toBeVisible();
  await expect(page.locator('.analysis-content')).toContainText('not evaluated');
  await page.selectOption('[aria-label="Interaction type filter"]','proximity_contact');
  await expect(page.locator('.interaction-table tbody tr').first()).toBeVisible();
  await page.getByRole('button',{name:/Show calculation settings/}).click();
  await page.selectOption('[aria-label="Alternate conformer policy"]','preferred_residue');
  await expect(page.locator('.analysis-summary')).toHaveCount(0);
  // Hold a definition request so cancellation is deterministic.
  await page.unroute('https://files.rcsb.org/ligands/**');
  await page.route('https://files.rcsb.org/ligands/**',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.abort();});
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.getByRole('button',{name:'Cancel analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toHaveCount(0);
  await expect(page.locator('.analysis-empty')).toContainText('cancelled');
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.locator('.example-button').nth(1).click();
  await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await expect(page.locator('.chain-button')).toHaveCount(4);
  await expect(page.locator('.analysis-summary')).toHaveCount(0);
});

test('loads missing CCD chemistry and reuses cached definitions without sending coordinates',async({page})=>{
  const ccd=await readFile('tests/fixtures/BEN-ccd.cif','utf8');
  let requests=0;
  await page.route('https://files.rcsb.org/ligands/download/BEN.cif',async route=>{requests++;await route.fulfill({body:ccd,contentType:'text/plain',headers:{'access-control-allow-origin':'*'}});});
  await page.goto('/');await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  const text=await readFile('public/structures/3PTB.cif','utf8');
  const stripped=text.replace(/loop_\s+_chem_comp_bond[\s\S]*?(?=#)/,'');
  await page.locator('input[type=file]').setInputFiles({name:'3ptb-without-bonds.cif',mimeType:'text/plain',buffer:Buffer.from(stripped)});
  await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toBeVisible();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'JSON + provenance'}).click();
  const json=JSON.parse(await readFile((await (await downloaded).path())!,'utf8'));
  expect(json.analysis.chemistrySources.find((c:{componentId:string})=>c.componentId==='BEN').source).toBe('ccd');
  expect(json.analysis.evaluation.salt_bridge.status).toBe('partially_evaluated');
  expect(requests).toBe(1);
  await page.getByRole('spinbutton',{name:'Proximity cutoff',exact:true}).fill('4');
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toBeVisible();
  expect(requests).toBe(1);
});

for(const scenario of [
  {file:'pi-stacking',type:'pi_stacking',detail:'Centroid distance (Å)'},
  {file:'cation-pi',type:'cation_pi',detail:'Offset (Å)'},
  {file:'metal-coordination',type:'metal_coordination',detail:'Metal: ZN'},
  {file:'water-bridge',type:'water_bridge',detail:'Water legs (Å)'},
  {file:'hydrogen-geometry',type:'steric_clash',detail:'Overlap (Å)'},
])test(`inspects ${scenario.type} geometry and exports its participants`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path.resolve(`tests/fixtures/${scenario.file}.cif`));
  await expect(page.getByText('Structure ready',{exact:true})).toBeVisible();
  if(scenario.type==='steric_clash') {
    await page.getByRole('button',{name:/Show calculation settings/}).click();
    await page.getByRole('spinbutton',{name:'Clash overlap minimum'}).fill('0.1');
    // The fixture's only overlap is a typed SER OG···O1 donor–acceptor pair, which ruleset ligand-3
    // reports as a short hydrogen bond; without chemical typing it remains a clash candidate.
    await page.getByRole('checkbox',{name:'Classify supported chemical interactions'}).uncheck();
  }
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await expect(page.locator('.analysis-summary')).toBeVisible();
  await page.selectOption('[aria-label="Interaction type filter"]',scenario.type);
  await page.locator('.interaction-table tbody tr').first().getByRole('button',{name:/Inspect/}).click();
  await expect(page.getByTestId('interaction-detail')).toContainText(scenario.detail);
  await page.locator('canvas').screenshot();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'JSON + provenance'}).click();
  const json=JSON.parse(await readFile((await (await downloaded).path())!,'utf8'));
  expect(json.schemaVersion).toBe(3);expect(json.analysis.interactions.some((i:{type:string})=>i.type===scenario.type)).toBe(true);
  if(scenario.type==='water_bridge'){
    expect(json.analysis.interactions.find((i:{type:string})=>i.type==='water_bridge').mediator.atomIndices).toHaveLength(1);
    await page.getByRole('button',{name:/Show calculation settings/}).click();
    await page.getByRole('checkbox',{name:'Include deposited-water bridges'}).uncheck();
    await expect(page.locator('.analysis-summary')).toHaveCount(0);
    await page.getByRole('button',{name:'Run analysis',exact:true}).click();
    await expect(page.locator('.analysis-summary')).toBeVisible();
    await expect(page.locator('.analysis-content')).toContainText('Deposited-water analysis was disabled');
    await expect(page.locator('.interaction-table tbody tr')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
