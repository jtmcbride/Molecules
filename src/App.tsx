import {BiologyPanel} from './components/BiologyPanel';
import {ResidueBiology} from './components/ResidueBiology';
import {EvidenceDrawer} from './components/EvidenceDrawer';
import { AnalysisPanel } from './components/AnalysisPanel';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Atom, Box, Check, ChevronRight, CircleHelp, Crosshair, Download, Droplets, FileUp, FlaskConical, Layers3, LoaderCircle, Maximize2, MousePointer2, RotateCcw, Save, Search, ShieldCheck, X } from 'lucide-react';
import { useExplorer } from './state/explorer';
import { samples } from './data/provider';
import type { ResidueRecord, StructureSnapshot } from './domain/types';
import type { ExplorerController } from './structure/controller';

const aaNames: Record<string, string> = { ALA: 'Alanine', ARG: 'Arginine', ASN: 'Asparagine', ASP: 'Aspartate', CYS: 'Cysteine', GLN: 'Glutamine', GLU: 'Glutamate', GLY: 'Glycine', HIS: 'Histidine', ILE: 'Isoleucine', LEU: 'Leucine', LYS: 'Lysine', MET: 'Methionine', PHE: 'Phenylalanine', PRO: 'Proline', SER: 'Serine', THR: 'Threonine', TRP: 'Tryptophan', TYR: 'Tyrosine', VAL: 'Valine' };
function formatNumber(value: number | undefined, digits = 2) { return value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : 'Unspecified'; }
function mean(values: number[]) { const finite = values.filter(Number.isFinite); return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : undefined; }
function residueLabel(residue: ResidueRecord) { return `${residue.componentId} ${residue.authSeqId ?? '—'}${residue.insertionCode ?? ''}`; }
function exportManifest(snapshot: StructureSnapshot) {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, id: snapshot.id, sourceId: snapshot.sourceId, modelNumber: snapshot.modelNumber, assemblyId: snapshot.assemblyId || 'asymmetric-unit', provenance: snapshot.provenance, chains: snapshot.chains, residues: snapshot.residues, ligands: snapshot.ligands, atomCount: snapshot.atomBuffer.atomCount }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${snapshot.sourceId.replace(/[^a-z0-9_-]/gi, '_')}-structure.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const state = useExplorer();
  const canvasRef = useRef<HTMLCanvasElement>(null), containerRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const controller = useRef<ExplorerController | null>(null);
  const [pdbId, setPdbId] = useState(''), [hoveredResidueId, setHoveredResidueId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'selection' | 'source'>('selection');
  const [showHelp, setShowHelp] = useState(false), [missingPosition, setMissingPosition] = useState<number | null>(null);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const snapshot = state.snapshot;
  const ready = state.phase === 'ready' && !!snapshot;
  const busy = state.phase === 'fetching' || state.phase === 'parsing';
  const polymerChains = snapshot?.chains.filter(c => c.type === 'polymer') ?? [];
  const activeChain = polymerChains.find(c => c.id === state.activeChainId);
  const selectedResidue = snapshot?.residues.find(r => r.id === state.selectedResidueId);
  const selectedChain = snapshot?.chains.find(c => c.id === selectedResidue?.chainId);
  const hoveredResidue = snapshot?.residues.find(r => r.id === hoveredResidueId);
  const observedCount = activeChain?.sequence.filter(p => p.residueIds.length).length ?? 0;
  const featuredLigand = snapshot?.ligands.find(l => l.kind === 'ligand') ?? snapshot?.ligands[0];

  useEffect(() => {
    let cancelled = false;
    let instance: ExplorerController | null = null;
    async function initialize() {
      try {
        const [{ MolecularViewer }, { ExplorerController }] = await Promise.all([import('./structure/adapter'), import('./structure/controller')]);
        if (cancelled || !canvasRef.current || !containerRef.current) return;
        const viewer = new MolecularViewer();
        instance = new ExplorerController(viewer);
        controller.current = instance;
        await viewer.mount(canvasRef.current, containerRef.current, id => {
          if (useExplorer.getState().phase !== 'ready') return;
          instance?.select(id);
          setMissingPosition(null); setInspectorTab('selection');
        }, setHoveredResidueId);
        if (!cancelled) await instance.initialize();
      } catch (error) {
        if (!cancelled) useExplorer.setState({ phase: 'error', error: error instanceof Error ? error.message : 'The viewer could not be initialized.' });
      }
    }
    void initialize();
    return () => { cancelled = true; controller.current = null; instance?.dispose(); };
  }, []);
  useEffect(() => { setMissingPosition(null); setHoveredResidueId(null); }, [snapshot?.id]);
  useEffect(() => {
    const selected = document.querySelector<HTMLElement>('.sequence-residue[data-selected="true"]');
    const grid = selected?.closest<HTMLElement>('.sequence-grid');
    if (!selected || !grid) return;
    // Scroll the sequence track without moving the user's workspace page.
    const item = selected.getBoundingClientRect(), track = grid.getBoundingClientRect();
    if (item.top < track.top) grid.scrollTop -= track.top - item.top;
    else if (item.bottom > track.bottom) grid.scrollTop += item.bottom - track.bottom;
  }, [state.selectedResidueId, state.selectedInteractionId]);
  useEffect(() => {
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { setShowHelp(false); setViewerExpanded(false); } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function select(id: string, focus = false) { setMissingPosition(null); setInspectorTab('selection'); controller.current?.select(id, focus); }

  return <div className={`app${viewerExpanded ? ' expanded-view' : ''}`}>
    <header className="app-header">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="Molecular Interaction Explorer home"><span className="brand-mark"><Atom size={23} strokeWidth={1.7} /></span><span>Molecular<span className="brand-sub">INTERACTION EXPLORER</span></span></a>
      <div className="header-divider" />
      <span className="workspace-label">Structure workspace</span>
      <div className="header-actions"><span className="phase-badge"><span /> PHASE 03 · INTERPRETATION</span><button className="icon-button" aria-label="About this explorer" onClick={() => setShowHelp(true)}><CircleHelp size={19} /></button><button className="button secondary save-button" disabled={!ready} onClick={() => void controller.current?.save()}><Save size={15} /> Save session</button></div>
    </header>
    <div className="workspace-heading"><div><div className="eyebrow">FROM STRUCTURE TO UNDERSTANDING</div><h1>Explore the molecular detail.</h1><p>Real structures. Connected views. Every residue in context.</p></div><div className="local-badge"><ShieldCheck size={17} /><span>Analysis stays in your browser</span></div></div>

    {state.notice && <div className="notice" role="status"><Check size={16} /><span>{state.notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => useExplorer.setState({ notice: null })}><X size={15} /></button></div>}
    <main className="workspace">
      <aside className="browser-panel panel">
        <div className="panel-heading"><span><Box size={16} /> Structure browser</span></div>
        <div className="browser-content">
          <form onSubmit={event => { event.preventDefault(); void controller.current?.openPdb(pdbId); }}>
            <label className="field-label" htmlFor="pdb-id">LOAD A STRUCTURE</label>
            <div className="search-field"><Search size={16} /><input id="pdb-id" value={pdbId} onChange={event => setPdbId(event.target.value)} placeholder="PDB accession, e.g. 3PTB" autoComplete="off" maxLength={16} /><button type="submit" aria-label="Load PDB structure" disabled={!pdbId.trim() || !controller.current}><ChevronRight size={17} /></button></div>
          </form>
          <input ref={fileRef} className="visually-hidden" type="file" accept=".cif,.mmcif,.bcif" onChange={event => { const file = event.target.files?.[0]; if (file) void controller.current?.openFile(file); event.target.value = ''; }} />
          <button className="upload-button" onClick={() => fileRef.current?.click()} disabled={!controller.current}><FileUp size={15} /> Open coordinate file <span>mmCIF / BCIF</span></button>
          <div className="field-label example-label">BUNDLED EXAMPLES</div>
          <div className="example-list">{samples.map(sample => <button key={sample.id} className={`example-button${state.source?.id === sample.id && ready ? ' current' : ''}`} onClick={() => void controller.current?.openPdb(sample.id)} disabled={!controller.current}><span className="example-id">{sample.id}</span><span><strong>{sample.name}</strong><small>{sample.description}</small></span><ChevronRight size={13} /></button>)}</div>

          {snapshot && <>
            <div className="section-rule" />
            <div className="loaded-entry"><span className="pdb-badge">{state.source?.kind === 'local' ? 'FILE' : state.source?.id}</span><span className="loaded-label"><span className="live-dot" /> Loaded</span></div>
            <h2 className="structure-title">{state.source?.metadata?.title || state.source?.name}</h2>
            <div className="structure-meta"><span>{state.source?.metadata?.method || 'Coordinate file'}</span>{state.source?.metadata?.resolution && <span>{state.source.metadata.resolution.toFixed(2)} Å</span>}</div>
            <div className="context-fields"><label>Model<select aria-label="Structural model" value={state.modelIndex} disabled={!ready} onChange={event => void controller.current?.setContext(Number(event.target.value), state.assemblyId)}>{state.options.models.map(m => <option key={m.index} value={m.index}>Model {m.number}</option>)}</select></label><label>Assembly<select aria-label="Biological assembly" value={state.assemblyId} disabled={!ready} onChange={event => void controller.current?.setContext(state.modelIndex, event.target.value)}><option value="">Asymmetric unit</option>{state.options.assemblies.map(a => <option key={a.id} value={a.id}>Assembly {a.id}</option>)}</select></label></div>
            <div className="section-rule" />
            <div className="group-heading">POLYMER CHAINS <span>{polymerChains.length}</span></div>
            <div className="chain-list">{polymerChains.map((chain) => <button key={chain.id} className={`chain-button${chain.id === state.activeChainId ? ' active' : ''}`} onClick={() => { useExplorer.setState({ activeChainId: chain.id, selectedAnnotationId: null, biologySelectedLabel: null, selectedProteinAccession: null }); setMissingPosition(null); }}><span className="chain-dot" style={{ background: state.chainColors[chain.id] || '#72b4d5' }} /><span><strong>Chain {chain.authAsymId}</strong>{chain.labelAsymId !== chain.authAsymId && <small>label {chain.labelAsymId}</small>}{state.assemblyId && <small>{chain.operatorId}</small>}</span><span className="chain-length">{chain.sequence.length} <small>res.</small></span><ChevronRight size={13} /></button>)}</div>
            {!polymerChains.length && <p className="muted small">No polymer chains in this model.</p>}
            <div className="group-heading ligand-heading">LIGANDS & IONS <span>{snapshot.ligands.length}</span></div>
            <div className="ligand-list">{snapshot.ligands.map(ligand => {
              const residue = snapshot.residues.find(r => r.id === ligand.residueId)!;
              const chain = snapshot.chains.find(c => c.id === residue.chainId)!;
              return <button key={ligand.id} className={`ligand-button${state.selectedResidueId === residue.id ? ' active' : ''}`} aria-label={`Inspect ${ligand.componentId} chain ${chain.authAsymId} ${residue.authSeqId}`} onClick={() => select(residue.id, true)}><FlaskConical size={15} /><strong>{ligand.componentId}</strong><span>{chain.authAsymId} · {residue.authSeqId}{residue.insertionCode}{state.assemblyId && ` · ${chain.operatorId}`}</span><Crosshair size={13} /></button>;
            })}</div>
            {!snapshot.ligands.length && <p className="muted small">No nonpolymer ligands in this model.</p>}
          </>}
        </div>
        <div className="browser-foot"><ShieldCheck size={14} /><span>{state.source?.kind === 'local' ? 'Local file · stays on this device' : 'Public structural data · RCSB PDB'}</span></div>
      </aside>

      <section className="explorer-column">
        <div className="viewer-panel panel">
          <div className="panel-heading viewer-heading"><span><Layers3 size={16} /> Molecular view {snapshot && <small>{state.source?.id.startsWith('local:') ? state.source.name : state.source?.id}</small>}</span><div className="viewer-actions"><button className="icon-button" disabled={!ready} aria-label="Reset camera" title="Reset camera" onClick={() => controller.current?.viewer.resetCamera()}><RotateCcw size={16} /></button><button className="icon-button" aria-label={viewerExpanded ? 'Exit expanded view' : 'Expand molecular view'} title="Expand molecular view" onClick={() => setViewerExpanded(!viewerExpanded)}>{viewerExpanded ? <X size={17} /> : <Maximize2 size={16} />}</button></div></div>
          <div className="viewer-stage" ref={containerRef}>
            <canvas ref={canvasRef} aria-label="Interactive three-dimensional molecular structure" />
            {ready && <div className="viewer-pills"><span><span className="live-dot" /> {state.assemblyId ? `Assembly ${state.assemblyId}` : 'Asymmetric unit'}</span><span>Model {snapshot.modelNumber}</span></div>}
            {(busy || state.phase === 'idle') && <div className="viewer-overlay"><LoaderCircle className="spin" size={30} /><h3>{state.status}</h3><p>{state.phase === 'parsing' ? 'Parsing coordinates and preparing the 3D scene.' : 'Your molecular workspace is getting ready.'}</p>{busy && <button className="button secondary" onClick={() => controller.current?.cancel()}>Cancel loading</button>}</div>}
            {state.phase === 'error' && <div className="viewer-overlay error-overlay"><Box size={32} /><h3>Structure could not be loaded</h3><p role="alert">{state.error}</p><button className="button primary" onClick={() => void controller.current?.openPdb('3PTB')}>Open bundled example</button></div>}
            {hoveredResidue && <div className="hover-label"><MousePointer2 size={13} /> {residueLabel(hoveredResidue)} · chain {snapshot?.chains.find(c => c.id === hoveredResidue.chainId)?.authAsymId}</div>}
            {ready && <div className="viewer-instructions">Drag to rotate <span>·</span> Scroll to zoom <span>·</span> Click to inspect</div>}
          </div>
          <div className="viewer-toolbar"><div className="representation-control" aria-label="Polymer representation">{(['cartoon', 'ball-and-stick', 'molecular-surface'] as const).map((representation, i) => <button key={representation} disabled={!ready} className={state.representation === representation ? 'active' : ''} onClick={() => void controller.current?.setRepresentation(representation)}>{['Cartoon', 'Atoms', 'Surface'][i]}</button>)}</div><label className="water-toggle"><Droplets size={14} /> Water<input type="checkbox" disabled={!ready} checked={state.showWater} onChange={event => void controller.current?.setWater(event.target.checked)} /><span className="switch" /></label></div>
          <div className="viewer-stats"><span><strong>{snapshot?.atomBuffer.atomCount.toLocaleString() ?? '—'}</strong> atoms</span><span><strong>{snapshot?.residues.filter(r => r.kind === 'polymer').length.toLocaleString() ?? '—'}</strong> observed residues</span><span><strong>{snapshot?.ligands.length ?? '—'}</strong> ligands / ions</span><span className="units-label">Coordinates in Å</span></div>
        </div>

        <div className="sequence-panel panel"><div className="panel-heading"><span><span className="sequence-icon">Aa</span> Sequence <small>{activeChain ? `Chain ${activeChain.authAsymId}` : 'No chain selected'}</small></span><span className="sequence-coverage">{activeChain ? `${observedCount} / ${activeChain.sequence.length} observed` : ''}</span></div><div className="sequence-content">
          {activeChain ? <><div className="sequence-legend"><span><i className="legend-observed" /> Observed</span><span><i className="legend-missing" /> No coordinates</span><span><i className="legend-selected" /> Selected</span><span><i className="legend-binding"/> Binding neighborhood</span><span className="sequence-numbering">PDB label numbering</span></div><div className="sequence-grid">{activeChain.sequence.map(position => {
            const residue = snapshot?.residues.find(r => r.id === position.residueIds[0]);
            const selected = position.residueIds.includes(state.selectedResidueId ?? '');
            return <button key={position.labelSeqId} data-selected={selected} aria-pressed={selected} aria-label={`Residue ${position.componentId} label ${position.labelSeqId}${residue ? ` author ${residue.authSeqId}${residue.insertionCode ?? ''}` : ' no coordinates'}`} className={`sequence-residue${residue&&state.interpretation?.projections.some(p=>p.residueIds.includes(residue.id)&&state.annotationCategories.includes(state.interpretation!.annotations.find(a=>a.id===p.annotationId)!.type))?' annotated-residue':''}${residue ? '' : ' missing'}${selected ? ' selected' : ''}${residue && state.analysis?.residues.some(r => r.residueId === residue.id) ? ' binding-residue' : ''}`} title={`${position.componentId} · label ${position.labelSeqId}${residue ? ` · author ${residue.authSeqId}${residue.insertionCode ?? ''}` : ' · no observed coordinates'}`} onClick={() => { if (residue) select(residue.id); else { controller.current?.selectBiologyPosition(position.labelSeqId); setMissingPosition(position.labelSeqId); setInspectorTab('selection'); } }}><span className="seq-number">{position.labelSeqId % 10 === 0 || position.labelSeqId === 1 ? position.labelSeqId : ''}</span><span>{position.code}</span></button>;
          })}</div><p className="sequence-note">Deposited polymer sequence. Unresolved positions have no 3D selection.</p></> : <p className="muted small">Load a structure to explore its polymer sequence.</p>}
        </div></div>
        <AnalysisPanel controller={controller.current}/>
        <BiologyPanel controller={controller.current}/>
      </section>

      <aside className="inspector-panel panel"><div className="panel-heading"><span><MousePointer2 size={16} /> Inspector</span>{selectedResidue && <button className="icon-button" aria-label="Clear selection" onClick={() => controller.current?.select(null)}><X size={15} /></button>}</div><div className="inspector-tabs"><button className={inspectorTab === 'selection' ? 'active' : ''} onClick={() => setInspectorTab('selection')}>Selection</button><button className={inspectorTab === 'source' ? 'active' : ''} onClick={() => setInspectorTab('source')}>Source & provenance</button></div>
        <div className="inspector-content">
          {inspectorTab === 'selection' && (selectedResidue && snapshot ? <>
            <div className="eyebrow">{selectedResidue.kind.toUpperCase()}</div><div className="residue-identity"><h2>{selectedResidue.componentId}</h2><span>{selectedResidue.authSeqId}{selectedResidue.insertionCode}</span></div><p className="residue-name">{aaNames[selectedResidue.componentId] || snapshot.ligands.find(l => l.residueId === selectedResidue.id)?.description || 'Structural component'}</p>
            <div className="identity-tags"><span>Chain {selectedChain?.authAsymId}</span><span>Model {snapshot.modelNumber}</span></div>
            <button className="button focus-button" onClick={() => controller.current?.focusSelection()}><Crosshair size={16} /> Focus in 3D <ArrowUpRight size={14} /></button>
            <div className="section-rule" /><div className="field-label">STRUCTURAL IDENTITY</div><dl className="property-list"><dt>Author position</dt><dd>{selectedResidue.authSeqId ?? 'Unspecified'}{selectedResidue.insertionCode ?? ''}</dd><dt>Label position</dt><dd>{selectedResidue.labelSeqId ?? 'Nonpolymer'}</dd><dt>Label chain</dt><dd>{selectedChain?.labelAsymId}</dd><dt>Assembly operator</dt><dd>{selectedChain?.operatorId}</dd><dt>Insertion code</dt><dd>{selectedResidue.insertionCode ?? 'None'}</dd><dt>Observed atoms</dt><dd>{selectedResidue.atomIndices.length}</dd><dt>Mean occupancy</dt><dd>{formatNumber(mean(selectedResidue.atomIndices.map(i => snapshot.atomBuffer.occupancies[i])))}</dd><dt>Mean B factor</dt><dd>{formatNumber(mean(selectedResidue.atomIndices.map(i => snapshot.atomBuffer.bFactors[i])))} Å²</dd></dl>
            {selectedResidue.preferredAltId && <div className="quality-note">Alternate conformers present. Preferred conformer: {selectedResidue.preferredAltId}. All deposited conformers remain visible.</div>}
            <ResidueBiology/>
            <div className="section-rule" /><div className="group-heading">OBSERVED ATOMS <span>{selectedResidue.atomIndices.length}</span></div><div className="atom-table-wrap"><table className="atom-table"><thead><tr><th>Atom</th><th>Alt</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>{selectedResidue.atomIndices.map(i => <tr key={snapshot.atoms[i].id}><th scope="row">{snapshot.atoms[i].name}</th><td>{snapshot.atoms[i].altId ?? '—'}</td><td>{snapshot.atomBuffer.positions[i * 3].toFixed(2)}</td><td>{snapshot.atomBuffer.positions[i * 3 + 1].toFixed(2)}</td><td>{snapshot.atomBuffer.positions[i * 3 + 2].toFixed(2)}</td></tr>)}</tbody></table></div><p className="small muted">Assembly coordinates in angstroms.</p>
          </> : <div className="empty-inspector"><div className="empty-icon"><MousePointer2 size={24} strokeWidth={1.4} /></div><h3>{missingPosition ? `Position ${missingPosition} is unresolved` : 'Start with a residue.'}</h3><p>{missingPosition ? 'This position is in the deposited sequence, but no atomic coordinates are available in this model.' : 'Select a residue in the molecular view or sequence to inspect its identity and atomic coordinates.'}</p>{featuredLigand && !missingPosition && <button className="button secondary" onClick={() => select(featuredLigand!.residueId, true)}><FlaskConical size={15} /> Inspect {featuredLigand!.componentId}</button>}<div className="inspection-tip"><span>CONNECTED VIEWS</span><p>Your selection follows you between the sequence, molecular view, and inspector.</p></div></div>)}
          {inspectorTab === 'source' && (snapshot ? <><div className="eyebrow">REPRODUCIBLE STRUCTURAL DATA</div><h3 className="source-title">Every coordinate has a source.</h3><dl className="property-list"><dt>Origin</dt><dd>{state.source?.kind === 'local' ? 'Local file' : 'RCSB PDB'}</dd><dt>File</dt><dd>{state.source?.name}</dd><dt>Parser</dt><dd>{snapshot.provenance.parser}</dd><dt>Model</dt><dd>{snapshot.modelNumber}</dd><dt>Assembly</dt><dd>{snapshot.assemblyId || 'Asymmetric unit'}</dd><dt>Coordinate frame</dt><dd>Assembly · Å</dd><dt>Schema version</dt><dd>{snapshot.provenance.schemaVersion}</dd></dl><div className="field-label">SHA-256 CONTENT HASH</div><code className="hash-block">{snapshot.provenance.contentHash}</code><div className="source-note"><ShieldCheck size={18} /><p>Coordinates are preserved independently of the 3D renderer. Sessions are stored on this device.</p></div>{state.source?.kind !== 'local' && <a className="source-link" href={`https://www.rcsb.org/structure/${state.source?.id}`} target="_blank" rel="noreferrer">View entry at RCSB PDB <ArrowUpRight size={14} /></a>}<div className="section-rule" /><div className="field-label">QUALITY & ASSUMPTIONS</div><p className="small muted">Preferred conformer: mean occupancy per residue, with deterministic tie-breaking. Missing atoms are not generated.</p>{snapshot.provenance.qualityFlags.map(flag => <div className="quality-note" key={flag}>{flag}</div>)}{!snapshot.provenance.qualityFlags.length && <p className="small muted">No additional parsing flags for this snapshot.</p>}<button className="button secondary export-button" onClick={() => exportManifest(snapshot)}><Download size={15} /> Export structure manifest</button></> : <p className="muted small">Load a structure to inspect its source.</p>)}
        </div>
        <div className="phase-note"><span className="phase-note-icon"><Atom size={16} /></span><div><strong>Function in context</strong><p>Mapped protein features and molecular geometry, with traceable evidence.</p></div></div>
      </aside>
    </main>
    <footer className="app-footer"><span><span className={`status-dot${ready ? ' ready' : ''}`} /> {state.status}</span><span>Powered by Mol* <span className="footer-dot">·</span> Structural data from RCSB PDB</span><span>Browser workspace <span className="version">v0.3.0</span></span></footer>
    <EvidenceDrawer/>
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={19} /></button><span className="brand-mark"><Atom size={26} /></span><div className="eyebrow">MOLECULAR INTERACTION EXPLORER</div><h2 id="help-title">Your structure, in context.</h2><p>Load an experimental structure by its PDB accession or open an mmCIF / BinaryCIF file from your device. The bundled examples work without an external scientific API.</p><ul><li>Drag to rotate, scroll to zoom, and click a residue to inspect it.</li><li>Choose a chain to explore its deposited sequence. Unresolved positions have no coordinates.</li><li>Choose an assembly and structural model before interpreting geometry.</li><li>Explore protein features in the functional tracks and open their evidence.</li><li>Save a session to reopen its structure, analysis and annotation revision. Local files are never uploaded.</li></ul><p className="quality-note">Select a target ligand in the interaction panel and run an analysis. Proximity measurements and chemical candidates describe geometry; they do not estimate binding affinity. Local coordinates stay on this device. Public chemical definitions may be downloaded by component ID when absent from the file.</p><button className="button primary" onClick={() => setShowHelp(false)}>Explore the structure <ChevronRight size={16} /></button></section></div>}
  </div>;
}
