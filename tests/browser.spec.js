import { test, expect } from '@playwright/test';
import { createStore } from '../server/store.js';
import { createApp } from '../server/http.js';
import { createServer, request as proxyRequest } from 'node:http';

let store, server, baseURL;
test.beforeEach(async () => {
  store = createStore({ seed: true });
  server = createApp({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  store.close();
});

test('subpath deployment loads assets and saves through a same-origin reverse proxy', async ({ page }) => {
  const proxy = createServer((req, res) => {
    if (!req.url.startsWith('/kb/')) {
      res.writeHead(404).end();
      return;
    }
    const upstream = proxyRequest(
      `${baseURL}${req.url.slice(3)}`,
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${proxy.address().port}/kb/`);
    await expect(page.locator('.graph-node')).toHaveCount(12);
    await project(page, '子路径验证');
    await newNote(page, '代理持久化', '# 已保存\n\n子路径 API 与资源都正常。');
    await page.reload();
    await expect(page.locator('#note-title')).toHaveValue('代理持久化');
    await expect(page.locator('#markdown-preview')).toContainText('子路径 API 与资源都正常');
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
});
async function enter(page) {
  await page.goto(baseURL);
  await expect(page.locator('.sidebar')).toBeVisible();
}
async function selectProject(page, id) {
  await page.locator('#project-picker-button').click();
  await page.locator(`#project-menu [data-id="${id}"]`).click();
}

test('desktop project picker supports pointer, keyboard and dismissal', async ({ page }) => {
  await enter(page);
  const trigger = page.locator('#project-picker-button');
  const menu = page.getByRole('listbox', { name: '项目列表' });
  await expect(trigger).toBeVisible();
  await expect(page.locator('#project-select')).toBeHidden();
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { selected: true })).toContainText('CS7GV1.0');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toContainText('嵌入式开发');
  await expect(trigger).toContainText('嵌入式开发');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('h1').click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole('option', { name: 'Linux 内核' }).click();
  await expect(page.locator('h1')).toContainText('Linux 内核');
});

test('touch project picker keeps the native select and switches projects', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL);
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(page.locator('#project-select')).toBeVisible();
    await expect(page.locator('#project-picker-button')).toBeHidden();
    await page.locator('#project-select').selectOption({ label: 'Linux 内核' });
    await expect(page.locator('h1')).toContainText('Linux 内核');
  } finally {
    await context.close();
  }
});
async function project(page, name) {
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.getByLabel('项目描述', { exact: true }).fill('浏览器验证项目');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('h1')).toContainText(name);
}
async function newNote(page, title, content, tags = '') {
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Markdown 正文', exact: true }).fill(content);
  await page.getByRole('textbox', { name: '笔记标签，用逗号分隔', exact: true }).fill(tags);
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('已保存至服务器');
}
test('public entry, independent projects, search and tag filtering', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await enter(page);
  await expect(page.locator('#project-select option')).toHaveCount(3);
  const options = await page
    .locator('#project-select option')
    .evaluateAll((all) => all.map((n) => ({ value: n.value, name: n.textContent })));
  const firstCount = await page.locator('.graph-node').count();
  expect(firstCount).toBeGreaterThan(0);
  await selectProject(page, options[1].value);
  await expect(page.locator('h1')).toContainText(options[1].name);
  await page.getByRole('searchbox', { name: '搜索当前项目' }).fill('definitely-absent-content');
  await expect(page.getByText('还没有匹配的笔记', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.locator('.tag-nav-item').first().click();
  expect(await page.locator('.note-card').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test('project create edit delete and empty state', async ({ page }) => {
  await enter(page);
  await project(page, '项目验证');
  await expect(page.getByText('连接，从一条笔记开始')).toBeVisible();
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('项目验证已修改');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('h1')).toContainText('项目验证已修改');
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('项目验证已修改');
  await page.getByRole('button', { name: '永久删除项目', exact: true }).click();
  await expect(page.locator('#project-select option')).toHaveCount(3);
});
test('Markdown note CRUD, backlinks, rename, filtering and two-browser persistence', async ({
  page,
  browser,
}) => {
  await enter(page);
  await project(page, '笔记验证');
  await newNote(page, '目标文档', '# 目标\n\n这里是**正文**。', '嵌入式,测试');
  await page.getByRole('button', { name: '返回知识空间' }).click();
  await newNote(
    page,
    '引用文档',
    '# 关联\n\n参见 [[目标文档]]。\n\n- [x] 验证\n\n<img src=x onerror=alert(1)>',
    '测试',
  );
  await expect(page.locator('#markdown-preview img')).toHaveCount(0);
  await page.locator('#markdown-preview [data-wiki="目标文档"]').click();
  await expect(page.locator('#note-title')).toHaveValue('目标文档');
  await expect(page.locator('.backlinks-list')).toContainText('引用文档');
  await page.locator('#note-title').fill('目标文档新版');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('已保存至服务器');
  await page.locator('.backlinks-list button').click();
  await expect(page.locator('#markdown-preview')).toContainText('目标文档新版');
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.locator('#note-title')).toHaveValue('引用文档');
  await expect(second.locator('#markdown-preview')).toContainText('目标文档新版');
  await context.close();
  await page.getByRole('button', { name: '删除笔记', exact: true }).click();
  await page.locator('#dialog').getByRole('button', { name: '删除笔记', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(1);
});
test('unsaved navigation guard, duplicate title errors and concurrent edit conflict preserve drafts', async ({
  page,
  browser,
}) => {
  await enter(page);
  await project(page, '冲突验证');
  await newNote(page, '同一篇笔记', '原始内容');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#note-content').fill('未保存的内容');
  await page.getByRole('button', { name: '返回知识空间' }).click();
  await expect(page.locator('#dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.locator('#note-content')).toHaveValue('未保存的内容');
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('button', { name: '编辑', exact: true }).click();
  await second.locator('#note-content').fill('另一浏览器已保存');
  await second.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(second.locator('#save-status')).toHaveText('已保存至服务器');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.locator('#dialog')).toContainText('服务器上已有更新');
  await page.getByRole('button', { name: '保留当前编辑' }).click();
  await expect(page.locator('#note-content')).toHaveValue('未保存的内容');
  await page.getByRole('button', { name: '返回知识空间' }).click();
  await page.getByRole('button', { name: '丢弃修改并离开' }).click();
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.locator('#note-title').fill('同一篇笔记');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('同名笔记');
  await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.locator('#note-title')).toHaveValue('同一篇笔记');
  await context.close();
});
test('graph zoom drag keyboard navigation and fixed dark appearance', async ({ page }) => {
  await enter(page);
  await page.locator('.graph-node .node-core').first().hover();
  await expect(page.locator('.graph-highlighted')).toHaveCount(1);
  await expect(page.locator('.graph-node.selected-node')).toHaveCount(1);
  await expect.poll(() => page.locator('.graph-node.related').count()).toBeGreaterThan(1);
  await expect.poll(() => page.locator('.graph-node.faded').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.graph-links line.emphasized').count()).toBeGreaterThan(0);
  await expect(page.locator('.graph-links line.emphasized').first()).toHaveCSS(
    'stroke',
    'rgb(148, 202, 255)',
  );
  await expect(page.locator('.graph-links line.emphasized').first()).toHaveCSS('stroke-width', '0.75px');
  await page.locator('h1').hover();
  await expect(
    page.locator('.graph-highlighted, .graph-node.related, .graph-node.faded, .graph-links line.emphasized'),
  ).toHaveCount(0);
  const before = await page.locator('#zoom-value').textContent();
  await page.getByRole('button', { name: '放大图谱' }).click();
  await expect(page.locator('#zoom-value')).not.toHaveText(before);
  const canvas = page.locator('#graph-canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -160);
  const node = page.locator('.graph-node').first();
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + 38, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: '居中图谱' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-act="theme"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.graph-node').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-title')).toBeVisible();
});
test('mobile 390px and 320px support navigation, graph and editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.locator('body')).toHaveClass(/menu-open/);
  await page.getByRole('button', { name: '全部笔记', exact: false }).first().click();
  await expect(page.locator('body')).not.toHaveClass(/menu-open/);
  await page.locator('.note-card').first().click();
  await expect(page.locator('#note-title')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

async function delayedResponse(page, pattern, method) {
  let release, signal;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const arrived = new Promise((resolve) => {
    signal = resolve;
  });
  const handler = async (route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    signal();
    await pending;
    await route.fulfill({ response });
  };
  await page.route(pattern, handler);
  return { arrived, release, dispose: () => page.unroute(pattern, handler) };
}

test('delayed pin and delete responses cannot change another draft or its version', async ({ page }) => {
  const p = store.createProject({ name: 'Mutation regression' });
  const alpha = store.createNote(p.id, { title: 'Alpha', content: '[[Beta]]' });
  const beta = store.createNote(p.id, { title: 'Beta', content: 'Original Beta' });
  await page.goto(`${baseURL}/#project=${p.id}&note=${alpha.id}`);
  const pin = await delayedResponse(page, `**/notes/${alpha.id}`, 'PATCH');
  try {
    await page.locator('[data-act="pin-note"]').click();
    await pin.arrived;
    await expect(page.locator('#note-content')).toBeDisabled();
    await page.locator('[data-wiki="Beta"]').click();
    await expect(page.locator('#note-title')).toHaveValue('Alpha');
    store.updateNote(p.id, beta.id, { version: 1, content: 'External Beta update' });
  } finally {
    pin.release();
  }
  await expect(page.locator('#note-content')).toBeEnabled();
  await pin.dispose();
  await page.locator('[data-wiki="Beta"]').click();
  await page.locator('[data-mode="edit"]').click();
  await page.locator('#note-content').fill('Local Beta draft');
  await page.locator('[data-act="save-note"]').click();
  await expect(page.locator('#dialog')).toContainText('服务器上已有更新');
  await page.getByRole('button', { name: '保留当前编辑' }).click();
  await expect(page.locator('#note-content')).toHaveValue('Local Beta draft');
  expect(store.listNotes(p.id).find((n) => n.id === beta.id).content).toBe('External Beta update');
  expect(store.listNotes(p.id).find((n) => n.id === beta.id).pinned).toBe(false);

  await page.locator('[data-act="back"]').click();
  await page.getByRole('button', { name: '丢弃修改并离开' }).click();
  await page.locator(`[data-id="${alpha.id}"]`).first().click();
  const deletion = await delayedResponse(page, `**/notes/${alpha.id}`, 'DELETE');
  try {
    await page.locator('[data-act="delete-note"]').click();
    await page.locator('#dialog button[type="submit"]').click();
    await deletion.arrived;
    await expect(page.locator('#note-content')).toBeDisabled();
    await page.locator('[data-wiki="Beta"]').click();
    await expect(page.locator('#note-title')).toHaveValue('Alpha');
  } finally {
    deletion.release();
  }
  await expect(page.locator('#note-title')).toHaveCount(0);
  await deletion.dispose();
  await page.locator(`[data-id="${beta.id}"]`).click();
  await page.locator('[data-mode="edit"]').click();
  await page.locator('#note-content').fill('Beta draft after deletion');
  await expect(page.locator('#note-content')).toHaveValue('Beta draft after deletion');
});

test('delayed saves and project navigation freeze editing and preserve drafts on failure', async ({
  page,
}) => {
  const first = store.createProject({ name: 'First regression' });
  const second = store.createProject({ name: 'Second regression' });
  const note = store.createNote(first.id, { title: 'Alpha', content: 'Original' });
  store.createNote(second.id, { title: 'Beta', content: 'Second project' });
  await page.goto(`${baseURL}/#project=${first.id}&note=${note.id}`);
  await page.locator('[data-mode="edit"]').click();
  await page.locator('#note-content').fill('Saved draft');
  const save = await delayedResponse(page, `**/notes/${note.id}`, 'PATCH');
  try {
    await page.locator('[data-act="save-note"]').click();
    await save.arrived;
    await expect(page.locator('[data-format="bold"]')).toBeDisabled();
    await page.locator('[data-format="bold"]').dispatchEvent('click');
    await expect(page.locator('#note-content')).toHaveValue('Saved draft');
  } finally {
    save.release();
  }
  await expect(page.locator('#note-content')).toBeEnabled();
  await save.dispose();
  expect(store.listNotes(first.id)[0].content).toBe('Saved draft');

  const navigation = await delayedResponse(page, `**/projects/${second.id}/notes`, 'GET');
  try {
    await selectProject(page, second.id);
    await navigation.arrived;
    await expect(page.locator('#note-content')).toBeDisabled();
    await expect(page.locator('[data-act="save-note"]')).toBeDisabled();
    await page.locator('[data-format="bold"]').dispatchEvent('click');
    await page.keyboard.press('Control+s');
    await expect(page.locator('#note-content')).toHaveValue('Saved draft');
  } finally {
    navigation.release();
  }
  await expect(page.locator('h1')).toHaveText('Second regression');
  await navigation.dispose();
  expect(store.listNotes(first.id)[0].version).toBe(2);

  await selectProject(page, first.id);
  await expect(page.locator('h1')).toHaveText('First regression');
  await page.locator(`[data-id="${note.id}"]`).first().click();
  await page.locator('[data-mode="edit"]').click();
  await page.locator('#note-content').fill('Keep this failed-navigation draft');
  await page.route(`**/projects/${second.id}/notes`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unavailable' }),
    }),
  );
  await selectProject(page, second.id);
  await page.getByRole('button', { name: '丢弃修改并离开' }).click();
  await expect(page.locator('#toast')).toContainText('Unavailable');
  await expect(page.locator('#note-content')).toBeEnabled();
  await expect(page.locator('#note-content')).toHaveValue('Keep this failed-navigation draft');
});
