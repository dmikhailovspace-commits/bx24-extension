import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = normalize(fileURLToPath(new URL('../../', import.meta.url)));
const extensionRoot = normalize(process.env.PENA_EXTENSION_DIR || join(projectRoot, 'extension'));
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript'
};
const chromiumUnsafePorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080
]);

const isInside = (root, candidate) => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
};

export const startHarnessServer = async () => {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const servesExtension = pathname.startsWith('/extension/');
    const allowedRoot = servesExtension ? extensionRoot : projectRoot;
    const requestPath = servesExtension ? pathname.slice('/extension/'.length) : pathname.replace(/^\/+/, '');
    const filePath = normalize(join(allowedRoot, requestPath));
    if (!isInside(allowedRoot, filePath)) {
      response.writeHead(403).end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on('error', () => response.writeHead(404).end());
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': `${mime[extname(filePath)] || 'application/octet-stream'}; charset=utf-8`
    });
    stream.pipe(response);
  });
  let address = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });
    address = server.address();
    if (address && !chromiumUnsafePorts.has(address.port)) break;
    await new Promise(resolve => server.close(resolve));
    address = null;
  }
  if (!address) throw new Error('Unable to allocate a Chromium-safe harness port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
};

export const collectPageErrors = page => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  return errors;
};
