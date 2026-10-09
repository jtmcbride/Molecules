import { prepareStructure } from './prepare';
import { analyze } from './engine';
import type { AnalysisRequest, ChemicalDefinition } from '../domain/analysis';
import type { StructureSource } from '../domain/types';

self.onmessage = async (event: MessageEvent<{source:StructureSource;modelIndex:number;assemblyId:string;request:AnalysisRequest;definitions:ChemicalDefinition[]}>) => {
  try {
    self.postMessage({type:'progress',message:'Parsing coordinates in analysis worker'});
    const {source,modelIndex,assemblyId,request,definitions}=event.data;
    const prepared=await prepareStructure(source,modelIndex,assemblyId,definitions);
    const run=await analyze(prepared.structure,prepared.snapshot,prepared.selectionIndex,request,definitions,message=>self.postMessage({type:'progress',message}));
    self.postMessage({type:'result',run});
  } catch(error) { self.postMessage({type:'error',message:error instanceof Error?error.message:'Analysis failed.'}); }
};
