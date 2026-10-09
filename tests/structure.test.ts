import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CIF } from 'molstar/lib/mol-io/reader/cif';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif';
import { Structure, StructureSymmetry } from 'molstar/lib/mol-model/structure';
import { Task } from 'molstar/lib/mol-task';
import { extractSnapshot } from '../src/structure/extract';
import { choosePreferredConformer, identity } from '../src/domain/identity';
import { normalizeAccession } from '../src/data/provider';
import type { StructureSource } from '../src/domain/types';

async function parseFixture(path: string, modelIndex = 0, assemblyId = '') {
  const bytes = new Uint8Array(await readFile(path));
  const binary = path.endsWith('.bcif');
  const parsed = await CIF.parse(binary ? bytes : new TextDecoder().decode(bytes)).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
  const frame = trajectory.getFrameAtIndex(modelIndex);
  const model = Task.is(frame) ? await frame.run() : frame;
  let structure = Structure.ofModel(model);
  if (assemblyId) structure = await StructureSymmetry.buildAssembly(structure, assemblyId).run();
  const source: StructureSource = { id: path, name: path, kind: 'local', binary, format: 'mmcif', bytes, contentHash: createHash('sha256').update(bytes).digest('hex'), fetchedAt: '2026-01-01T00:00:00Z' };
  return { ...extractSnapshot(structure, source, modelIndex, assemblyId), structure, trajectory };
}

describe('structural identity and geometry', () => {
  it('preserves author identifiers, insertion codes, unresolved sequence positions, and null nonpolymer numbering', async () => {
    const { snapshot, selectionIndex } = await parseFixture('tests/fixtures/identity-edge-cases.cif');
    expect(snapshot.atomBuffer.atomCount).toBe(9);
    const chain = snapshot.chains.find(c => c.type === 'polymer')!;
    expect(chain.labelAsymId).toBe('A'); expect(chain.authAsymId).toBe('X');
    expect(chain.sequence.map(p => p.code).join('')).toBe('ASG');
    expect(chain.sequence[1].residueIds).toHaveLength(0);
    const ala = snapshot.residues.find(r => r.componentId === 'ALA')!;
    expect(ala.authSeqId).toBe('10'); expect(ala.insertionCode).toBe('A'); expect(ala.labelSeqId).toBe(1);
    const ligand = snapshot.residues.find(r => r.componentId === 'BEN')!;
    expect(ligand.labelSeqId).toBeNull(); expect(ligand.authSeqId).toBe('401');
    expect(snapshot.ligands).toHaveLength(1);
    expect(selectionIndex.locationsByResidue.get(ala.id)).toHaveLength(5);
    const atomIndex = ala.atomIndices.find(i => snapshot.atoms[i].name === 'CA' && snapshot.atoms[i].altId === 'B')!;
    expect([...snapshot.atomBuffer.positions.slice(atomIndex * 3, atomIndex * 3 + 3)]).toEqual([1, 1, 0]);
    expect(snapshot.atoms[atomIndex].formalCharge).toBeNull();
  });
  it('selects one coherent alternate conformer, including shared atoms', async () => {
    const { snapshot } = await parseFixture('tests/fixtures/identity-edge-cases.cif');
    const ala = snapshot.residues.find(r => r.componentId === 'ALA')!;
    expect(ala.preferredAltId).toBe('B');
    const preferred = [...snapshot.atomBuffer.preferredAtomIndices].filter(i => ala.atomIndices.includes(i)).map(i => snapshot.atoms[i]);
    expect(preferred.map(a => a.name).sort()).toEqual(['C', 'CA', 'N']);
    expect(preferred.filter(a => a.altId).every(a => a.altId === 'B')).toBe(true);
  });
  it('keeps assembly copies distinct and applies assembly transforms to extracted coordinates', async () => {
    const { snapshot } = await parseFixture('tests/fixtures/identity-edge-cases.cif', 0, '1');
    expect(snapshot.atomBuffer.atomCount).toBe(18);
    expect(snapshot.chains.filter(c => c.type === 'polymer')).toHaveLength(2);
    expect(snapshot.ligands).toHaveLength(2);
    expect(new Set(snapshot.atoms.map(a => a.id)).size).toBe(18);
    const ligandAtoms = snapshot.ligands.map(l => {
      const residue = snapshot.residues.find(r => r.id === l.residueId)!;
      return snapshot.atomBuffer.positions[residue.atomIndices[0] * 3];
    }).sort((a, b) => a - b);
    expect(ligandAtoms).toEqual([5, 25]);
    expect(snapshot.chains.every(c => c.transform.length === 16)).toBe(true);
  });
  it('keeps structural models separate and produces reproducible IDs', async () => {
    const first = await parseFixture('tests/fixtures/identity-edge-cases.cif');
    const again = await parseFixture('tests/fixtures/identity-edge-cases.cif');
    const second = await parseFixture('tests/fixtures/identity-edge-cases.cif', 1);
    expect(first.snapshot.id).toBe(again.snapshot.id);
    expect(first.snapshot.atoms.map(a => a.id)).toEqual(again.snapshot.atoms.map(a => a.id));
    expect(second.snapshot.modelNumber).toBe(2); expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(second.snapshot.atomBuffer.atomCount).toBe(7);
    expect(second.snapshot.atomBuffer.positions[2]).toBe(5);
  });
  it('parses real trypsin and identifies benzamidine independently from the polymer chain', async () => {
    const { snapshot } = await parseFixture('public/structures/3PTB.cif');
    expect(snapshot.atomBuffer.atomCount).toBe(1701);
    expect(snapshot.chains.filter(c => c.type === 'polymer')).toHaveLength(1);
    const ligand = snapshot.ligands.find(l => l.componentId === 'BEN')!;
    expect(ligand).toBeDefined();
    const residue = snapshot.residues.find(r => r.id === ligand.residueId)!;
    expect(residue.atomIndices).toHaveLength(9);
    expect(snapshot.chains.find(c => c.id === residue.chainId)?.type).toBe('non-polymer');
  });
  it('preserves all four hemoglobin chains and repeated heme instances', async () => {
    const { snapshot } = await parseFixture('public/structures/4HHB.cif');
    expect(snapshot.chains.filter(c => c.type === 'polymer')).toHaveLength(4);
    const hemes = snapshot.ligands.filter(l => l.componentId === 'HEM');
    expect(hemes).toHaveLength(4);
    expect(new Set(hemes.map(l => l.residueId)).size).toBe(4);
  });
  it('extracts matching observed geometry from mmCIF and BinaryCIF', async () => {
    const text = await parseFixture('public/structures/3PTB.cif');
    const binary = await parseFixture('tests/fixtures/3PTB.bcif');
    expect(binary.snapshot.atomBuffer.atomCount).toBe(text.snapshot.atomBuffer.atomCount);
    expect(binary.snapshot.ligands.map(l => l.componentId)).toEqual(text.snapshot.ligands.map(l => l.componentId));
    expect(binary.snapshot.atoms.map(a => a.name)).toEqual(text.snapshot.atoms.map(a => a.name));
    const textPositions = text.snapshot.atomBuffer.positions;
    const binaryPositions = binary.snapshot.atomBuffer.positions;
    let maximumError = 0;
    for (let i = 0; i < textPositions.length; i++) maximumError = Math.max(maximumError, Math.abs(textPositions[i] - binaryPositions[i]));
    expect(maximumError).toBeLessThan(0.001);
  });
});
describe('input policies', () => {
  it('creates collision-free compound identities', () => {
    expect(identity('A:B', 'C')).not.toBe(identity('A', 'B:C'));
    expect(identity('A', null)).not.toBe(identity('A', 'null'));
  });
  it('chooses alternate IDs deterministically on equal occupancy', () => {
    const atoms = [{ index: 1, name: 'CA', altId: 'B', occupancy: .5 }, { index: 0, name: 'CA', altId: 'A', occupancy: .5 }];
    expect(choosePreferredConformer(atoms)).toEqual({ preferredAltId: 'A', indices: [0] });
    expect(choosePreferredConformer([...atoms].reverse())).toEqual(choosePreferredConformer(atoms));
  });
  it('accepts normalized and extended accessions and rejects URLs or malformed IDs', () => {
    expect(normalizeAccession(' 3ptb ')).toBe('3PTB');
    expect(normalizeAccession('pdb_00003ptb')).toBe('PDB_00003PTB');
    expect(() => normalizeAccession('../file')).toThrow();
    expect(() => normalizeAccession('HELLO')).toThrow();
  });
});
