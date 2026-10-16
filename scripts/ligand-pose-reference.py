#!/usr/bin/env python3
"""Independent M4-B map enumeration and in-place RMSD. No application maps are read.
Run with the pinned environment documented in validation/LIGAND_POSE.md.
Reads frozen CCD/coordinate bytes with Gemmi, enumerates chirality-aware full-graph
RDKit matches, projects/deduplicates heavy maps, applies the already frozen numpy
protein transform, then uses CalcRMS (no ligand alignment; terminal symmetrization off).
"""
import gzip
import hashlib
import json
from pathlib import Path
import gemmi
import numpy as np
from rdkit import Chem, rdBase
from rdkit.Chem import rdMolAlign, rdCIPLabeler

ROOT = Path(__file__).resolve().parent.parent
VERSIONS = {"rdkit": "2026.03.6", "numpy": "2.4.2", "gemmi": "0.7.5"}
assert (rdBase.rdkitVersion, np.__version__, gemmi.__version__) == tuple(VERSIONS.values())

def digest(data):
    return hashlib.sha256(data).hexdigest()

def cif(path):
    data = (ROOT/path).read_bytes()
    if path.endswith('.gz'):
        data = gzip.decompress(data)
    return gemmi.cif.read_string(data.decode()).sole_block()

def ben():
    block = cif('tests/fixtures/BEN-ccd.cif')
    atoms = [dict(name=r[0], element=r[1], charge=int(r[2]), aromatic=r[3]=='Y', stereo=r[4])
             for r in block.find('_chem_comp_atom.', ['atom_id','type_symbol','charge','pdbx_aromatic_flag','pdbx_stereo_config'])]
    bonds = [dict(a=min(r[0],r[1]), b=max(r[0],r[1]), sourceOrder=r[2], order='AROM' if r[3]=='Y' else r[2], aromatic=r[3]=='Y', stereo=r[4])
             for r in block.find('_chem_comp_bond.', ['atom_id_1','atom_id_2','value_order','pdbx_aromatic_flag','pdbx_stereo_config'])]
    return dict(componentId='BEN', atoms=sorted(atoms,key=lambda a:a['name']), bonds=sorted(bonds,key=lambda b:(b['a'],b['b'])), containsMetal=False)

def molecule(graph):
    rw = Chem.RWMol()
    names = [a['name'] for a in graph['atoms']]
    for a in graph['atoms']:
        atom = Chem.Atom('H' if a['element'] in ['D','T'] else a['element'])
        if a['element'] in ['D','T']: atom.SetIsotope(2 if a['element']=='D' else 3)
        atom.SetFormalCharge(a['charge']); atom.SetIsAromatic(a['aromatic']); atom.SetNoImplicit(True)
        rw.AddAtom(atom)
    types = {'SING':Chem.BondType.SINGLE,'DOUB':Chem.BondType.DOUBLE,'TRIP':Chem.BondType.TRIPLE,'AROM':Chem.BondType.AROMATIC}
    for b in graph['bonds']:
        rw.AddBond(names.index(b['a']),names.index(b['b']),types[b['order']])
    mol = rw.GetMol()
    Chem.SanitizeMol(mol)
    for i,a in enumerate(graph['atoms']):
        if a['stereo'] in ['R','S']: mol.GetAtomWithIdx(i).SetChiralTag(Chem.ChiralType.CHI_TETRAHEDRAL_CW)
    rdCIPLabeler.AssignCIPLabels(mol)
    for i,a in enumerate(graph['atoms']):
        if a['stereo'] in ['R','S']:
            atom=mol.GetAtomWithIdx(i)
            assert atom.HasProp('_CIPCode'), (a,'not a recognized stereo center')
            if atom.GetProp('_CIPCode') != a['stereo']: atom.InvertChirality()
    rdCIPLabeler.AssignCIPLabels(mol)
    # BEN and generated E/Z fixtures have at most one non-H substituent per end,
    # except BEN C whose N2 outranks C1 by atomic number. Resolve that independently.
    for b in graph['bonds']:
        if b['stereo'] in ['E','Z']:
            i,j=names.index(b['a']),names.index(b['b'])
            def priority(k,other):
                adjacent=[a for a in mol.GetAtomWithIdx(k).GetNeighbors() if a.GetIdx()!=other]
                ranks=[(a.GetAtomicNum(),a.GetIsotope()) for a in adjacent]
                assert len(ranks)==len(set(ranks)), 'reference fixture needs deeper CIP priority handling'
                return max(adjacent,key=lambda a:(a.GetAtomicNum(),a.GetIsotope())).GetIdx()
            bond=mol.GetBondBetweenAtoms(i,j)
            bond.SetStereoAtoms(priority(i,j),priority(j,i))
            bond.SetStereo(Chem.BondStereo.STEREOE if b['stereo']=='E' else Chem.BondStereo.STEREOZ)
    return mol

def from_smiles(smiles, component):
    mol=Chem.AddHs(Chem.MolFromSmiles(smiles))
    rdCIPLabeler.AssignCIPLabels(mol)
    names=[f'A{i:02d}' for i in range(mol.GetNumAtoms())]
    atoms=[dict(name=names[a.GetIdx()],element=a.GetSymbol(),charge=a.GetFormalCharge(),aromatic=a.GetIsAromatic(),
                stereo=a.GetProp('_CIPCode') if a.HasProp('_CIPCode') else 'N') for a in mol.GetAtoms()]
    orders={Chem.BondType.SINGLE:'SING',Chem.BondType.DOUBLE:'DOUB',Chem.BondType.TRIPLE:'TRIP',Chem.BondType.AROMATIC:'AROM'}
    bonds=[dict(a=names[b.GetBeginAtomIdx()],b=names[b.GetEndAtomIdx()],sourceOrder=orders[b.GetBondType()],order=orders[b.GetBondType()],
                aromatic=b.GetIsAromatic(),stereo={Chem.BondStereo.STEREOE:'E',Chem.BondStereo.STEREOZ:'Z'}.get(b.GetStereo(),'N')) for b in mol.GetBonds()]
    return dict(componentId=component,atoms=atoms,bonds=bonds,containsMetal=False)

def mappings(graph):
    mol=molecule(graph)
    heavy=[i for i,a in enumerate(graph['atoms']) if a['element'] not in ['H','D','T']]
    # Full atom graph matching with explicit H; project only after chirality constraints.
    raw=mol.GetSubstructMatches(mol,uniquify=False,useChirality=True,maxMatches=100000)
    assert len(raw)<100000, 'reference enumeration exhausted'
    maps=sorted(set(tuple(heavy.index(m[i]) for i in heavy) for m in raw))
    return mol,heavy,[list(m) for m in maps]

def coordinates(path):
    block=cif(path)
    table=block.find('_atom_site.', ['label_comp_id','label_asym_id','auth_seq_id','label_atom_id','Cartn_x','Cartn_y','Cartn_z'])
    selected=[r for r in table if r[0]=='BEN']
    identity=(selected[0][1],selected[0][2])
    # Match the application's Float32 assembly snapshot, then calculate in Float64.
    return {r[3]:np.array([float(v) for v in list(r)[4:]],dtype=np.float32).astype(float).tolist()
            for r in selected if (r[1],r[2])==identity}

def evaluate(name,graph,reference,comparison,transform,origin):
    mol,heavy,maps=mappings(graph)
    names=[graph['atoms'][i]['name'] for i in heavy]
    x=np.array(reference); y=np.array(comparison)
    matrix=np.array(transform).reshape((4,4),order='F')
    moved=y@matrix[:3,:3].T+matrix[:3,3]
    ref,cmp=Chem.Mol(mol),Chem.Mol(mol)
    for m,coords in [(ref,x),(cmp,moved)]:
        conf=Chem.Conformer(m.GetNumAtoms())
        for i,p in zip(heavy,coords): conf.SetAtomPosition(i,p.tolist())
        m.AddConformer(conf)
    rd_maps=[[(heavy[j],heavy[i]) for i,j in enumerate(m)] for m in maps]
    score=rdMolAlign.CalcRMS(cmp,ref,map=rd_maps,symmetrizeConjugatedTerminalGroups=False)
    values=[float(np.sqrt(np.mean(np.sum((x-moved[m])**2,axis=1)))) for m in maps]
    assert abs(score-min(values))<1e-10
    identity=list(range(len(heavy)))
    return dict(name=name,origin=origin,graph=graph,atomNames=names,reference=reference,comparison=comparison,transform=transform,
                maps=maps,rmsdAngstrom=score,nameMatchedRmsdAngstrom=values[maps.index(identity)],
                minimumMaps=[m for m,v in zip(maps,values) if abs(v-min(values))<=1e-12])

def main():
    identity=np.eye(4).reshape(-1,order='F').tolist()
    cases=[]
    for name,smiles in [('ring','C1CCC1'),('asymmetric','CC(O)F'),('tetrahedral','F[C@](Cl)(Br)I'),
                        ('paired-stereo','C[C@H](F)[C@@H](F)C'),('alkene','F/C=C/F')]:
        graph=from_smiles(smiles,name.upper())
        _,heavy,maps=mappings(graph)
        n=len(heavy)
        # Artificial, deliberately irregular coordinates. They are not molecular conformations.
        coords=[[float(i),float((i*i+2)%7),float((3*i+1)%5)] for i in range(n)]
        moved=[p[:] for p in coords]
        chosen=maps[-1]
        for i,j in enumerate(chosen): moved[j]=coords[i]
        cases.append(evaluate(name,graph,coords,moved,identity,{'syntheticSmiles':smiles,'coordinates':'artificial algebraic test vectors'}))
    graph=ben(); names=[a['name'] for a in graph['atoms'] if a['element'] not in ['H','D','T']]
    x=coordinates('public/structures/3PTB.cif'); y=coordinates('tests/fixtures/biology/1S0R.cif.gz')
    fits=json.loads((ROOT/'validation/comparison.json').read_text())['superposition']
    for scope in ['global','site']:
        key=f'3PTB-1S0R-{scope}'
        cases.append(evaluate(key,graph,[x[n] for n in names],[y[n] for n in names],fits[key]['transform'],{'proteinFit':key,'coordinates':'deposited, Float32 snapshot precision'}))
    sources=['tests/fixtures/BEN-ccd.cif','public/structures/3PTB.cif','tests/fixtures/biology/1S0R.cif.gz','validation/comparison.json']
    output=dict(schemaVersion=1,tools=VERSIONS,options={'useChirality':True,'uniquify':False,'maxMatches':100000,'symmetrizeConjugatedTerminalGroups':False,
                'metric':'CalcRMS after frozen protein transform; no ligand fit','hydrogens':'explicit in graph; unique heavy-atom maps scored'},
                sources=[dict(path=p,sha256=digest((ROOT/p).read_bytes())) for p in sources],cases=cases)
    target=ROOT/'tests/fixtures/ligand-pose/reference.json'
    target.write_text(json.dumps(output,indent=2)+'\n')
    manifest = dict(schemaVersion=1, note='Independent observations and the generator are pinned together. Existing coordinate/CCD source hashes are inside reference.json.',
                    files=[dict(path=p, sha256=digest((ROOT/p).read_bytes())) for p in
                           ['tests/fixtures/ligand-pose/reference.json','scripts/ligand-pose-reference.py']])
    (ROOT/'tests/fixtures/ligand-pose/reference-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    for c in cases: print(c['name'],len(c['maps']),c['rmsdAngstrom'],c['nameMatchedRmsdAngstrom'])

if __name__=='__main__': main()
