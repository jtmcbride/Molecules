import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { atomDistance, SpatialGrid } from '../src/analysis/spatial';
it('indexes 100,000 atoms and matches independent contact searches',async()=>{
  const count=100_000,positions=new Float32Array(count*3);
  for(let i=0;i<count;i++)positions.set([(i%100)*2.5,(Math.floor(i/100)%100)*2.5,Math.floor(i/10000)*2.5],i*3);
  const start=performance.now();const grid=new SpatialGrid(positions,Array.from({length:count},(_,i)=>i),5);const built=performance.now();
  let returned=0;for(const query of [0,333,12345,50000,99999]){
    const expected:number[]=[];for(let i=0;i<count;i++)if(atomDistance(positions,query,i)<=5)expected.push(i);
    const actual=grid.neighbors(query,5).map(n=>n.index);expect(actual).toEqual(expected);returned+=actual.length;
  }
  const checked=performance.now();
  if(process.env.RECORD_REFERENCE)await writeFile('/tmp/molecules-spatial-benchmark.json',JSON.stringify({atoms:count,coordinateBytes:positions.byteLength,indexMilliseconds:built-start,fiveQueriesWithBruteForceValidationMilliseconds:checked-built,returned},null,2));
});
