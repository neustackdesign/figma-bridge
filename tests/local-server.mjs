import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.woff':'font/woff','.woff2':'font/woff2','.bcmap':'application/octet-stream'};
http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url||'/', 'http://localhost');
    const pathname=decodeURIComponent(u.pathname);
    let full=path.resolve(root,'.'+pathname);
    if(!(full===root||full.startsWith(root+path.sep)))throw Error('outside root');
    const info=await stat(full);
    if(info.isDirectory())full=path.join(full,'index.html');
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Content-Type',types[path.extname(full)]||'application/octet-stream');
    createReadStream(full).on('error',()=>{if(!res.headersSent){res.writeHead(404);res.end('Not found')}}).pipe(res);
  }catch{res.writeHead(404);res.end('Not found')}
}).listen(3200,'127.0.0.1',()=>console.log('Bridge test server ready on 3200'));
