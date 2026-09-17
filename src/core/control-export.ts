import { createHash } from 'node:crypto';
import { requireThat } from './errors';
import type { Database } from './store';

const schemaPins:Record<number,string>={
 9:'15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c',
 10:'682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4',
 11:'8bd40b2cb56bf706a72006fe4a54cf310d1620ec3c0d408af4429d5cf2c5947a',
 12:'a333b2b0ca9d5e7572e84d8aa3f8210b99e3b946a831bbd6dd4ff231173d0bf6',
 13:'0eaf3801cdd090fbeeb7d2d362f19c1e7157ae01bb7a09264409bbf504a17d2f',
};
const maxBytes=4*1024*1024,maxRows=10000;
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
type Cell={type:'null'|'text'|'integer';value:string|null};

/** One synchronous application-data snapshot through supported SQL reads.
 * This is not a native backup, stop attestation, or restore admission decision.
 */
export function exportControl(db:Database,createdAt:string):string {
 requireThat(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)&&Number.isFinite(Date.parse(createdAt))&&new Date(createdAt).toISOString()===createdAt,'INVALID_INPUT','Invalid snapshot time.',422);
 return db.transaction(()=>{
  // These two observed host tables are not application data. Do not read their
  // rows or silently ignore any other unknown table/index/trigger.
  const schema=db.all<{type:string;name:string;tbl_name:string;sql:string}>("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND NOT (type='table' AND name IN ('_cf_METADATA','__miniflare_do_name')) ORDER BY type,name");
  const schemaVersions=db.all<{version:number}>('SELECT version FROM schema_versions ORDER BY version').map(row=>row.version);
  const schemaSha256=schemaPins[schemaVersions.at(-1)!];
  requireThat(!!schemaSha256&&createHash('sha256').update(JSON.stringify(schema)).digest('hex')===schemaSha256&&schemaVersions.every((version,i)=>Number.isInteger(version)&&version>=1&&(!i||version>schemaVersions[i-1])),'UNSUPPORTED_SCHEMA','Application export requires the pinned schema.',409);
  const tables:{name:string;columns:string[];rows:Cell[][]}[]=[];
  let rowCount=0,rawBytes=0;
  for(const name of [...schema.filter(row=>row.type==='table').map(row=>row.name),'sqlite_sequence'].sort()){
   const columns=db.all<{name:string}>(`PRAGMA table_info(${quote(name)})`).map(row=>row.name);
   const size=columns.map(column=>`COALESCE(length(CAST(${quote(column)} AS BLOB)),0)`).join('+');
   const unsupported=columns.map(column=>`typeof(${quote(column)}) NOT IN ('null','text','integer')`).join(' OR ');
   // Count and bound raw bytes before materializing values in JS. A final UTF-8
   // bound also includes JSON escaping, cell tags, columns and table metadata.
   const summary=db.all<{n:number;bytes:number;unsupported:number}>(`SELECT count(*) AS n,COALESCE(SUM(${size}),0) AS bytes,COALESCE(MAX(CASE WHEN ${unsupported} THEN 1 ELSE 0 END),0) AS unsupported FROM ${quote(name)}`)[0];
   rowCount+=summary.n;rawBytes+=summary.bytes;
   requireThat(Number.isSafeInteger(rowCount)&&rowCount<=maxRows&&Number.isSafeInteger(rawBytes)&&rawBytes<=maxBytes,'EXPORT_LIMIT','Application export exceeds its bounded snapshot size.',413);
   requireThat(!summary.unsupported,'UNSUPPORTED_DATA','Application export cannot coerce unsupported SQLite values.',409);
   const selection=columns.flatMap((column,i)=>[`typeof(${quote(column)}) AS t${i}`,`CASE WHEN typeof(${quote(column)})='integer' THEN CAST(${quote(column)} AS TEXT) ELSE ${quote(column)} END AS v${i}`]).join(',');
   const rows=db.all<Record<string,string|null>>(`SELECT ${selection} FROM ${quote(name)} ORDER BY rowid`).map(row=>columns.map((_,i)=>({type:row[`t${i}`] as Cell['type'],value:row[`v${i}`]})));
   tables.push({name,columns,rows});
  }
  const result=JSON.stringify({format:'hehebot-control-export',version:1,createdAt,schemaSha256,schemaVersions,tables});
  requireThat(new TextEncoder().encode(result).byteLength<=maxBytes,'EXPORT_LIMIT','Application export exceeds its bounded snapshot size.',413);
  return result;
 });
}
