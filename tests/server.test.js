import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createStore } from '../server/store.js';
import { createApp } from '../server/http.js';

function fresh(t, options = {}) {
  const store = createStore({ seed: false, ...options });
  t.after(() => store.close());
  return store;
}

function project(store, name = '设计系统') {
  return store.createProject({ name, description: '项目知识', color: '#7C79E8' });
}

function note(store, p, title = '设计原则', extra = {}) {
  return store.createNote(p.id, { title, content: '内容', tags: ['设计规范'], pinned: false, ...extra });
}

function status(code) {
  return (error) => error.status === code && typeof error.code === 'string';
}

test('project CRUD preserves fields and deleting one project leaves the other intact', (t) => {
  const store = fresh(t);
  const a = project(store),
    b = project(store, '第二个项目');
  note(store, a);
  const other = note(store, b);
  const changed = store.updateProject(a.id, { name: '更新后的项目', color: '#123456' });
  assert.equal(changed.description, a.description);
  assert.equal(changed.createdAt, a.createdAt);
  assert.equal(changed.color, '#123456');
  assert.equal(store.listProjects().length, 2);
  store.deleteProject(a.id);
  assert.throws(() => store.listNotes(a.id), status(404));
  assert.deepEqual(store.listNotes(b.id), [other]);
  assert.throws(() => store.deleteProject(a.id), status(404));
});

test('notes are isolated by project and duplicate normalized titles are rejected', (t) => {
  const store = fresh(t),
    a = project(store),
    b = project(store, 'B');
  const first = note(store, a, 'API');
  assert.throws(() => note(store, a, ' api '), status(409));
  note(store, b, 'api');
  assert.throws(
    () => store.updateNote(b.id, first.id, { title: '错误项目', version: first.version }),
    status(404),
  );
  assert.throws(() => store.deleteNote(b.id, first.id), status(404));
  assert.equal(store.listNotes(a.id)[0].title, 'API');
});

test('validation bounds data and rejects invalid fields without partial changes', (t) => {
  const store = fresh(t),
    a = project(store),
    first = note(store, a);
  for (const value of [
    null,
    [],
    {},
    { name: '' },
    { name: 'x', color: 'red' },
    { name: 'x'.repeat(121) },
    { name: 'x', description: null },
  ]) {
    assert.throws(() => store.createProject(value), status(400));
  }
  for (const extra of [
    { title: '' },
    { title: 'a'.repeat(181) },
    { content: 42 },
    { content: null },
    { tags: null },
    { pinned: null },
    { tags: 'tag' },
    { tags: [42] },
    { pinned: 'true' },
    { content: 'x'.repeat(500001) },
  ]) {
    assert.throws(() => note(store, a, 'bad', extra), status(400));
  }
  assert.throws(() => store.updateNote(a.id, first.id, { content: 'changed' }), status(400));
  assert.throws(() => store.updateNote(a.id, first.id, { content: 'changed', version: 0 }), status(400));
  assert.deepEqual(store.listNotes(a.id), [first]);
});

test('note edits preserve omitted fields and stale revisions cannot overwrite newer data', (t) => {
  const store = fresh(t),
    a = project(store),
    first = note(store, a, '标题', { tags: ['一', '二'], pinned: true });
  const saved = store.updateNote(a.id, first.id, { content: '新内容', version: first.version });
  assert.equal(saved.version, first.version + 1);
  assert.equal(saved.createdAt, first.createdAt);
  assert.deepEqual(saved.tags, ['一', '二']);
  assert.equal(saved.pinned, true);
  assert.throws(
    () => store.updateNote(a.id, first.id, { content: '过期内容', version: first.version }),
    status(409),
  );
  assert.equal(store.listNotes(a.id)[0].content, '新内容');
  store.deleteNote(a.id, first.id);
  assert.throws(() => store.deleteNote(a.id, first.id), status(404));
});

test('wiki delimiter characters are rejected in new titles and renames without changing any data', (t) => {
  const store = fresh(t),
    p = project(store);
  const target = note(store, p, '可引用标题');
  note(store, p, '引用笔记', { content: '[[可引用标题#小节|显示名称]]' });
  const snapshot = store.exportData();
  for (const delimiter of ['[', ']', '#', '|', '\\']) {
    const title = `不支持${delimiter}的标题`;
    assert.throws(() => note(store, p, title), status(400), `create: ${delimiter}`);
    assert.throws(
      () => store.updateNote(p.id, target.id, { title, version: target.version }),
      status(400),
      `rename: ${delimiter}`,
    );
    assert.deepEqual(store.exportData(), snapshot);
  }
});

test('rename atomically rewrites references in the same project and invalidates every affected revision', (t) => {
  const store = fresh(t),
    a = project(store),
    b = project(store, 'B');
  const first = note(store, a, '旧标题', { content: '自链 [[旧标题]]', pinned: true });
  const ref = note(store, a, '引用', {
    content: '[[旧标题#细节|别名]] 与 `[[旧标题]]`\n\n```md\n[[旧标题]]\n```',
    tags: ['甲', '乙'],
    pinned: true,
  });
  const external = note(store, b, '引用', { content: '[[旧标题]]' });
  const renamed = store.updateNote(a.id, first.id, { title: '新标题', version: first.version });
  const changed = store.listNotes(a.id).find((item) => item.id === ref.id);
  assert.equal(renamed.content, '自链 [[新标题]]');
  assert.equal(renamed.version, first.version + 1);
  assert.equal(changed.content, '[[新标题#细节|别名]] 与 `[[旧标题]]`\n\n```md\n[[旧标题]]\n```');
  assert.equal(changed.version, ref.version + 1);
  assert.ok(changed.updatedAt > ref.updatedAt);
  assert.deepEqual(changed.tags, ['甲', '乙']);
  assert.equal(changed.pinned, true);
  assert.equal(changed.createdAt, ref.createdAt);
  assert.throws(
    () => store.updateNote(a.id, ref.id, { content: '旧引用', version: ref.version }),
    status(409),
  );
  assert.deepEqual(store.listNotes(b.id), [external]);
  const snapshot = store.exportData();
  assert.throws(
    () => store.updateNote(a.id, first.id, { title: '引用', version: renamed.version }),
    status(409),
  );
  assert.deepEqual(store.exportData(), snapshot);
});

test('rename rolls back previously rewritten references if a later reference would exceed its content limit', (t) => {
  const store = fresh(t),
    p = project(store);
  const target = note(store, p, 'A');
  note(store, p, 'Long reference', { content: 'x'.repeat(499995) + '[[A]]' });
  note(store, p, 'Short reference', { content: '[[A]]' });
  const snapshot = store.exportData();
  assert.throws(
    () => store.updateNote(p.id, target.id, { title: 'A much longer title', version: target.version }),
    status(400),
  );
  assert.deepEqual(store.exportData(), snapshot);
});

test('disk database persists across close/reopen and seed never resurrects a cleared workspace', () => {
  const artifacts = resolve('artifacts/server-tests');
  mkdirSync(artifacts, { recursive: true });
  const directory = mkdtempSync(join(artifacts, 'persistence-'));
  const filename = join(directory, 'workspace.sqlite');
  let store = createStore({ filename, seed: true });
  const initial = store.exportData();
  assert.equal(initial.version, 1);
  assert.equal(initial.projects.length, 3);
  const main = initial.projects.find((p) => p.name === 'CS7GV1.0');
  assert.equal(initial.notes.filter((n) => n.projectId === main.id).length, 12);
  const added = note(store, main, '持久保存的笔记', { content: '数据库已落盘' });
  store.close();
  store = createStore({ filename, seed: true });
  assert.deepEqual(
    store.listNotes(main.id).find((n) => n.id === added.id),
    added,
  );
  for (const p of store.listProjects()) store.deleteProject(p.id);
  store.close();
  store = createStore({ filename, seed: true });
  assert.deepEqual(store.exportData(), { version: 1, projects: [], notes: [] });
  store.close();
  assert.ok(readFileSync(filename).subarray(0, 15).equals(Buffer.from('SQLite format 3')));
});

async function running(t, options = {}) {
  const store = fresh(t);
  const server = createApp({ store, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, headers = {}, ...rest } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(method !== 'GET' ? { Origin: base } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      ...rest,
    });
  return { store, server, base, call };
}

test('HTTP exposes the documented CRUD/export contract and revision conflicts', async (t) => {
  const { call } = await running(t);
  assert.deepEqual(await (await call('/api/session')).json(), { authenticated: true, requiresAuth: false });
  let response = await call('/api/projects', {
    method: 'POST',
    body: { name: 'HTTP 项目', description: '', color: '#112233' },
  });
  assert.equal(response.status, 201);
  const { project: p } = await response.json();
  response = await call(`/api/projects/${p.id}/notes`, {
    method: 'POST',
    body: { title: 'HTTP 笔记', content: '# 正文', tags: ['服务端'], pinned: true },
  });
  assert.equal(response.status, 201);
  const { note: n } = await response.json();
  assert.deepEqual(await (await call(`/api/projects/${p.id}/notes`)).json(), { notes: [n] });
  response = await call(`/api/projects/${p.id}/notes/${n.id}`, {
    method: 'PATCH',
    body: { content: '已更新', version: n.version },
  });
  assert.equal(response.status, 200);
  response = await call(`/api/projects/${p.id}/notes/${n.id}`, {
    method: 'PATCH',
    body: { content: '过期', version: n.version },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'VERSION_CONFLICT');
  const exported = await (await call('/api/export')).json();
  assert.equal(exported.version, 1);
  assert.equal(exported.notes[0].content, '已更新');
  assert.equal((await call(`/api/projects/${p.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/projects/${p.id}/notes`)).status, 404);
});

test('password sessions protect API, expire, use HttpOnly Strict cookies and logout revokes them', async (t) => {
  let now = Date.now();
  const { call } = await running(t, { password: 'long-secret-password', now: () => now, sessionTtlMs: 1000 });
  assert.deepEqual(await (await call('/api/session')).json(), { authenticated: false, requiresAuth: true });
  assert.equal((await call('/api/projects')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { password: 'bad' } })).status, 401);
  let response = await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(';')[0];
  assert.equal((await call('/api/projects', { headers: { Cookie: cookie } })).status, 200);
  now += 1001;
  assert.equal((await call('/api/projects', { headers: { Cookie: cookie } })).status, 401);
  response = await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } });
  const freshCookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/logout', { method: 'POST', headers: { Cookie: freshCookie } })).status, 204);
  assert.equal((await call('/api/projects', { headers: { Cookie: freshCookie } })).status, 401);
});

test('HTTP rejects missing/foreign origins, cross-site fetch metadata, invalid JSON and large bodies', async (t) => {
  const { call, base } = await running(t);
  for (const headers of [
    { Origin: '' },
    { Origin: 'null' },
    { Origin: 'https://evil.example' },
    { Origin: `${base}.evil.example` },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    assert.equal((await call('/api/projects', { method: 'POST', body: { name: 'x' }, headers })).status, 403);
  }
  assert.equal((await call('/api/projects', { method: 'POST', body: '{' })).status, 400);
  assert.equal(
    (await call('/api/projects', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } }))
      .status,
    415,
  );
  assert.equal((await call('/api/projects', { method: 'POST', body: 'x'.repeat(1_100_000) })).status, 413);
});

test('repeated login failures are bounded when optional password protection is enabled', async (t) => {
  const { call } = await running(t, { password: 'long-secret-password', loginAttemptLimit: 3 });
  for (let i = 0; i < 3; i += 1)
    assert.equal((await call('/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal(
    (await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } })).status,
    429,
  );
});

test('production without a password permits anonymous project and note CRUD', async (t) => {
  const { call } = await running(t, { production: true });
  assert.deepEqual(await (await call('/api/session')).json(), { authenticated: true, requiresAuth: false });
  let response = await call('/api/projects', { method: 'POST', body: { name: '公开项目' } });
  assert.equal(response.status, 201);
  const { project: p } = await response.json();
  assert.equal((await call('/api/projects')).status, 200);
  response = await call(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: '公开编辑后的项目' } });
  assert.equal((await response.json()).project.name, '公开编辑后的项目');
  response = await call(`/api/projects/${p.id}/notes`, {
    method: 'POST',
    body: { title: '公开笔记', content: '初始正文' },
  });
  assert.equal(response.status, 201);
  const { note: n } = await response.json();
  assert.deepEqual(await (await call(`/api/projects/${p.id}/notes`)).json(), { notes: [n] });
  response = await call(`/api/projects/${p.id}/notes/${n.id}`, {
    method: 'PATCH',
    body: { content: '公开修改', version: n.version },
  });
  assert.equal((await response.json()).note.content, '公开修改');
  assert.equal((await call(`/api/projects/${p.id}/notes/${n.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/projects/${p.id}`, { method: 'DELETE' })).status, 204);
});

test('production still protects the API when a password is explicitly configured', async (t) => {
  const { call } = await running(t, { production: true, password: 'explicit-password' });
  assert.deepEqual(await (await call('/api/session')).json(), { authenticated: false, requiresAuth: true });
  assert.equal((await call('/api/projects')).status, 401);
  const response = await call('/api/login', { method: 'POST', body: { password: 'explicit-password' } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/projects', { headers: { Cookie: cookie } })).status, 200);
});

test('successful logins clear earlier failures and never accumulate toward the attempt limit', async (t) => {
  const { call } = await running(t, { password: 'long-secret-password', loginAttemptLimit: 3 });
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await call('/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
    }
    assert.equal(
      (await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } })).status,
      200,
    );
  }
  for (let i = 0; i < 12; i += 1) {
    assert.equal(
      (await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } })).status,
      200,
    );
  }
});

test('HTTPS deployments use Secure cookies and accept only their HTTPS origin', async (t) => {
  const { call, base } = await running(t, {
    password: 'long-secret-password',
    production: true,
    cookieSecure: true,
  });
  assert.equal(
    (await call('/api/login', { method: 'POST', body: { password: 'long-secret-password' } })).status,
    403,
  );
  const response = await call('/api/login', {
    method: 'POST',
    body: { password: 'long-secret-password' },
    headers: { Origin: base.replace('http:', 'https:') },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure(?:;|$)/);
});

test('static responses only serve public assets and deny source, data, encoded traversal and dotfiles', async (t) => {
  const { call } = await running(t);
  for (const path of [
    '/server/store.js',
    '/package.json',
    '/data/workspace.sqlite',
    '/.git/config',
    '/%2e%2e%2fserver/store.js',
    '/%2e%2e%5cserver%5cstore.js',
    '/js/%00.js',
  ]) {
    const response = await call(path);
    assert.ok([400, 403, 404].includes(response.status), `${path}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /CREATE TABLE|SQLite format 3/);
  }
  const response = await call('/js/domain.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /img-src 'self' https: http: data:/);
});
