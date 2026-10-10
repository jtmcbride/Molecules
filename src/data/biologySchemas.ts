import { z } from "zod";
const boundary = z.object({
  value: z.number().int().positive().optional(),
  modifier: z.string().optional(),
});
const attachedEvidence = z.object({
  evidenceCode: z.string(),
  source: z.string().optional(),
  id: z.string().optional(),
});
const text = z.object({
  value: z.string(),
  evidences: z.array(attachedEvidence).optional(),
});
export const uniprotSchema = z.object({
  primaryAccession: z.string(),
  entryType: z.string(),
  proteinDescription: z
    .object({
      recommendedName: z.object({ fullName: text }).optional(),
      submissionNames: z.array(z.object({ fullName: text })).optional(),
    })
    .optional(),
  organism: z.object({
    scientificName: z.string(),
    taxonId: z.number().optional(),
  }),
  sequence: z.object({
    value: z.string().regex(/^[A-Z]+$/),
    length: z.number().int().positive(),
  }),
  entryAudit: z
    .object({
      sequenceVersion: z.number().optional(),
      entryVersion: z.number().optional(),
      lastAnnotationUpdateDate: z.string().optional(),
    })
    .optional(),
  features: z
    .array(
      z.object({
        type: z.string(),
        featureId: z.string().optional(),
        description: z.string().optional(),
        location: z.object({ start: boundary, end: boundary }),
        ligand: z
          .object({
            name: z.string().optional(),
            id: z.string().optional(),
            label: z.string().optional(),
          })
          .optional(),
        evidences: z.array(attachedEvidence).optional(),
      }),
    )
    .optional(),
  comments: z
    .array(
      z.object({
        commentType: z.string(),
        texts: z.array(text).optional(),
        reaction: z
          .object({
            name: z.string(),
            evidences: z.array(attachedEvidence).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
export const discoverySchema = z.record(
  z.string(),
  z.object({
    UniProt: z
      .record(
        z.string(),
        z.object({
          mappings: z.array(
            z.object({
              entity_id: z.union([z.number(), z.string()]),
              chain_id: z.string(),
              struct_asym_id: z.string(),
              unp_start: z.number().int().positive(),
              unp_end: z.number().int().positive(),
              start: z.object({ residue_number: z.number().int().positive() }),
              end: z.object({ residue_number: z.number().int().positive() }),
            }),
          ),
        }),
      )
      .optional(),
  }),
);
export type AttachedEvidence = z.infer<typeof attachedEvidence>;
export const chemCompSchema = z.object({
  chem_comp: z.object({ id: z.string(), name: z.string() }),
  rcsb_chem_comp_related: z
    .array(
      z.object({
        resource_name: z.string(),
        resource_accession_code: z.string(),
      }),
    )
    .optional(),
});
const score = z.number().nullable().optional();
export const ligandInstanceSchema = z.object({
  rcsb_nonpolymer_entity_instance_container_identifiers: z.object({
    entry_id: z.string(),
    asym_id: z.string(),
    comp_id: z.string(),
  }),
  rcsb_nonpolymer_instance_validation_score: z
    .array(
      z.object({
        RSCC: score,
        RSR: score,
        completeness: score,
        mogul_bonds_RMSZ: score,
        mogul_angles_RMSZ: score,
        ranking_model_fit: score,
        ranking_model_geometry: score,
        type: z.string().optional(),
      }),
    )
    .nullable()
    .optional(),
});
