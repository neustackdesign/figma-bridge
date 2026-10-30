import { build } from 'esbuild';
import { cp, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const dist=path.join(root,'dist');
await rm(dist,{recursive:true,force:true});
await mkdir(path.join(dist,'vendor'),{recursive:true});
for(const item of ['index.html','analytics.js','icon.svg','robots.txt','sitemap.xml','plugin','extension','exporter']){
  await cp(path.join(root,item),path.join(dist,item),{recursive:true});
}
const entries={
  figit:'export * from "@figit/dom-to-figma";',
  html2canvas:'import html2canvas from "html2canvas"; export default html2canvas;',
  jspdf:'export { jsPDF } from "jspdf";'
};
for(const [name,contents] of Object.entries(entries)){
  await build({
    stdin:{contents,resolveDir:root,sourcefile:name+'.entry.js',loader:'js'},
    outfile:path.join(dist,'vendor',name+'.js'),
    format:'esm',platform:'browser',target:['chrome116','safari16'],
    bundle:true,minify:true,legalComments:'none',logLevel:'warning',
    define:{'process.env.NODE_ENV':'"production"'}
  });
}
const pdfRoot=path.join(root,'node_modules/pdfjs-dist');
for(const name of ['pdf.min.js','pdf.worker.min.js']){
  const source=path.join(pdfRoot,'build',name);
  await access(source);
  await cp(source,path.join(dist,'vendor',name));
}
for(const folder of ['cmaps','standard_fonts']){
  await cp(path.join(pdfRoot,folder),path.join(dist,'vendor',folder),{recursive:true});
}
console.log('Built Figma Bridge static runtime, vendored converters and PDF assets in dist/.');