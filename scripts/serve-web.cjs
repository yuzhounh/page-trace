const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(project, 'VERSION'), 'utf8').trim();
const root = path.join(project, 'dist', `web-${version}`);
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff'};
http.createServer((request,response)=>{
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405);response.end();return; }
  let name;
  try { name=decodeURIComponent(new URL(request.url,'http://localhost:3000').pathname); }
  catch { response.writeHead(400);response.end();return; }
  if (name==='/') name='/index.html';
  if (name==='/auth') name='/auth.html';
  const target=path.resolve(root,'.'+name);
  if (!target.startsWith(root+path.sep)) { response.writeHead(403);response.end();return; }
  fs.stat(target,(error,stat)=>{
    if(error||!stat.isFile()){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':types[path.extname(target)]||'text/plain; charset=utf-8','Cache-Control':'no-store'});
    if(request.method==='HEAD')response.end();else fs.createReadStream(target).pipe(response);
  });
}).listen(3000,'127.0.0.1',()=>console.log(`PageTrace ${version} public assets: http://localhost:3000/`));
