"""Generate pinned reference observations for the Phase 2.x validation set (V0).

Runs PLIP 3.0.0 and ProLIF on each case in validation/reference-set-cases.json and
writes validation/reference-set.json. Requires the reference environment described in
validation/README.md and PLIP_SOURCE pointing at a PLIP v3.0.0 checkout:
    PLIP_SOURCE=/path/to/plip python -I scripts/reference-set.py <work-dir>
Coordinates are public RCSB files; the mmCIF bytes used by the app are copied (gzipped)
into tests/fixtures/reference-set/ and their hashes recorded. No app code runs here.
"""
import gzip, hashlib, importlib.metadata, json, os, pathlib, subprocess, sys, tempfile, urllib.request, warnings
import xml.etree.ElementTree as ET

warnings.filterwarnings("ignore")
import gemmi
import MDAnalysis as mda
import prolif as plf
from openbabel import openbabel as ob, pybel
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem

RDLogger.DisableLog("rdApp.*")
ob.obErrorLog.SetOutputLevel(0)
ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path(sys.argv[1]).resolve()
WORK.mkdir(parents=True, exist_ok=True)
FIXTURES = ROOT / "tests/fixtures/reference-set"
FIXTURES.mkdir(parents=True, exist_ok=True)
PLIP_SOURCE = pathlib.Path(os.environ["PLIP_SOURCE"]).resolve()
PLIP_COMMIT = "017a4e35115f26af70f9e822a63766c800835d9d"
assert subprocess.check_output(["git", "-C", str(PLIP_SOURCE), "rev-parse", "HEAD"], text=True).strip() == PLIP_COMMIT

PLIP_KINDS = {"hydrophobic_interaction": "hydrophobic_contact", "hydrogen_bond": "hydrogen_bond", "water_bridge": "water_bridge",
              "salt_bridge": "salt_bridge", "pi_stack": "pi_stacking", "pi_cation_interaction": "cation_pi",
              "halogen_bond": "halogen_bond", "metal_complex": "metal_coordination"}
PROLIF_KINDS = {"Hydrophobic": "hydrophobic_contact", "HBDonor": "hydrogen_bond", "HBAcceptor": "hydrogen_bond",
                "Cationic": "salt_bridge", "Anionic": "salt_bridge", "PiStacking": "pi_stacking", "CationPi": "cation_pi",
                "PiCation": "cation_pi", "XBDonor": "halogen_bond", "XBAcceptor": "halogen_bond",
                "MetalDonor": "metal_coordination", "MetalAcceptor": "metal_coordination"}
ION_CHARGES = {"ZN": 2, "MN": 2, "MG": 2, "CA": 2, "K": 1, "NA": 1, "FE": 2, "CU": 2, "NI": 2, "CO": 2, "CD": 2}
sha = lambda b: hashlib.sha256(b).hexdigest()


def download(url, path):
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(url, timeout=120).read())
    return path.read_bytes()


def ccd_smiles(component):
    data = json.load(urllib.request.urlopen(f"https://data.rcsb.org/rest/v1/core/chemcomp/{component}", timeout=60))
    descriptors = data.get("pdbx_chem_comp_descriptor") or []
    for program in ("OpenEye OEToolkits", "CACTVS"):
        for d in descriptors:
            if d.get("type") == "SMILES_CANONICAL" and d.get("program") == program:
                return d["descriptor"]
    for d in descriptors:
        if d.get("type") == "SMILES":
            return d["descriptor"]
    return None


def run_plip(pdb_path, case):
    with tempfile.TemporaryDirectory() as out:
        env = {**os.environ, "PYTHONPATH": str(PLIP_SOURCE)}
        subprocess.run([sys.executable, str(PLIP_SOURCE / "plip/plipcmd.py"), "-f", str(pdb_path), "-x", "--nofix", "--nofixfile", "-o", out],
                       env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800)
        xml = ET.parse(next(pathlib.Path(out).glob("*_report.xml"))).getroot()
    anchor = f"{case['component']}:{case['authChain']}:{case['authNumber']}"
    site = None
    for s in xml.findall("bindingsite"):
        ids = s.find("identifiers")
        members = [m.text for m in ids.findall("members/member")]
        own = f"{ids.findtext('hetid')}:{ids.findtext('chain')}:{ids.findtext('position')}"
        if anchor == own or anchor in members:
            site = s
            break
    if site is None:
        return {"status": "ligand_not_analyzed", "observations": []}
    records = []
    for group in site.find("interactions"):
        for node in group:
            if node.tag not in PLIP_KINDS:
                continue
            fields = {item.tag: item.text for item in node if not len(item)}
            dist = fields.get("dist") or fields.get("dist_d-a") or fields.get("dist_h-a") or fields.get("centdist")
            records.append({"type": PLIP_KINDS[node.tag], "tool": node.tag,
                            "receptor": {"component": node.findtext("restype"), "authChain": node.findtext("reschain"), "authNumber": node.findtext("resnr")},
                            "distance": float(dist) if dist else None})
    ids = site.find("identifiers")
    return {"status": "ok", "site": {"hetid": ids.findtext("hetid"), "members": [m.text for m in ids.findall("members/member")]},
            "smiles": site.findtext("identifiers/smiles"), "observations": records}


def receptor_molecule(st, work, accession):
    """Polymer chains only, protonated by Open Babel at pH 7.4, as a ProLIF molecule.

    Open Babel's own bonds and formal charges are kept (written as V3000 SDF) instead of
    re-guessing bonds from distances. Residue labels come from the deposited structure:
    heavy atoms by exact coordinates, hydrogens from their bonded heavy atom. (Open Babel's
    own residue numbers/names are not reliable for every file, e.g. 1R55 and 1HQ2.)
    """
    receptor = st.clone()
    receptor.remove_ligands_and_waters()
    receptor.remove_hydrogens()
    receptor.remove_empty_chains()
    raw = work / f"{accession}-receptor.pdb"
    receptor.write_pdb(str(raw))
    mol = next(pybel.readfile("pdb", str(raw)))
    mol.OBMol.AddHydrogens(False, True, 7.4)
    deposited = {}
    for ch in receptor[0]:
        for res in ch:
            for a in res:
                deposited[(round(a.pos.x, 3), round(a.pos.y, 3), round(a.pos.z, 3))] = (a.name, res.name, res.seqid.num, ch.name)
    labels = []
    for atom in ob.OBMolAtomIter(mol.OBMol):
        if atom.GetAtomicNum() == 1:
            heavy = next(n for n in ob.OBAtomAtomIter(atom))
            key = (round(heavy.GetX(), 3), round(heavy.GetY(), 3), round(heavy.GetZ(), 3))
            name, resname, number, chain = deposited[key]
            labels.append(("H", resname, number, chain))
        else:
            labels.append(deposited[(round(atom.GetX(), 3), round(atom.GetY(), 3), round(atom.GetZ(), 3))])
    sdf = work / f"{accession}-receptor-h.sdf"
    mol.write("sdf", str(sdf), overwrite=True, opt={"3": None})
    rd = Chem.MolFromMolFile(str(sdf), removeHs=False, sanitize=False)
    if rd is None or rd.GetNumAtoms() != len(labels):
        raise ValueError("protonated receptor could not be read back with matching atoms")
    for atom, (name, resname, number, chain) in zip(rd.GetAtoms(), labels):
        atom.SetMonomerInfo(Chem.AtomPDBResidueInfo(name, residueName=resname, residueNumber=number, chainId=chain))
    Chem.SanitizeMol(rd)
    return plf.Molecule(rd)


def ligand_molecule(st, case, work):
    """Deposited ligand atoms with CCD-template bond orders (or Open Babel perception) and added hydrogens."""
    model = st[0]
    residues = []
    chain = model[case["authChain"]]
    if case.get("glycan"):
        # PDB-format files carry no entity types; select the recorded glycan residue names.
        residues = [r for r in chain if r.het_flag == "H" and r.name in set(case["glycan"])]
    else:
        residues = [r for r in chain if r.name == case["component"] and str(r.seqid.num) == case["authNumber"]]
    if not residues:
        raise ValueError("ligand residue not found")
    # Highest-occupancy conformer only, matching a single-conformer reference.
    sub = gemmi.Structure()
    sub.add_model(gemmi.Model("1"))
    sub[0].add_chain(gemmi.Chain(case["authChain"]))
    for r in residues:
        copy = r.clone()
        for i in range(len(copy) - 1, -1, -1):
            if copy[i].element.name == "H":
                del copy[i]
        sub[0][0].add_residue(copy)
    sub.setup_entities()
    sub.remove_alternative_conformations()
    path = work / f"{case['accession']}-{case['component']}-ligand.pdb"
    sub.write_pdb(str(path))
    if case["component"] in ION_CHARGES and len(residues) == 1 and len(residues[0]) == 1:
        atom = residues[0][0]
        mol = Chem.RWMol()
        a = Chem.Atom(atom.element.name.capitalize())
        a.SetFormalCharge(ION_CHARGES[case["component"]])
        a.SetNoImplicit(True)
        info = Chem.AtomPDBResidueInfo(atom.name, residueName=case["component"], residueNumber=int(case["authNumber"]), chainId=case["authChain"])
        a.SetMonomerInfo(info)
        mol.AddAtom(a)
        conf = Chem.Conformer(1)
        conf.SetAtomPosition(0, (atom.pos.x, atom.pos.y, atom.pos.z))
        mol.AddConformer(conf)
        mol = mol.GetMol()
        Chem.SanitizeMol(mol)
        return plf.Molecule.from_rdkit(mol), "ion"
    method = "ccd_template"
    mol = None
    if not case.get("glycan"):
        smiles = ccd_smiles(case["component"])
        pdb_mol = Chem.MolFromPDBFile(str(path), removeHs=True, proximityBonding=True)
        if smiles and pdb_mol is not None:
            try:
                template = Chem.MolFromSmiles(smiles)
                mol = AllChem.AssignBondOrdersFromTemplate(template, pdb_mol)
                Chem.SanitizeMol(mol)
            except Exception:
                mol = None
    if mol is None:
        method = "openbabel_perception"
        obmol = next(pybel.readfile("pdb", str(path)))
        sdf = work / f"{case['accession']}-{case['component']}-ligand.sdf"
        obmol.write("sdf", str(sdf), overwrite=True)
        mol = Chem.MolFromMolFile(str(sdf), removeHs=True, sanitize=True)
        # Restore residue information lost in SDF so ProLIF can name the ligand residue.
        ref = Chem.MolFromPDBFile(str(path), removeHs=True, sanitize=False)
        for atom, src in zip(mol.GetAtoms(), ref.GetAtoms()):
            atom.SetMonomerInfo(src.GetPDBResidueInfo())
    mol = Chem.AddHs(mol, addCoords=True, addResidueInfo=True)
    return plf.Molecule.from_rdkit(mol), method


def run_prolif(st, case, work, receptor):
    ligand, method = ligand_molecule(st, case, work)
    fp = plf.Fingerprint(list(PROLIF_KINDS), count=True)
    fp.run_from_iterable([ligand], receptor, progress=False)
    records = []
    for (lig_res, prot_res), interactions in fp.ifp[0].items():
        for name, metadata in interactions.items():
            for meta in metadata:
                records.append({"type": PROLIF_KINDS[name], "tool": name,
                                "receptor": {"component": prot_res.name, "authChain": prot_res.chain, "authNumber": str(prot_res.number)},
                                "distance": round(float(meta.get("distance")), 3) if meta.get("distance") is not None else None})
    return {"status": "ok", "ligandPreparation": method, "observations": records}


def prolif_child(index):
    case = json.loads((ROOT / "validation/reference-set-cases.json").read_text())["cases"][index]
    st = gemmi.read_structure(str(WORK / f"{case['accession']}.pdb"))
    st.setup_entities()
    try:
        result = run_prolif(st, case, WORK, receptor_molecule(st, WORK, case["accession"]))
    except Exception as error:
        result = {"status": "failed", "error": f"{type(error).__name__}: {str(error)[:300]}", "observations": []}
    print("PROLIF_RESULT " + json.dumps(result))


if len(sys.argv) > 3 and sys.argv[2] == "--prolif-case":
    prolif_child(int(sys.argv[3]))
    sys.exit(0)

cases = json.loads((ROOT / "validation/reference-set-cases.json").read_text())["cases"]
results = []
for case in cases:
    accession = case["accession"]
    cif = download(f"https://files.rcsb.org/download/{accession}.cif", WORK / f"{accession}.cif")
    pdb_path = WORK / f"{accession}.pdb"
    pdb = download(f"https://files.rcsb.org/download/{accession}.pdb", pdb_path)
    (FIXTURES / f"{accession}.cif.gz").write_bytes(gzip.compress(cif, mtime=0))
    st = gemmi.read_structure(str(pdb_path))
    st.setup_entities()
    entry = {"accession": accession, "ligand": {k: case[k] for k in ("component", "authChain", "authNumber")}, "tags": case["tags"],
             "cifSha256": sha(cif), "pdbSha256": sha(pdb)}
    try:
        entry["plip"] = run_plip(pdb_path, case)
    except Exception as error:
        entry["plip"] = {"status": "failed", "error": str(error)[:300], "observations": []}
    child = subprocess.run([sys.executable, "-I", "-W", "ignore", __file__, str(WORK), "--prolif-case", str(cases.index(case))],
                           capture_output=True, text=True, env={**os.environ, "PYTHONWARNINGS": "ignore"})
    line = next((l for l in child.stdout.splitlines() if l.startswith("PROLIF_RESULT ")), None)
    entry["prolif"] = json.loads(line[len("PROLIF_RESULT "):]) if line else {"status": "failed", "error": f"ProLIF process exited with code {child.returncode}", "observations": []}
    results.append(entry)
    print(accession, case["component"], entry["plip"]["status"], len(entry["plip"]["observations"]),
          entry["prolif"]["status"], len(entry["prolif"]["observations"]), entry["prolif"].get("ligandPreparation", entry["prolif"].get("error", "")), flush=True)

out = {"schemaVersion": 1, "generatedOn": "2026-10-10", "references": {
    "plip": {"tool": "PLIP", "version": "3.0.0", "commit": PLIP_COMMIT, "preparation": "Deposited PDB file; --nofix --nofixfile; default Open Babel hydrogen addition", "citation": "doi:10.1093/nar/gkaf361"},
    "prolif": {"tool": "ProLIF", "version": importlib.metadata.version("prolif"), "rdkit": importlib.metadata.version("rdkit"), "mdanalysis": importlib.metadata.version("MDAnalysis"),
               "preparation": "Receptor: polymer chains of the deposited PDB file, protonated by Open Babel at pH 7.4. Ligand: deposited heavy atoms (first conformer), bond orders from the RCSB CCD canonical SMILES template or Open Babel perception, RDKit-added hydrogens. Ions as single charged atoms. No waters.",
               "citation": "doi:10.1186/s13321-021-00548-6"},
    "environment": {"python": sys.version.split()[0], "openbabelWheel": importlib.metadata.version("openbabel-wheel"), "numpy": importlib.metadata.version("numpy"), "gemmi": importlib.metadata.version("gemmi")}},
    "cases": results}
(ROOT / "validation/reference-set.json").write_text(json.dumps(out, indent=1) + "\n")
