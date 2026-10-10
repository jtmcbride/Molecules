import type { Model } from "molstar/lib/mol-model/structure";
import { MmcifFormat } from "molstar/lib/mol-model-formats/structure/mmcif";
import type { StructureQuality } from "../domain/types";
import { isHydrogenElement } from "../domain/elements";

/** Cruickshank DPI_free (Å) from refinement statistics; undefined when any input is missing. */
export function dpiFree(x: {
  refinedAtomCount: number;
  reflectionsUsed?: number;
  completenessPercent?: number;
  resolutionAngstrom?: number;
  rFree?: number;
}): number | undefined {
  const {
    refinedAtomCount: n,
    reflectionsUsed: obs,
    completenessPercent: c,
    resolutionAngstrom: d,
    rFree: r,
  } = x;
  if (!n || !obs || !c || !d || !r || obs <= 0 || c <= 0 || c > 100)
    return undefined;
  return Math.sqrt(n / obs) * Math.pow(c / 100, -1 / 3) * d * r;
}

/** Refinement statistics from the first `refine` row and the experimental method. */
export function structureQuality(model: Model): StructureQuality {
  const { type_symbol } = model.atomicHierarchy.atoms,
    occupancy = model.atomicConformation.occupancy;
  let refinedAtomCount = 0;
  for (let i = 0; i < type_symbol.rowCount; i++)
    if (!isHydrogenElement(type_symbol.value(i)) && occupancy.value(i) > 0)
      refinedAtomCount++;
  const quality: StructureQuality = { refinedAtomCount };
  if (!MmcifFormat.is(model.sourceData)) return quality;
  const categories = model.sourceData.data.frame.categories;
  const number = (category: string, field: string) => {
    const f = categories[category]?.getField(field);
    if (!f || !f.rowCount || f.valueKind(0) !== 0) return undefined;
    const value = f.float(0);
    return Number.isFinite(value) ? value : undefined;
  };
  const method = categories.exptl?.getField("method");
  if (method?.rowCount && method.valueKind(0) === 0)
    quality.method = method.str(0);
  quality.resolutionAngstrom = number("refine", "ls_d_res_high");
  quality.rFree = number("refine", "ls_R_factor_R_free");
  quality.reflectionsUsed = number("refine", "ls_number_reflns_obs");
  quality.completenessPercent = number("refine", "ls_percent_reflns_obs");
  const esu = number("refine", "pdbx_overall_ESU_R_Free");
  const dpi = dpiFree(quality);
  if (esu !== undefined && esu > 0) {
    quality.coordinateErrorAngstrom = esu;
    quality.coordinateErrorSource = "deposited_esu_r_free";
  } else if (dpi !== undefined) {
    quality.coordinateErrorAngstrom = dpi;
    quality.coordinateErrorSource = "computed_dpi_free";
  }
  for (const key of Object.keys(quality) as (keyof StructureQuality)[])
    if (quality[key] === undefined) delete quality[key];
  return quality;
}
