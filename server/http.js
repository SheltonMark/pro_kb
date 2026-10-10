import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './store.js';

const DEFAULT_PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const BODY_LIMIT = 1024 * 1024;
const COOKIE = 'prokb_session';
const hash = (value) => createHash('sha256').update(value).digest();
const inside = (root, target) => {
  const path = relative(root, target);
  return (
    path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
  );
};
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};

function sessionToken(request) {
  const match = /(?:^|;\s*)prokb_session=([a-f\d]{64})(?:;|$)/.exec(request.headers.cookie || '');
  return match?.[1];
}

function jsonBody(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || ''))
    fail(415, 'JSON_REQUIRED', '请使用 application/json 发送请求。');
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    request.resume();
    fail(413, 'BODY_TOO_LARGE', '请求内容过大。');
  }
  return new Promise((resolveBody, reject) => {
    let size = 0,
      complete = false;
    const chunks = [];
    const rejectOnce = (error) => {
      if (!complete) {
        complete = true;
        chunks.length = 0;
        reject(error);
      }
    };
    request.on('data', (chunk) => {
      if (complete) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        rejectOnce(new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大。'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (complete) return;
      complete = true;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('object required');
        resolveBody(input);
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', '请求必须包含有效的 JSON 对象。'));
      }
    });
    request.on('error', rejectOnce);
    request.on('aborted', () => rejectOnce(new ApiError(400, 'REQUEST_ABORTED', '请求已中断。')));
  });
}

function verifyOrigin(request, secure) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (
    !host ||
    !/^[a-z\d.:[\]-]+$/i.test(host) ||
    !origin ||
    request.headers['sec-fetch-site'] === 'cross-site'
  )
    fail(403, 'ORIGIN_REJECTED', '请求来源不受信任，请从本站页面操作。');
  try {
    const expected = `${secure || request.socket.encrypted ? 'https' : 'http'}://${host}`;
    const actual = new URL(origin);
    if (
      !['http:', 'https:'].includes(actual.protocol) ||
      origin !== actual.origin ||
      actual.origin !== new URL(expected).origin
    )
      throw new Error('foreign origin');
  } catch {
    fail(403, 'ORIGIN_REJECTED', '请求来源不受信任，请从本站页面操作。');
  }
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  if (status === 204) {
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

async function staticFile(pathname, request, response, publicDir) {
  if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '此资源不支持该操作。');
  const path = pathname === '/' ? '/index.html' : pathname;
  if (path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part.startsWith('.')))
    fail(404, 'NOT_FOUND', '页面不存在。');
  const allowed =
    ['/index.html', '/styles.css', '/favicon.svg', '/vendor/d3.min.js'].includes(path) ||
    /^\/js\/[a-z\d_/-]+\.js$/i.test(path) ||
    /^\/assets\/[a-z\d_./-]+\.(?:svg|png|jpe?g|webp|ico|woff2?)$/i.test(path);
  if (!allowed) fail(404, 'NOT_FOUND', '页面不存在。');
  const root = await realpath(publicDir);
  const target = resolve(root, `.${path}`);
  if (!inside(root, target)) fail(404, 'NOT_FOUND', '页面不存在。');
  let canonical;
  try {
    canonical = await realpath(target);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') fail(404, 'NOT_FOUND', '页面不存在。');
    throw error;
  }
  if (!inside(root, canonical) || !(await stat(canonical)).isFile()) fail(404, 'NOT_FOUND', '页面不存在。');
  const bytes = await readFile(canonical);
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  response.setHeader('Content-Type', mime[extname(canonical).toLowerCase()] || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Content-Length', bytes.length);
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createApp({
  store,
  password = '',
  cookieSecure = false,
  publicDir = DEFAULT_PUBLIC,
  now = Date.now,
  sessionTtlMs = 12 * 60 * 60 * 1000,
  loginAttemptLimit = 10,
} = {}) {
  if (!store) throw new Error('A SQLite store is required');
  if (typeof password !== 'string') throw new Error('SITE_PASSWORD must be a string.');
  const requiresAuth = password.length > 0;
  const passwordDigest = hash(password);
  const sessions = new Map(),
    attempts = new Map();
  const attemptWindow = 15 * 60 * 1000;
  function prune() {
    const time = now();
    for (const [key, value] of sessions) if (value <= time) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
  }
  function authenticated(request) {
    if (!requiresAuth) return true;
    const token = sessionToken(request);
    return token ? (sessions.get(hash(token).toString('hex')) || 0) > now() : false;
  }
  function setSession(response, value, maxAge) {
    response.setHeader(
      'Set-Cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`,
    );
  }
  const server = createServer(async (request, response) => {
    securityHeaders(response);
    try {
      prune();
      let pathname;
      try {
        pathname = decodeURIComponent((request.url || '/').split('?')[0]);
      } catch {
        fail(400, 'INVALID_PATH', '无效的请求路径。');
      }
      if (
        !pathname.startsWith('/') ||
        pathname.includes('\0') ||
        pathname.includes('\\') ||
        pathname.split('/').includes('..')
      )
        fail(400, 'INVALID_PATH', '无效的请求路径。');
      if (!pathname.startsWith('/api/')) {
        await staticFile(pathname, request, response, publicDir);
        return;
      }
      const method = request.method;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) verifyOrigin(request, cookieSecure);
      if (pathname === '/api/session' && method === 'GET') {
        json(response, 200, { authenticated: authenticated(request), requiresAuth });
        return;
      }
      if (pathname === '/api/login' && method === 'POST') {
        const key = request.socket.remoteAddress || 'unknown';
        const attempt = attempts.get(key) || { count: 0, until: now() + attemptWindow };
        if (attempt.count >= loginAttemptLimit || (!attempts.has(key) && attempts.size >= 4096)) {
          response.setHeader('Retry-After', Math.max(1, Math.ceil((attempt.until - now()) / 1000)));
          fail(429, 'TOO_MANY_ATTEMPTS', '登录尝试过于频繁，请稍后再试。');
        }
        attempt.count += 1;
        attempts.set(key, attempt);
        const body = await jsonBody(request);
        if (typeof body.password !== 'string' || body.password.length > 1024)
          fail(400, 'INVALID_INPUT', '请输入有效的密码。');
        if (requiresAuth && !timingSafeEqual(passwordDigest, hash(body.password)))
          fail(401, 'INVALID_PASSWORD', '密码不正确，请重试。');
        attempts.delete(key);
        const previousToken = sessionToken(request);
        if (previousToken) sessions.delete(hash(previousToken).toString('hex'));
        if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
        const token = randomBytes(32).toString('hex');
        sessions.set(hash(token).toString('hex'), now() + sessionTtlMs);
        setSession(response, token, Math.floor(sessionTtlMs / 1000));
        json(response, 200, { authenticated: true });
        return;
      }
      if (pathname === '/api/logout' && method === 'POST') {
        const token = sessionToken(request);
        if (token) sessions.delete(hash(token).toString('hex'));
        setSession(response, '', 0);
        json(response, 204);
        return;
      }
      if (!authenticated(request)) fail(401, 'AUTH_REQUIRED', '请先登录后再访问知识库。');
      if (pathname === '/api/export' && method === 'GET') {
        json(response, 200, store.exportData());
        return;
      }
      if (pathname === '/api/projects') {
        if (method === 'GET') {
          json(response, 200, { projects: store.listProjects() });
          return;
        }
        if (method === 'POST') {
          json(response, 201, { project: store.createProject(await jsonBody(request)) });
          return;
        }
      }
      const match = /^\/api\/projects\/([a-f\d-]{36})(?:\/notes(?:\/([a-f\d-]{36}))?)?$/i.exec(pathname);
      if (match) {
        const [, projectId, noteId] = match;
        const notesRoute = pathname.includes('/notes');
        if (noteId) {
          if (method === 'PATCH') {
            json(response, 200, { note: store.updateNote(projectId, noteId, await jsonBody(request)) });
            return;
          }
          if (method === 'DELETE') {
            store.deleteNote(projectId, noteId);
            json(response, 204);
            return;
          }
        } else if (notesRoute) {
          if (method === 'GET') {
            json(response, 200, { notes: store.listNotes(projectId) });
            return;
          }
          if (method === 'POST') {
            json(response, 201, { note: store.createNote(projectId, await jsonBody(request)) });
            return;
          }
        } else {
          if (method === 'PATCH') {
            json(response, 200, { project: store.updateProject(projectId, await jsonBody(request)) });
            return;
          }
          if (method === 'DELETE') {
            store.deleteProject(projectId);
            json(response, 204);
            return;
          }
        }
        fail(405, 'METHOD_NOT_ALLOWED', '此接口不支持该操作。');
      }
      fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (response.writableEnded || response.destroyed) return;
      const expected = error instanceof ApiError;
      if (!expected) console.error('Request failed:', error.message);
      json(response, expected ? error.status : 500, {
        error: expected ? error.message : '服务器暂时无法完成操作，请稍后重试。',
        code: expected ? error.code : 'INTERNAL_ERROR',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.on('close', () => {
    sessions.clear();
    attempts.clear();
  });
  return server;
}
