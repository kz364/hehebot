import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true, esm: true } });
addFormats(ajv);
for(const [input,output] of [['contracts.json','validate-command.js'],['runtime.json','validate-runtime.js']]) {
const schema = JSON.parse(await readFile(new URL('../SCHEMAS/'+input, import.meta.url), 'utf8'));
const validate = ajv.compile(schema);
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
let code=standaloneCode(ajv, validate);
const deps=[['ajv/dist/runtime/ucs2length','ucs2'],['ajv/dist/runtime/equal','equal'],['ajv-formats/dist/formats','formats']];
let imports='';
for(const [dep,name] of deps){if(code.includes('require('+JSON.stringify(dep)+')')){imports+=`import ${name}Module from '${dep}.js';\n`;code=code.replaceAll('require('+JSON.stringify(dep)+')',name+'Module');}}
code=code.replaceAll('ucs2Module.default','(ucs2Module.default ?? ucs2Module)').replaceAll('equalModule.default','(equalModule.default ?? equalModule)');
await writeFile(new URL('../src/generated/'+output, import.meta.url),imports+code);
console.log('Generated static command validator; Workers require no runtime eval.');

}
