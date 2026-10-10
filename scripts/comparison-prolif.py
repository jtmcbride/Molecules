#!/usr/bin/env python3
"""ProLIF 2.2.2 observations for the Phase 4 fingerprint pairs (validation only; not CI).

Runs the same receptor and ligand preparation as scripts/reference-set.py on each
structure of the comparison fixture pairs and writes the "prolif" section of
validation/comparison.json. tests/comparison-fingerprint.test.ts maps the observed residues
to UniProt positions with the application's SIFTS correspondence and compares the
interactions gained and lost between structures with the application's fingerprints.

    python -I scripts/comparison-prolif.py <work-dir>
"""
import importlib.metadata
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import warnings

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("reference_set", ROOT / "scripts/reference-set.py")
rs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rs)

# Ligand component per structure; the first instance in the given author chain is used,
# matching the application's default comparison ligand.
# 4HHB is not used: Open Babel fragments its 1984 heme propionate geometry (an epoxide-like
# ring and a separate formate), and ProLIF then reports no interactions at all.
STRUCTURES = {"3PTB": ("BEN", "A"), "1S0R": ("BEN", "A"), "2DN2": ("HEM", "A"), "2DN1": ("HEM", "A")}


def child(work, accession):
    import gemmi

    component, chain = STRUCTURES[accession]
    st = gemmi.read_structure(str(work / f"{accession}.pdb"))
    st.setup_entities()
    residue = next(r for r in st[0][chain] if r.name == component)
    case = {"accession": accession, "component": component, "authChain": chain, "authNumber": str(residue.seqid.num)}
    result = rs.run_prolif(st, case, work, rs.receptor_molecule(st, work, accession))
    result["ligand"] = {k: case[k] for k in ("component", "authChain", "authNumber")}
    print("PROLIF_RESULT " + json.dumps(result))


def main():
    work = pathlib.Path(sys.argv[1]).resolve()
    work.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 3 and sys.argv[2] == "--child":
        child(work, sys.argv[3])
        return
    results = {}
    for accession in STRUCTURES:
        pdb = rs.download(f"https://files.rcsb.org/download/{accession}.pdb", work / f"{accession}.pdb")
        # ProLIF runs in a subprocess, as in the reference set (it can crash on some inputs).
        run = subprocess.run([sys.executable, "-I", "-W", "ignore", __file__, str(work), "--child", accession],
                             capture_output=True, text=True, env={**os.environ, "PYTHONWARNINGS": "ignore"})
        line = next((l for l in run.stdout.splitlines() if l.startswith("PROLIF_RESULT ")), None)
        result = json.loads(line[len("PROLIF_RESULT "):]) if line else {"status": "failed", "error": run.stderr[-300:], "observations": []}
        result["observations"].sort(key=lambda o: json.dumps(o, sort_keys=True))
        result["pdbSha256"] = rs.sha(pdb)
        results[accession] = result
        print(accession, result["status"], len(result["observations"]), flush=True)
    path = ROOT / "validation/comparison.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    data["prolif"] = results
    data["prolifTool"] = {
        "tool": "ProLIF", "version": importlib.metadata.version("prolif"), "rdkit": importlib.metadata.version("rdkit"),
        "preparation": "As validation/reference-set.json: polymer chains of the deposited PDB file protonated by Open Babel at pH 7.4; "
                       "deposited ligand heavy atoms with CCD-template bond orders and RDKit hydrogens; no waters.",
    }
    path.write_text(json.dumps(data, indent=1) + "\n")


if __name__ == "__main__":
    main()
