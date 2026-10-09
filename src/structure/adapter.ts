import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { PluginSpec } from 'molstar/lib/mol-plugin/spec';
import { PluginBehaviors } from 'molstar/lib/mol-plugin/behavior';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { Structure, StructureElement, type Model } from 'molstar/lib/mol-model/structure';
import { ModelSymmetry } from 'molstar/lib/mol-model-formats/structure/property/symmetry';
import { MmcifFormat } from 'molstar/lib/mol-model-formats/structure/mmcif';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import { Color } from 'molstar/lib/mol-util/color';
import { ChainIdColorTheme, ChainIdColorThemeParams } from 'molstar/lib/mol-theme/color/chain-id';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition';
import type { Subscription } from 'rxjs';
import type { StateObjectSelector } from 'molstar/lib/mol-state';
import type { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects';
import type { Representation, StructureOptions, StructureSource } from '../domain/types';
import { extractSnapshot, type SelectionIndex } from './extract';

/** All Mol* objects and its identity translation stay inside this adapter. */
export class MolecularViewer {
  readonly plugin: PluginContext;
  private structure: Structure | null = null;
  private selections: SelectionIndex | null = null;
  private root: StateObjectSelector<SO.Molecule.Structure> | null = null;
  private polymer: StateObjectSelector<SO.Molecule.Structure> | null = null;
  private polymerRepresentation: string | null = null;
  private water: StateObjectSelector<SO.Molecule.Structure> | null = null;
  private waterRepresentation: string | null = null;
  private colorParams: PD.Values<typeof ChainIdColorThemeParams> = {
    ...PD.getDefaultValues(ChainIdColorThemeParams), asymId: 'label',
    palette: { name: 'colors', params: { list: { kind: 'set', colors: [Color(0x72b4d5), Color(0xddab79), Color(0x9b8ed5), Color(0x88ba9c), Color(0xd78b9c), Color(0xb6bd79)] } } },
  };
  private subscriptions: Subscription[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private alive = true;
  constructor() {
    this.plugin = new PluginContext({
      behaviors: [
        PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
        PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
        PluginSpec.Behavior(PluginBehaviors.Camera.CameraControls),
        PluginSpec.Behavior(PluginBehaviors.Camera.CameraAxisHelper),
        PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
        PluginSpec.Behavior(PluginBehaviors.CustomProps.SecondaryStructure),
      ],
      canvas3d: { renderer: { backgroundColor: Color(0x101827), selectColor: Color(0xffbe67), highlightColor: Color(0xf4d6a4) }, camera: { mode: 'perspective' } },
      layout: { initial: { isExpanded: false, showControls: false } },
    });
  }
  async mount(canvas: HTMLCanvasElement, container: HTMLDivElement, onSelect: (id: string | null) => void, onHover: (id: string | null) => void) {
    await this.plugin.init();
    if (!this.alive) return;
    const initialized = await this.plugin.initViewerAsync(canvas, container);
    if (!initialized) throw new Error('WebGL could not be initialized. Enable hardware acceleration or try another browser.');
    if (!this.alive) return;
    this.plugin.managers.interactivity.setProps({ granularity: 'residue' });
    this.subscriptions.push(this.plugin.behaviors.interaction.click.subscribe(event => {
      if (event.button !== 1) return;
      onSelect(this.residueForLoci(event.current.loci));
    }));
    this.subscriptions.push(this.plugin.behaviors.interaction.hover.subscribe(event => onHover(this.residueForLoci(event.current.loci))));
    this.resizeObserver = new ResizeObserver(() => this.plugin.handleResize());
    this.resizeObserver.observe(container);
    this.plugin.handleResize();
  }
  private residueForLoci(loci: unknown): string | null {
    if (!StructureElement.Loci.is(loci)) return null;
    const loc = StructureElement.Loci.getFirstLocation(loci);
    return loc ? this.selections?.residueByLocation.get(`${loc.unit.id}:${loc.element}`) ?? null : null;
  }
  async load(source: StructureSource, modelIndex: number, assemblyId: string, representation: Representation, showWater: boolean) {
    this.structure = null; this.selections = null; this.root = null; this.polymer = null; this.water = null; this.polymerRepresentation = null; this.waterRepresentation = null;
    await this.plugin.clear();
    const data = await this.plugin.builders.data.rawData({ data: source.binary ? new Uint8Array(source.bytes) : new TextDecoder().decode(source.bytes), label: source.name });
    const trajectory = await this.plugin.builders.structure.parseTrajectory(data, 'mmcif');
    if (!trajectory.obj || !trajectory.obj.data.frameCount) throw new Error('The file does not contain any structural models.');
    const frames = trajectory.obj.data;
    if (modelIndex < 0 || modelIndex >= frames.frameCount) throw new Error('The requested structural model is unavailable.');
    const models: StructureOptions['models'] = [];
    for (let index = 0; index < frames.frameCount; index++) {
      const frame = await this.plugin.resolveTask(frames.getFrameAtIndex(index));
      if (!frame) throw new Error('A structural model could not be resolved.');
      models.push({ index, number: frame.modelNum });
    }
    const model = await this.plugin.builders.structure.createModel(trajectory, { modelIndex });
    if (!model.obj) throw new Error('The structural model could not be parsed.');
    const options = this.getOptions(model.obj.data, models);
    if (assemblyId && !options.assemblies.some(a => a.id === assemblyId)) throw new Error('The requested biological assembly is unavailable.');
    const root = await this.plugin.builders.structure.createStructure(model, assemblyId ? { name: 'assembly', params: { id: assemblyId } } : { name: 'model', params: {} });
    if (!root.obj) throw new Error('The selected assembly contains no structure.');
    const extracted = extractSnapshot(root.obj.data, source, modelIndex, assemblyId);
    this.root = root; this.structure = root.obj.data; this.selections = extracted.selectionIndex;
    this.polymer = await this.plugin.builders.structure.tryCreateComponentStatic(root, 'polymer') ?? null;
    if (this.polymer) {
      const repr = await this.plugin.builders.structure.representation.addRepresentation(this.polymer, { type: representation, color: 'chain-id', colorParams: this.colorParams, typeParams: { quality: 'auto' } });
      this.polymerRepresentation = repr.ref;
    }
    for (const componentType of ['ligand', 'ion', 'branched'] as const) {
      const component = await this.plugin.builders.structure.tryCreateComponentStatic(root, componentType);
      if (component) await this.plugin.builders.structure.representation.addRepresentation(component, { type: 'ball-and-stick', color: 'element-symbol' });
    }
    this.water = await this.plugin.builders.structure.tryCreateComponentStatic(root, 'water') ?? null;
    if (showWater) await this.setWater(true);
    this.plugin.managers.camera.reset(undefined, 0);
    const mmcif = MmcifFormat.is(model.obj.data.sourceData) ? model.obj.data.sourceData.data : undefined;
    const db = mmcif?.db;
    const resolutionField = mmcif?.frame.categories.refine?.getField('ls_d_res_high');
    const resolution = resolutionField?.rowCount && resolutionField.valueKind(0) === 0 ? resolutionField.float(0) : undefined;
    const metadata = { title: db?.struct.title.value(0) || model.obj.data.label, method: db?.exptl.method.value(0) || undefined, resolution };
    const theme = ChainIdColorTheme({ structure: this.structure }, this.colorParams);
    const chainColors: Record<string, string> = {};
    for (const chain of extracted.snapshot.chains) {
      const first = extracted.selectionIndex.locationsByResidue.get(chain.residueIds[0])?.[0];
      if (!first) continue;
      const unit = this.structure.unitMap.get(first.unitId);
      const loc = StructureElement.Location.create(this.structure, unit, first.element as StructureElement.Location['element']);
      chainColors[chain.id] = Color.toHexStyle(theme.color(loc, false));
    }
    return { snapshot: extracted.snapshot, options, metadata, chainColors };
  }
  private getOptions(model: Model, models: StructureOptions['models']): StructureOptions {
    return { models, assemblies: (ModelSymmetry.Provider.get(model)?.assemblies ?? []).map(a => ({ id: a.id, description: a.details })) };
  }
  selectResidue(id: string | null, focus = false) {
    this.plugin.managers.interactivity.lociSelects.deselectAll();
    if (!id || !this.structure) return;
    const locations = this.selections?.locationsByResidue.get(id);
    if (!locations) return;
    const grouped = new Map<number, number[]>();
    for (const location of locations) {
      const indices = grouped.get(location.unitId) ?? [];
      indices.push(location.unitIndex); grouped.set(location.unitId, indices);
    }
    const elements = [...grouped].map(([unitId, indices]) => ({ unit: this.structure!.unitMap.get(unitId), indices: OrderedSet.ofSortedArray(indices.sort((a, b) => a - b) as StructureElement.UnitIndex[]) }));
    const loci = StructureElement.Loci(this.structure, elements);
    this.plugin.managers.interactivity.lociSelects.selectOnly({ loci });
    if (focus) this.plugin.managers.camera.focusLoci(loci, { minRadius: 8, extraRadius: 5, durationMs: 250 });
  }
  async setRepresentation(representation: Representation) {
    if (!this.polymer) return;
    if (this.polymerRepresentation) await PluginCommands.State.RemoveObject(this.plugin, { state: this.plugin.state.data, ref: this.polymerRepresentation });
    const repr = await this.plugin.builders.structure.representation.addRepresentation(this.polymer, { type: representation, color: 'chain-id', colorParams: this.colorParams, typeParams: { quality: 'auto' } });
    this.polymerRepresentation = repr.ref;
  }
  async setWater(show: boolean) {
    if (!this.water) return;
    if (show && !this.waterRepresentation) {
      const repr = await this.plugin.builders.structure.representation.addRepresentation(this.water, { type: 'ball-and-stick', color: 'element-symbol', typeParams: { alpha: 0.45 } });
      this.waterRepresentation = repr.ref;
    }
    const hidden = this.plugin.state.data.cells.get(this.water.ref)?.state.isHidden;
    if (hidden === show) await PluginCommands.State.ToggleVisibility(this.plugin, { state: this.plugin.state.data, ref: this.water.ref });
  }
  resetCamera() { this.plugin.managers.camera.reset(undefined, 250); }
  dispose() {
    this.alive = false;
    this.resizeObserver?.disconnect();
    this.subscriptions.forEach(s => s.unsubscribe());
    this.plugin.dispose();
  }
}
