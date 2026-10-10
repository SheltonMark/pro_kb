import { request } from './api.js';
import { filterNotes, normalizeTags, normalizeTitle, buildGraph, PALETTE } from './domain.js';
import { renderMarkdown, escapeHTML as e, headingId } from './markdown.js';
import { icon, logo } from './icons.js';
import { shell, sidebar, overview, notesView, fullGraph, editorView, loginView, button } from './views.js';
import { mountGraph } from './graph.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toastNode = document.querySelector('#toast');
let graph = null,
  toastTimer,
  previewTimer,
  loadingSequence = 0,
  saving = false,
  navigating = false,
  activeDialogFinish = null;
const state = {
  projects: [],
  projectId: '',
  notes: [],
  view: 'overview',
  query: '',
  tag: '',
  sort: 'updated',
  layout: 'cards',
  noteId: null,
  draft: null,
  dirty: false,
  editorMode: 'split',
  authenticated: false,
  requiresAuth: false,
  filtered: [],
};
function toast(message, error = false) {
  clearTimeout(toastTimer);
  toastNode.textContent = message;
  toastNode.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(
    () => {
      toastNode.className = 'toast';
    },
    error ? 6500 : 3000,
  );
}
function report(error) {
  toast(error.message || '操作暂时未完成，请重试。', true);
}
function destroyGraph() {
  graph?.destroy();
  graph = null;
}
function closeMenu() {
  closeProjectPicker();
  document.body.classList.remove('menu-open');
}
function closeProjectPicker(restoreFocus = false) {
  const menu = document.querySelector('#project-menu');
  const trigger = document.querySelector('#project-picker-button');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}
function openProjectPicker() {
  if (saving || navigating) return;
  const menu = document.querySelector('#project-menu');
  if (!menu) return;
  menu.hidden = false;
  document.querySelector('#project-picker-button').setAttribute('aria-expanded', 'true');
  (menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]'))?.focus();
}
function setEditorBusy(busy) {
  document
    .querySelectorAll(
      '#note-title, #note-tags, #note-content, [data-format], [data-act="editor-mode"], [data-act="save-note"], [data-act="pin-note"], [data-act="delete-note"]',
    )
    .forEach((field) => {
      field.disabled = busy;
    });
}
async function runMutation(task, { fromProjectDialog = false } = {}) {
  if (saving || (navigating && !fromProjectDialog)) return;
  saving = true;
  setEditorBusy(true);
  try {
    await task();
  } finally {
    saving = false;
    setEditorBusy(navigating);
  }
}
function setRoute() {
  const route = new URLSearchParams();
  if (state.projectId) route.set('project', state.projectId);
  if (state.noteId) route.set('note', state.noteId);
  else if (state.view !== 'overview') route.set('view', state.view);
  history.replaceState(null, '', `${location.pathname}${route.size ? '#' + route : ''}`);
}
function renderSidebar() {
  const old = app.querySelector('.sidebar');
  if (old) old.outerHTML = sidebar(state);
}
function renderMain() {
  destroyGraph();
  state.filtered = filterNotes(state.notes, {
    projectId: state.projectId,
    query: state.query,
    tag: state.tag,
    pinned: state.view === 'pinned',
  });
  state.filtered.sort(
    state.sort === 'title'
      ? (a, b) => a.title.localeCompare(b.title, 'zh-CN')
      : (a, b) =>
          b[state.sort === 'created' ? 'createdAt' : 'updatedAt'].localeCompare(
            a[state.sort === 'created' ? 'createdAt' : 'updatedAt'],
          ),
  );
  const main = document.querySelector('#main');
  if (!main) return;
  main.innerHTML =
    state.view === 'editor'
      ? editorView(state)
      : state.view === 'overview' && !state.query && !state.tag
        ? overview(state)
        : state.view === 'graph' && !state.query && !state.tag
          ? fullGraph(state)
          : notesView(state);
  const canvas = document.querySelector('#graph-canvas');
  if (canvas && state.notes.length)
    graph = mountGraph(canvas, buildGraph(state.notes, state.projectId), {
      onOpen: (id) => runNavigation(() => openNote(id)),
      onScale: (scale) => {
        const value = document.querySelector('#zoom-value');
        if (value) value.textContent = `${scale}%`;
      },
    });
  renderSidebar();
  setEditorBusy(saving || navigating);
  document.title = `${state.view === 'editor' ? state.draft.title || '新笔记' : state.projects.find((p) => p.id === state.projectId)?.name || '我的空间'} · 知屿`;
  setRoute();
}
function renderShell() {
  destroyGraph();
  app.innerHTML = shell(state);
  renderMain();
}

/** All dialogs share native focus trapping and Escape support. */
function formDialog(title, body, { submit = '', danger = false, cancel = '取消' } = {}) {
  return new Promise((resolve) => {
    // Settle the previous dialog synchronously; native close events are queued.
    activeDialogFinish?.(null);
    dialog.innerHTML = `<form><div class="dialog-head"><h2>${e(title)}</h2><button class="icon-button" type="button" data-close aria-label="关闭对话框">${icon('close')}</button></div><div class="dialog-body">${body}${submit ? `<div class="dialog-footer"><button type="button" class="button secondary" data-close>${e(cancel)}</button><button class="button ${danger ? 'danger' : 'primary'}" type="submit">${e(submit)}</button></div>` : ''}</div></form>`;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (activeDialogFinish === finish) activeDialogFinish = null;
      dialog.onclose = null;
      dialog.oncancel = null;
      dialog.close();
      resolve(result);
    };
    dialog.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      finish(new FormData(event.currentTarget));
    };
    dialog.querySelectorAll('[data-close]').forEach((el) => {
      el.onclick = () => finish(null);
    });
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    activeDialogFinish = finish;
    dialog.onclose = () => {
      if (!dialog.open) finish(null);
    };
    dialog.showModal();
    const field = dialog.querySelector('input:not([type="radio"]),textarea');
    if (field) field.focus();
  });
}
async function confirmLeave() {
  if (!state.dirty) return true;
  const answer = await formDialog(
    '离开前，保留这份思考',
    '<p>这篇笔记还有未保存的修改。继续离开会丢弃这些修改；你也可以返回编辑器，先保存笔记。</p>',
    { submit: '丢弃修改并离开', danger: true, cancel: '继续编辑' },
  );
  return !!answer;
}
async function runNavigation(task) {
  if (navigating || saving) return;
  navigating = true;
  try {
    if (!(await confirmLeave())) return;
    setEditorBusy(true);
    await task();
    closeMenu();
  } catch (error) {
    report(error);
  } finally {
    navigating = false;
    setEditorBusy(saving);
  }
}
function resetEditor() {
  state.noteId = null;
  state.draft = null;
  state.dirty = false;
}
function resetFilters() {
  state.query = '';
  state.tag = '';
  const input = document.querySelector('#search');
  if (input) input.value = '';
}
async function loadProject(id, { noteId = null, view = 'overview' } = {}) {
  const token = ++loadingSequence;
  // Keep the old project and draft intact until the new request succeeds.
  const { notes } = id ? await request(`/projects/${encodeURIComponent(id)}/notes`) : { notes: [] };
  if (token !== loadingSequence) return;
  resetEditor();
  resetFilters();
  state.projectId = id;
  state.notes = notes;
  state.view = ['overview', 'notes', 'graph', 'pinned'].includes(view) ? view : 'overview';
  if (noteId && notes.some((n) => n.id === noteId)) prepareNote(noteId);
  renderShell();
}
function prepareNote(id, title = '') {
  const note = state.notes.find((n) => n.id === id);
  state.noteId = note?.id || null;
  state.draft = note ? structuredClone(note) : { title, content: '', tags: [], pinned: false };
  state.dirty = !note && !!title;
  state.view = 'editor';
  state.editorMode = note ? 'preview' : 'split';
}
function openNote(id, title = '') {
  resetFilters();
  prepareNote(id, title);
  renderMain();
  if (!id) document.querySelector('#note-title')?.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function markDirty() {
  if (!state.draft) return;
  const title = document.querySelector('#note-title');
  const content = document.querySelector('#note-content');
  const tags = document.querySelector('#note-tags');
  if (title) state.draft.title = title.value;
  if (content) state.draft.content = content.value;
  if (tags) state.draft.tags = normalizeTags(tags.value.split(/[,，]/));
  const original = state.notes.find((n) => n.id === state.noteId);
  state.dirty = !original
    ? !!(state.draft.title || state.draft.content || state.draft.tags.length)
    : ['title', 'content'].some((key) => original[key] !== state.draft[key]) ||
      JSON.stringify(original.tags) !== JSON.stringify(state.draft.tags);
  const status = document.querySelector('#save-status');
  if (status) status.textContent = state.dirty ? '有未保存的更改' : '已保存至服务器';
  const count = document.querySelector('#word-count');
  if (count) count.textContent = `${state.draft.content.length} 字符`;
}
async function saveNote() {
  if (saving || navigating || state.view !== 'editor') return;
  markDirty();
  if (!state.draft.title.trim()) {
    toast('为笔记填写一个标题再保存。', true);
    document.querySelector('#note-title').focus();
    return;
  }
  saving = true;
  setEditorBusy(true);
  const projectId = state.projectId,
    noteId = state.noteId;
  const saveButton = document.querySelector('[data-act="save-note"]');
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = '正在保存…';
  }
  try {
    const path = `/projects/${encodeURIComponent(projectId)}/notes${noteId ? '/' + encodeURIComponent(noteId) : ''}`;
    const { title, content, tags, pinned, version } = state.draft;
    const { note } = await request(path, {
      method: noteId ? 'PATCH' : 'POST',
      body: { title, content, tags, pinned, ...(noteId ? { version } : {}) },
    });
    if (state.projectId !== projectId || state.noteId !== noteId) return;
    state.noteId = note.id;
    state.draft = structuredClone(note);
    state.dirty = false;
    // Refresh all notes because a title change may rewrite several linked documents.
    try {
      state.notes = (await request(`/projects/${encodeURIComponent(projectId)}/notes`)).notes;
    } catch {
      state.notes = [...state.notes.filter((n) => n.id !== note.id), note];
      toast('笔记已保存，关联列表刷新失败，可稍后重新打开项目。', true);
    }
    const mode = state.editorMode;
    renderMain();
    state.editorMode = mode;
    toast('笔记已保存至服务器');
  } catch (error) {
    if (error.status === 409 && error.code === 'VERSION_CONFLICT') {
      const answer = await formDialog(
        '服务器上已有更新',
        '<p>这篇笔记已在其他页面修改，或它的引用已随文档重命名更新。你的编辑内容仍保留在当前页面，请先复制需要的内容，再决定是否载入服务器版本。</p>',
        { submit: '载入服务器版本', cancel: '保留当前编辑' },
      );
      if (answer) {
        const { notes } = await request(`/projects/${encodeURIComponent(projectId)}/notes`);
        state.notes = notes;
        if (notes.some((n) => n.id === state.noteId)) {
          prepareNote(state.noteId);
          renderMain();
        } else toast('该笔记已被删除，当前编辑内容仍保留。', true);
      }
    } else report(error);
  } finally {
    saving = false;
    setEditorBusy(navigating);
    const current = document.querySelector('[data-act="save-note"]');
    if (current) {
      current.disabled = false;
      current.innerHTML = `${icon('check')}保存笔记`;
    }
  }
}
async function projectDialog(edit = false) {
  const project = edit ? state.projects.find((p) => p.id === state.projectId) : null;
  const result = await formDialog(
    edit ? '编辑项目' : '新的项目，新的可能',
    `<p>每个项目都是一片独立的知识空间。</p><label for="project-name">项目名称</label><input id="project-name" name="name" required maxlength="80" value="${e(project?.name || '')}" placeholder="例如：产品设计、研发笔记"><label for="project-description">项目描述</label><textarea id="project-description" name="description" maxlength="500" placeholder="用一句话描述这片知识空间">${e(project?.description || '')}</textarea><label>项目颜色</label><div class="color-picker">${PALETTE.map((color, i) => `<label class="color-option" style="--swatch:${color}"><input type="radio" name="color" value="${color}" aria-label="项目颜色 ${i + 1}" ${project?.color === color || (!project && i === 0) || (project && !PALETTE.includes(project.color) && i === 0) ? 'checked' : ''}><span></span></label>`).join('')}</div>${edit ? '<div class="dialog-danger-zone"><span>删除项目会同时删除其中的全部笔记</span><button type="button" class="text-button danger-text" data-delete-project>删除项目</button></div>' : ''}`,
    { submit: edit ? '保存修改' : '创建项目' },
  );
  if (!result) return;
  const body = Object.fromEntries(result);
  const { project: saved } = await request(`/projects${edit ? '/' + encodeURIComponent(project.id) : ''}`, {
    method: edit ? 'PATCH' : 'POST',
    body,
  });
  state.projects = (await request('/projects')).projects;
  await loadProject(saved.id);
  toast(edit ? '项目信息已更新' : '新的知识空间已创建');
}
async function deleteProject() {
  const current = state.projects.find((p) => p.id === state.projectId);
  if (!current) return;
  await runMutation(
    async () => {
      const answer = await formDialog(
        '删除整个项目',
        `<p>即将删除「${e(current.name)}」及其中的 ${state.notes.length} 篇笔记。此操作无法撤销，请输入项目名称确认。</p><label for="delete-project-name">项目名称</label><input id="delete-project-name" name="confirmation" required autocomplete="off" placeholder="${e(current.name)}">`,
        { submit: '永久删除项目', danger: true },
      );
      if (!answer) return;
      if (answer.get('confirmation') !== current.name) {
        toast('项目名称不匹配，未删除任何内容。', true);
        return;
      }
      await request(`/projects/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      state.projects = (await request('/projects')).projects;
      await loadProject(state.projects[0]?.id || '');
      toast('项目已删除');
    },
    { fromProjectDialog: true },
  );
}
async function deleteNote() {
  const note = state.notes.find((n) => n.id === state.noteId);
  if (!note) return;
  const projectId = state.projectId;
  await runMutation(async () => {
    const answer = await formDialog(
      '删除这篇笔记',
      `<p>确定删除「${e(note.title)}」？此操作无法撤销。其他笔记中的引用文本将保留，方便之后重新建立链接。</p>`,
      { submit: '删除笔记', danger: true },
    );
    if (!answer) return;
    await request(`/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(note.id)}`, {
      method: 'DELETE',
    });
    if (state.projectId !== projectId) return;
    state.notes = state.notes.filter((n) => n.id !== note.id);
    if (state.noteId === note.id) {
      resetEditor();
      state.view = 'notes';
    }
    renderMain();
    toast('笔记已删除');
  });
}
async function pinNote() {
  const note = state.notes.find((n) => n.id === state.noteId);
  if (!note) return;
  const projectId = state.projectId;
  await runMutation(async () => {
    const { note: saved } = await request(
      `/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(note.id)}`,
      { method: 'PATCH', body: { pinned: !note.pinned, version: note.version } },
    );
    if (state.projectId !== projectId) return;
    state.notes = state.notes.map((n) => (n.id === saved.id ? saved : n));
    if (state.noteId === saved.id && state.draft) {
      state.draft.pinned = saved.pinned;
      state.draft.version = saved.version;
    }
    renderMain();
    toast(saved.pinned ? '已加入星标笔记' : '已取消星标');
  });
}
function showHelp() {
  void formDialog(
    '在知屿，连接你的想法',
    `<div class="help-grid"><div><h3>01 · 每个项目，一片空间</h3><p>从左侧下拉菜单切换项目。笔记、标签、搜索和图谱均限定在当前项目。</p></div><div><h3>02 · 用 Markdown 自由表达</h3><p>支持标题、粗体、斜体、列表、任务项、引用、代码块、表格及链接。使用编辑、分屏和阅读模式切换视角。</p></div><div><h3>03 · 让笔记彼此连接</h3><p>输入 <code>[[文档名]]</code> 建立双向链接，也支持 <code>[[文档名|显示名]]</code>。未创建的文档可点击链接创建，反向链接自动更新。</p></div><div><h3>04 · 探索你的知识图谱</h3><p>拖动节点，滚轮缩放，点击节点打开笔记。节点颜色取首个标签，按 Tab 和 Enter 也能打开节点。</p></div><div><h3>05 · 安心保存</h3><p>点击保存或使用 <kbd>Ctrl / ⌘ S</kbd> 将内容存到服务器。<kbd>Ctrl / ⌘ K</kbd> 搜索当前项目。多页面编辑冲突会保留当前草稿，避免覆盖。</p></div></div>`,
  );
}
function showSettings() {
  void formDialog(
    '空间设置',
    `<p>项目与笔记统一保存在服务器。导出的 JSON 包含全部项目和笔记，可作为一份便携备份。</p><div class="settings-actions">${button('export', 'download', '导出全部知识库', 'button secondary')}${state.requiresAuth ? button('logout', 'logout', '退出知识空间', 'button secondary') : ''}</div>`,
  );
}
async function exportData() {
  const data = await request('/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pro-kb-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('知识库已导出');
}
function formatText(type) {
  if (saving || navigating) return;
  const textarea = document.querySelector('#note-content');
  if (!textarea) return;
  if (state.editorMode === 'preview') {
    state.editorMode = 'split';
    document.querySelector('.editor-body').className = 'editor-body mode-split';
    document
      .querySelectorAll('[data-act="editor-mode"]')
      .forEach((b) => b.classList.toggle('selected', b.dataset.mode === 'split'));
  }
  const from = textarea.selectionStart,
    to = textarea.selectionEnd;
  const selected = textarea.value.slice(from, to);
  const values = {
    bold: `**${selected || '重点'}**`,
    italic: `*${selected || '强调'}*`,
    heading: `\n## ${selected || '标题'}\n`,
    link: `[[${selected || '文档名'}]]`,
    list: `\n- ${selected || '列表项'}`,
    code: `\n\x60\x60\x60\n${selected || '代码'}\n\x60\x60\x60\n`,
  };
  textarea.setRangeText(values[type], from, to, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
async function handleAction(action, target) {
  if ((saving || navigating) && !['menu', 'close-menu'].includes(action)) return;
  const changeView = (view) => {
    resetEditor();
    resetFilters();
    state.view = view;
    renderMain();
  };
  switch (action) {
    case 'toggle-projects':
      if (target.getAttribute('aria-expanded') === 'true') closeProjectPicker(true);
      else openProjectPicker();
      break;
    case 'select-project': {
      const id = target.dataset.id;
      closeProjectPicker(true);
      if (id !== state.projectId) {
        await runNavigation(() => loadProject(id));
        document.querySelector('#project-picker-button')?.focus();
      }
      break;
    }
    case 'menu':
      document.body.classList.toggle('menu-open');
      break;
    case 'close-menu':
      closeMenu();
      break;
    case 'home':
    case 'back':
      await runNavigation(() => changeView('overview'));
      break;
    case 'view':
      await runNavigation(() => changeView(target.dataset.view));
      break;
    case 'all-notes':
      await runNavigation(() => changeView('notes'));
      break;
    case 'pinned-notes':
      await runNavigation(() => changeView('pinned'));
      break;
    case 'new-project':
      await runNavigation(() => projectDialog());
      break;
    case 'edit-project':
      await runNavigation(() => projectDialog(true));
      break;
    case 'new-note':
      if (!state.projectId) await runNavigation(() => projectDialog());
      else await runNavigation(() => openNote(null));
      break;
    case 'open-note':
      await runNavigation(() => openNote(target.dataset.id));
      break;
    case 'tag':
      await runNavigation(() => {
        resetEditor();
        state.tag = target.dataset.tag;
        state.view = 'notes';
        renderMain();
      });
      break;
    case 'clear-filters':
      resetFilters();
      state.view = 'notes';
      renderShell();
      break;
    case 'cards':
    case 'list':
      state.layout = action;
      renderMain();
      break;
    case 'expand-graph':
      await runNavigation(() => changeView(state.view === 'graph' ? 'overview' : 'graph'));
      break;
    case 'zoom-in':
      graph?.zoom(1.25);
      break;
    case 'zoom-out':
      graph?.zoom(0.8);
      break;
    case 'graph-reset':
      graph?.reset();
      break;
    case 'graph-labels': {
      const shown = graph?.labels();
      target.setAttribute('aria-pressed', String(shown));
      break;
    }
    case 'editor-mode':
      state.editorMode = target.dataset.mode;
      renderMain();
      break;
    case 'save-note':
      await saveNote();
      break;
    case 'delete-note':
      await deleteNote();
      break;
    case 'pin-note':
      await pinNote();
      break;
    case 'help':
      showHelp();
      break;
    case 'settings':
      showSettings();
      break;
    case 'export':
      await exportData();
      break;
    case 'logout':
      await runNavigation(async () => {
        await request('/logout', { method: 'POST' });
        dialog.close();
        destroyGraph();
        resetEditor();
        state.notes = [];
        state.projects = [];
        app.innerHTML = loginView();
      });
      break;
  }
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.project-picker')) closeProjectPicker();
  const deleteButton = event.target.closest('[data-delete-project]');
  if (deleteButton) {
    void deleteProject().catch(report);
    return;
  }
  const format = event.target.closest('[data-format]');
  if (format) {
    formatText(format.dataset.format);
    return;
  }
  const wiki = event.target.closest('[data-wiki]');
  if (wiki) {
    void runNavigation(async () => {
      const target = state.notes.find((n) => normalizeTitle(n.title) === normalizeTitle(wiki.dataset.wiki));
      if (!target) {
        const answer = await formDialog(
          '让这个连接成为现实',
          `<p>当前项目还没有「${e(wiki.dataset.wiki)}」。创建一篇同名笔记后，链接会自动建立。</p>`,
          { submit: '创建这篇笔记' },
        );
        if (answer) openNote(null, wiki.dataset.wiki);
      } else {
        openNote(target.id);
        if (wiki.dataset.heading)
          document.getElementById(headingId(wiki.dataset.heading))?.scrollIntoView({ behavior: 'smooth' });
      }
    });
    return;
  }
  const target = event.target.closest('[data-act]');
  if (!target) return;
  event.preventDefault();
  void handleAction(target.dataset.act, target).catch(report);
});
document.addEventListener('focusin', (event) => {
  if (!event.target.closest('.project-picker')) closeProjectPicker();
});
document.addEventListener('input', (event) => {
  if (saving || navigating) {
    if (event.target.id === 'search') event.target.value = state.query;
    return;
  }
  if (['note-title', 'note-tags', 'note-content'].includes(event.target.id)) {
    markDirty();
    if (event.target.id === 'note-content') {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const preview = document.querySelector('#markdown-preview');
        if (preview && state.draft) preview.innerHTML = renderMarkdown(state.draft.content);
      }, 160);
    }
  }
  if (event.target.id === 'search') {
    const query = event.target.value;
    if (state.view === 'editor') {
      event.target.value = state.query;
      void runNavigation(() => {
        resetEditor();
        state.query = query;
        state.view = 'notes';
        event.target.value = query;
        renderMain();
      });
    } else {
      state.query = query;
      state.view = 'notes';
      renderMain();
    }
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'project-select') {
    const id = event.target.value;
    event.target.value = state.projectId;
    void runNavigation(() => loadProject(id));
  }
  if (event.target.id === 'sort-notes') {
    if (saving || navigating) {
      event.target.value = state.sort;
      return;
    }
    state.sort = event.target.value;
    renderMain();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest('.project-picker')) {
    const menu = document.querySelector('#project-menu');
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      closeProjectPicker(true);
      return;
    }
    if (event.target.id !== 'project-select' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (menu.hidden) openProjectPicker();
      else {
        const options = [...menu.querySelectorAll('[role="option"]')];
        const current = options.indexOf(document.activeElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#search')?.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.view === 'editor') {
    event.preventDefault();
    void saveNote().catch(report);
  }
  if (event.key === 'Escape') closeMenu();
  if (!saving && !navigating && event.key === 'Tab' && event.target.id === 'note-content') {
    event.preventDefault();
    const field = event.target;
    field.setRangeText('  ', field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.addEventListener('submit', (event) => {
  if (event.target.id !== 'login-form') return;
  event.preventDefault();
  const submit = event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  const password = new FormData(event.target).get('password');
  void request('/login', { method: 'POST', body: { password } })
    .then(start)
    .catch((error) => {
      const errorNode = document.querySelector('#login-error');
      if (errorNode) errorNode.textContent = error.message;
    })
    .finally(() => {
      submit.disabled = false;
    });
});
async function start() {
  const session = await request('/session');
  state.authenticated = session.authenticated;
  state.requiresAuth = session.requiresAuth;
  if (!session.authenticated) {
    app.innerHTML = loginView();
    return;
  }
  state.projects = (await request('/projects')).projects;
  const route = new URLSearchParams(location.hash.slice(1));
  const id = state.projects.some((p) => p.id === route.get('project'))
    ? route.get('project')
    : state.projects[0]?.id || '';
  await loadProject(id, { noteId: route.get('note'), view: route.get('view') || 'overview' });
}
start().catch((error) => {
  app.innerHTML = `<div class="boot-state">${logo()}<p>${e(error.message)}</p><button class="button primary" id="retry-connect">重新连接</button></div>`;
  document.querySelector('#retry-connect').onclick = () => location.reload();
});
