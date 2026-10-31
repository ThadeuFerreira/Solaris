// Production server: the SQLite-backed API plus the built frontend in dist/.
//   npm run build && npm start
// Environment: PORT (default 8787), SOLARIS_DB (default data/solaris.db).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { createSolarisApi } from './app';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.SOLARIS_DB ?? 'data/solaris.db';
const DIST = resolve('dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function fileAt(path: string): Promise<string | null> {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const requested = resolve(join(DIST, pathname));
  if (requested !== DIST && !requested.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  // Unknown paths without an extension are client-side routes: serve the app.
  const file = (await fileAt(requested)) ?? (extname(pathname) ? null : await fileAt(join(DIST, 'index.html')));
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    // Hashed build assets never change; the HTML must always be revalidated.
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const api = createSolarisApi(DB_PATH);

createServer((req, res) => {
  api(req, res, () => {
    serveStatic(req, res).catch((err: unknown) => {
      console.error('[solaris static]', err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
}).listen(PORT, () => {
  console.log(`Solaris em http://localhost:${PORT} (banco: ${DB_PATH})`);
});
