"""Regenerate external validation observations; no PLIP source is included in the app.
Requires Python 3.12, PLIP source v3.0.0 (see validation/README.md), Open Babel,
lxml and numpy. Invoke with PLIP_SOURCE=/path/to/plip python scripts/plip-reference.py.
Only deposited PDB files in the repository are sent to the local reference tool.
"""
import hashlib, importlib.metadata, json, os, pathlib, subprocess, sys, tempfile
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(os.environ['PLIP_SOURCE']).resolve()
COMMIT = '017a4e35115f26af70f9e822a63766c800835d9d'
assert subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
KINDS = {'hydrophobic_interaction':'hydrophobic_contact','hydrogen_bond':'hydrogen_bond','water_bridge':'water_bridge','salt_bridge':'salt_bridge','pi_stack':'pi_stacking','pi_cation_interaction':'cation_pi','metal_complex':'metal_coordination'}
result = {'schemaVersion':1,'reference':{'tool':'PLIP','version':'3.0.0','commit':COMMIT,'openbabelWheel':importlib.metadata.version('openbabel-wheel'),'numpy':importlib.metadata.version('numpy'),'lxml':importlib.metadata.version('lxml'),'preparation':'--nofix --nofixfile; default local hydrogen addition; no coordinate relaxation','citation':'doi:10.1093/nar/gkaf361'},'cases':[]}
for accession, component, number in [('3PTB','BEN','1'),('1EVE','E20','2001'),('1RMD','ZN','119')]:
    path = ROOT / 'tests/fixtures/reference' / f'{accession}.pdb'
    with tempfile.TemporaryDirectory() as out:
        env = {**os.environ, 'PYTHONPATH':str(SOURCE)}
        subprocess.run([sys.executable, str(SOURCE/'plip/plipcmd.py'),'-f',str(path),'-x','--nofix','--nofixfile','-o',out],env=env,check=True,stdout=subprocess.DEVNULL)
        report_path = next(pathlib.Path(out).glob('*_report.xml'))
        xml = ET.parse(report_path).getroot()
        site = next(s for s in xml.findall('bindingsite') if s.findtext('identifiers/hetid') == component and s.findtext('identifiers/position') == number)
        records = []
        for group in site.find('interactions'):
            for node in group:
                if node.tag not in KINDS: continue
                record = {'type':KINDS[node.tag], 'receptor':{'component':node.findtext('restype'),'authChain':node.findtext('reschain'),'authNumber':node.findtext('resnr')}, 'fields':{}}
                for item in node:
                    if len(item): record['fields'][item.tag] = [float(c.text) for c in item] if item.tag.endswith('coo') else [c.text for c in item]
                    else: record['fields'][item.tag] = item.text
                records.append(record)
        result['cases'].append({'accession':accession,'ligand':{'component':component,'authChain':'A','authNumber':number},'pdbSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'cifSha256':hashlib.sha256(path.with_suffix('.cif').read_bytes()).hexdigest(),'ligandPerception':{'smiles':site.findtext('identifiers/smiles'),'aromaticRingCount':int(site.findtext('lig_properties/num_aromatic_rings'))},'observations':records})
(ROOT/'validation/plip-reference.json').write_text(json.dumps(result,indent=2)+'\n')
