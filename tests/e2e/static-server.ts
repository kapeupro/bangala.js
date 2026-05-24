import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), '_site');
const PORT = 4173;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  let filePath = join(ROOT, urlPath);
  try {
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    // try directory index
    try {
      filePath = join(ROOT, urlPath, 'index.html');
      const body = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
    }
  }
}).listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`static-server: http://127.0.0.1:${PORT}/`);
});
