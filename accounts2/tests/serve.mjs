/* A static server for the tests, written here rather than installed, so the harness adds
 * one dependency instead of two. Serves the repo root: the booklet fetches words.json and
 * packs/*.json by relative path, so it has to be served from beside them.
 *
 * charset=utf-8 is not decoration. Without it the Arabic glosses and every em dash arrive
 * mangled, and an assertion on a word's text fails for a reason that has nothing to do with
 * the app.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.js'  : 'text/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    /* normalize collapses any ../ before it can climb out of the repo */
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = join(root, rel || 'index.local.html');
    if (!file.startsWith(root)) { res.writeHead(403).end('no'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + root + ' on ' + PORT));
