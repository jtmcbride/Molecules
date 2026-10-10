"""Select the Phase 2.x reference validation set (V0) from written criteria.

Run in the reference environment described in validation/README.md:
    python -I scripts/reference-set-select.py <download-dir>
Writes validation/reference-set-cases.json. Selection queries RCSB once; the
written case list (with criteria and observed values) is the pinned record.
"""
import gemmi, json, math, pathlib, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOWNLOADS = pathlib.Path(sys.argv[1]).resolve()
DOWNLOADS.mkdir(parents=True, exist_ok=True)

# Astex Diverse Set (Hartshorn et al., J. Med. Chem. 50, 726 (2007)): PDB ID and ligand
# component, as listed by the BioinfoMachineLearning/astex_diverse_set dataset (85 entries).
ASTEX = """1MMV_3AR 1L2S_STC 1N46_PFA 1Y6B_AAX 1YWR_LI9 1YV3_BIT 1R9O_FLP 1IG3_VIB 1R58_AO5 1YGC_905
1GPK_HUP 1HNN_SKF 1K3U_IAD 1Q1G_MTI 1GM8_SOX 1OPK_P16 1U1C_BAU 1T46_STI 1HQ2_PH2 1N2V_BDI 1S19_MC9
1OYT_FSN 1XM6_5RM 1TZ8_DES 2BSM_BSM 1P2Y_NCT 1V0P_PVB 1KZK_JE2 1R55_097 1SG0_STL 1L7F_BCZ 1NAV_IH5
1W2G_THM 1Z95_198 1YVF_PH7 1X8X_TYR 1HWI_115 1S3V_TQD 1W1P_GIO 1U4D_DBQ 1V4S_MRK 1OF1_SCT 1V48_HA1
1Q4G_BFL 1JJE_BYS 1XOQ_ROF 1M2Z_DEX 1P62_GEO 1LRH_NLA 1SJ0_E4D 1MEH_MOA 1PMN_984 1SQN_NDR 1GKC_NFH
1T40_ID5 1UML_FR4 1UNL_RRC 1OF6_DTY 1JD0_AZM 1N2J_PAF 1J3J_CP6 1MZC_BNE 1OWE_675 1T9B_1CS 1JLA_TNK
2BR1_PFP 1G9V_RQ3 2BM2_PM2 1XOZ_CIA 1SQ5_PAU 1YQY_915 1IA1_TQ3 1HVY_D16 1HWW_SWA 1TT1_KAI 1Q41_IXM
1N1M_A3M 1KE5_LS1 1HP0_AD3 1UOU_CMU 1TOW_CRZ 1LPZ_CMB 1VCJ_IBA 1R1H_BIR 1OQ5_CEL""".split()
assert len(ASTEX) == 85
ASTEX_SUBSET_SIZE = 15

# Verified 2026-10-10 (docs/PHASE_2X_PLAN.md) and existing fixtures.
TARGETED = [
    ("5P9J", "8E8", ["covalent"], "Ibrutinib–BTK, Cys481 covalent link recorded in struct_conn"),
    ("4G5J", "0WN", ["covalent", "halogen"], "Afatinib–EGFR, Cys797 covalent link recorded in struct_conn"),
    ("1J91", "TBS", ["halogen"], "Tetrabromobenzotriazole–CK2α"),
    ("1K4C", "K", ["metal"], "KcsA potassium sites"),
    ("1ATP", "ATP", ["cofactor_metal"], "ATP with Mn2+ coordinated by phosphates"),
    ("1ATP", "MN", ["metal"], "Mn2+ site"),
    ("3PTB", "BEN", ["existing"], "Existing PLIP reference"),
    ("1EVE", "E20", ["existing", "aromatic"], "Existing PLIP reference"),
    ("1RMD", "ZN", ["existing", "metal"], "Existing PLIP reference"),
]
SKIP_LIGANDS = {"HOH", "SO4", "GOL", "EDO", "PEG", "DMS", "ACT", "CL", "NA", "PO4", "MPD", "FMT", "IOD", "BR"}
POLAR = {"SER", "THR", "TYR", "ASN", "GLN", "HIS", "ASP", "GLU", "LYS", "ARG", "CYS", "TRP"}


def get_json(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(request, timeout=60))


def entry_info(pdb):
    e = get_json(f"https://data.rcsb.org/rest/v1/core/entry/{pdb}")
    info = e.get("rcsb_entry_info", {})
    return {"atoms": info.get("deposited_atom_count"), "resolution": (info.get("resolution_combined") or [None])[0], "title": e["struct"]["title"]}


def structure(pdb):
    path = DOWNLOADS / f"{pdb}.cif"
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(f"https://files.rcsb.org/download/{pdb}.cif", timeout=120).read())
    st = gemmi.read_structure(str(path))
    st.setup_entities()
    return st


def ligand_instances(st, component):
    return [(ch, res) for ch in st[0] for res in ch if res.name == component]


def altloc_residues_near(st, component, cutoff=5.0):
    """Polymer residues with alternate conformers within cutoff of the first instance of the ligand."""
    found = ligand_instances(st, component)
    if not found:
        return []
    _, lig = found[0]
    points = [a.pos for a in lig]
    near = set()
    for ch in st[0]:
        for res in ch:
            if res.het_flag != "A":
                continue
            if any(a.has_altloc() for a in res) and any(a.pos.dist(p) < cutoff for a in res for p in points):
                near.add((ch.name, res.name, str(res.seqid.num) + (res.seqid.icode.strip() or "")))
    return sorted(near)


def glycan_candidates():
    query = {
        "query": {"type": "group", "logical_operator": "and", "nodes": [
            {"type": "terminal", "service": "text", "parameters": {"attribute": "rcsb_entry_info.branched_entity_count", "operator": "greater_or_equal", "value": 1}},
            {"type": "terminal", "service": "text", "parameters": {"attribute": "rcsb_entry_info.resolution_combined", "operator": "less_or_equal", "value": 1.8}},
            {"type": "terminal", "service": "text", "parameters": {"attribute": "rcsb_entry_info.deposited_atom_count", "operator": "less_or_equal", "value": 5000}},
            {"type": "terminal", "service": "text", "parameters": {"attribute": "exptl.method", "operator": "exact_match", "value": "X-RAY DIFFRACTION"}},
        ]},
        "return_type": "entry",
        "request_options": {"paginate": {"start": 0, "rows": 150}, "sort": [{"sort_by": "rcsb_entry_info.deposited_atom_count", "direction": "asc"}]},
    }
    return [r["identifier"] for r in get_json("https://search.rcsb.org/rcsbsearch/v2/query", query)["result_set"]]


def glycan_choice(pdb):
    """First N-linked branched glycan (>=3 sugars, covalently linked to Asn ND2) contacting >=3 protein residues (4 Å)."""
    st = structure(pdb)
    linked = set()
    for con in st.connections:
        if con.type != gemmi.ConnectionType.Covale:
            continue
        for a, b in ((con.partner1, con.partner2), (con.partner2, con.partner1)):
            if a.res_id.name == "ASN" and a.atom_name == "ND2":
                linked.add(b.chain_name)
    for ch in st[0]:
        sugars = [r for r in ch if r.het_flag == "H" and r.entity_type == gemmi.EntityType.Branched]
        if len(sugars) < 3 or ch.name not in linked:
            continue
        points = [a.pos for r in sugars for a in r]
        contacts = {(c.name, r.seqid.num) for c in st[0] for r in c if r.het_flag == "A" and any(a.pos.dist(p) < 4.0 for a in r for p in points)}
        if len(contacts) >= 3:
            anchor = sugars[0]
            return {"chain": ch.name, "anchor": anchor.name, "anchorNumber": str(anchor.seqid.num), "residues": [r.name for r in sugars], "proteinContacts": len(contacts)}
    return None


cases = []
astex = []
for item in ASTEX:
    pdb, component = item.split("_")
    astex.append({"pdb": pdb, "component": component, **entry_info(pdb)})
astex.sort(key=lambda c: (c["atoms"], c["pdb"]))
for c in astex[:ASTEX_SUBSET_SIZE]:
    cases.append({"accession": c["pdb"], "component": c["component"], "tags": ["astex"], "reason": f"Astex Diverse Set; {ASTEX_SUBSET_SIZE} smallest by deposited atom count ({c['atoms']} atoms)"})

# Altloc case: smallest Astex complex with >=2 alternate-conformer residues near the ligand, >=1 polar.
altloc = None
for c in astex:
    st = structure(c["pdb"])
    near = altloc_residues_near(st, c["component"])
    if len(near) >= 2 and any(r[1] in POLAR for r in near):
        altloc = {"accession": c["pdb"], "component": c["component"], "tags": ["astex", "altloc"], "reason": f"Smallest Astex complex with alternate conformers on >=2 residues within 5 Å of the ligand, >=1 polar: {', '.join(f'{r[1]} {r[0]}:{r[2]}' for r in near)}"}
        break
if altloc:
    cases = [x for x in cases if x["accession"] != altloc["accession"]] + [altloc]

glycan = None
for pdb in glycan_candidates():
    choice = glycan_choice(pdb)
    if choice:
        glycan = {"accession": pdb, "component": choice["anchor"], "authChain": choice["chain"], "authNumber": choice["anchorNumber"], "tags": ["glycan"], "glycan": choice["residues"], "reason": f"Smallest X-ray entry (<=1.8 Å, <=5000 atoms) with an N-linked branched glycan of >=3 residues contacting >=3 protein residues; {len(choice['residues'])} sugars, {choice['proteinContacts']} contacting residues. Until R6, the app analyzes the anchor residue only."}
        break
if glycan:
    cases.append(glycan)

for pdb, component, tags, reason in TARGETED:
    cases.append({"accession": pdb, "component": component, "tags": tags, "reason": reason})

for case in cases:
    st = structure(case["accession"])
    instances = ligand_instances(st, case["component"])
    if "authNumber" not in case:
        ch, res = instances[0]
        case["authChain"], case["authNumber"] = ch.name, str(res.seqid.num)
    case.update({k: v for k, v in entry_info(case["accession"]).items() if k != "title"})

out = {"schemaVersion": 1, "selectedOn": "2026-10-10", "criteria": {
    "astexSubset": f"The {ASTEX_SUBSET_SIZE} Astex Diverse Set complexes with the fewest deposited atoms",
    "altloc": "Smallest Astex complex with alternate conformers on >=2 polymer residues within 5 Å of the ligand's first instance, >=1 polar",
    "glycan": "Smallest X-ray entry (<=1.8 Å, <=5000 atoms) with an N-linked branched glycan (>=3 sugars, covalent link to Asn ND2) contacting >=3 protein residues within 4 Å",
    "targeted": "Entries verified in docs/PHASE_2X_PLAN.md and the existing PLIP reference cases",
    "ligandInstance": "First instance of the component in model 1 unless stated"}, "cases": cases}
(ROOT / "validation/reference-set-cases.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps([(c["accession"], c["component"], c["tags"], c.get("atoms")) for c in cases]))
