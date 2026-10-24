import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.epub': 'application/epub+zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const port = Number(process.env.PORT) || 4173;

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    let reqPath = decodeURIComponent(parsedUrl.pathname);
    if (reqPath.endsWith('/')) {
      reqPath += 'index.html';
    }

    const filePath = path.resolve(rootDir, '.' + reqPath);
    if (!filePath.startsWith(rootDir + path.sep) && filePath !== rootDir) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      const data = await readFile(indexFile);
      res.setHeader('Content-Type', MIME_TYPES['.html']);
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const data = await readFile(filePath);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static server listening on http://127.0.0.1:${port}`);
});
