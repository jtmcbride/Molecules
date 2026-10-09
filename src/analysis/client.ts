import type { AnalysisRequest, AnalysisRun, ChemicalDefinition } from '../domain/analysis';
import type { StructureSource } from '../domain/types';
export class AnalysisClient {
  private worker: Worker | null=null;
  private reject: ((error:Error)=>void) | null=null;
  cancel() { this.worker?.terminate();this.worker=null;this.reject?.(new DOMException('Analysis cancelled.','AbortError'));this.reject=null; }
  run(source:StructureSource,modelIndex:number,assemblyId:string,request:AnalysisRequest,definitions:ChemicalDefinition[],progress:(message:string)=>void) {
    this.cancel();
    return new Promise<AnalysisRun>((resolve,reject)=>{
      const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
      this.worker=worker;this.reject=reject;
      const finish=()=>{worker.terminate();if(this.worker===worker){this.worker=null;this.reject=null;}};
      worker.onmessage=event=>{
        if(event.data.type==='progress') progress(event.data.message);
        else if(event.data.type==='result'){finish();resolve(event.data.run);}
        else {finish();reject(new Error(event.data.message));}
      };
      worker.onerror=event=>{finish();reject(new Error(event.message||'The analysis worker could not start.'));};
      // Transfer owned copies. The renderer and IndexedDB keep their original buffers.
      const copy={...source,bytes:new Uint8Array(source.bytes)};
      const copiedDefinitions=definitions.map(d=>({...d,bytes:new Uint8Array(d.bytes)}));
      worker.postMessage({source:copy,modelIndex,assemblyId,request,definitions:copiedDefinitions},[copy.bytes.buffer,...copiedDefinitions.map(d=>d.bytes.buffer)]);
    });
  }
}
