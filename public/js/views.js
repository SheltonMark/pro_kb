import { icon, logo } from './icons.js';
import { escapeHTML as e, renderMarkdown } from './markdown.js';
import { buildGraph, projectTags, tagColor, excerpt, backlinks, extractWikiLinks } from './domain.js';

export const button = (action, glyph, label, cls = 'icon-button', attrs = '') =>
  `<button type="button" class="${cls}" data-act="${action}" aria-label="${e(label)}" title="${e(label)}" ${attrs}>${glyph ? icon(glyph) : ''}${cls.includes('icon-button') ? '' : e(label)}</button>`;
export function relativeTime(value) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 86400000 * 7) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
export const tagChip = (tag) =>
  `<span class="tag-chip" style="--tag-color:${tagColor(tag)}"><span class="tag-dot"></span>${e(tag)}</span>`;
export const empty = (title, description, action = '') =>
  `<div class="empty-state"><span class="empty-icon">${icon('book')}</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;
export function sidebar(state) {
  const project = state.projects.find((p) => p.id === state.projectId);
  const tags = projectTags(state.notes);
  const nav = (view, glyph, label, count) =>
    `<button class="nav-item ${state.view === view && !state.tag ? 'active' : ''}" data-act="view" data-view="${view}">${icon(glyph)}<span>${label}</span>${count !== undefined ? `<span class="nav-count">${count}</span>` : ''}</button>`;
  return `<aside class="sidebar glass" aria-label="知识库导航">
    <a class="brand" href="#" data-act="home">${logo()}<span>知屿<span class="brand-en">PRO KB</span></span></a>
    <div class="project-switch"><label class="eyebrow" for="project-select">工作空间 <span>WORKSPACE</span></label>
      <div class="project-picker">
        <div class="project-selector project-native"><span class="project-symbol" style="--project-color:${project?.color || '#a5b1c5'}">${icon('folder')}</span><select id="project-select" aria-label="切换项目">${state.projects.map((p) => `<option value="${e(p.id)}" ${p.id === state.projectId ? 'selected' : ''}>${e(p.name)}</option>`).join('')}${!project ? '<option value="">选择项目</option>' : ''}</select>${icon('chevron')}</div>
        <button type="button" id="project-picker-button" class="project-selector project-picker-button" data-act="toggle-projects" aria-label="切换项目" aria-haspopup="listbox" aria-expanded="false" aria-controls="project-menu"><span class="project-symbol" style="--project-color:${project?.color || '#a5b1c5'}">${icon('folder')}</span><span class="project-picker-name">${e(project?.name || '选择项目')}</span>${icon('chevron')}</button>
        <div id="project-menu" class="project-menu" role="listbox" aria-label="项目列表" hidden>${state.projects.map((p) => `<button type="button" role="option" aria-label="${e(p.name)}" aria-selected="${p.id === state.projectId}" tabindex="-1" data-act="select-project" data-id="${e(p.id)}"><span class="project-symbol" style="--project-color:${p.color}">${icon('folder')}</span><span class="project-picker-name">${e(p.name)}</span>${p.id === state.projectId ? icon('check', 'project-check') : ''}</button>`).join('')}${!state.projects.length ? '<span class="project-menu-empty">暂无项目</span>' : ''}</div>
      </div>
      <div class="project-actions">${button('new-project', 'plus', '新建项目', 'text-button')}${project ? button('edit-project', 'edit', '编辑项目') : ''}</div>
    </div>
    <nav class="main-nav">${nav('overview', 'grid', '知识概览')}${nav('notes', 'note', '全部笔记', state.notes.length)}${nav('graph', 'graph', '关系图谱')}${nav('pinned', 'star', '星标笔记', state.notes.filter((n) => n.pinned).length)}</nav>
    <div class="sidebar-divider"></div>
    <div class="section-label"><span>项目标签</span><span>${tags.length}</span></div>
    <nav class="tag-nav" aria-label="标签筛选">${tags.length ? tags.map((tag) => `<button class="tag-nav-item ${state.tag === tag.name ? 'active' : ''}" data-act="tag" data-tag="${e(tag.name)}"><span class="tag-dot" style="--tag-color:${tag.color}"></span><span>${e(tag.name)}</span><span class="nav-count">${tag.count}</span></button>`).join('') : '<p class="sidebar-hint">为笔记添加标签<br>让想法井然有序</p>'}</nav>
    <div class="sidebar-bottom"><div class="storage-status">${icon('cloud')}<div><strong>服务器存储</strong><span>项目资料 · 持久保存</span></div><i class="status-dot"></i></div>
      <div class="sidebar-tools">${button('help', 'help', '使用指南', 'text-button')}<span class="version">v1.0</span>${button('settings', 'settings', '空间设置')}</div>
    </div>
  </aside>`;
}
export function shell(state) {
  const project = state.projects.find((p) => p.id === state.projectId);
  return `<div class="workspace">${sidebar(state)}<button class="nav-overlay" data-act="close-menu" aria-label="关闭导航"></button><div class="main-shell">
    <header class="topbar"><div class="breadcrumb">${button('menu', 'menu', '打开导航', 'icon-button mobile-menu')}<span class="breadcrumb-home">我的空间</span>${icon('right')}<span>${e(project?.name || '新项目')}</span></div>
      <div class="topbar-right"><label class="global-search">${icon('search')}<input id="search" type="search" autocomplete="off" placeholder="搜索文档或标签" value="${e(state.query)}" aria-label="搜索当前项目"><kbd>⌘ K</kbd></label><span class="topbar-divider"></span>${button('help', 'help', '使用指南')}</div>
    </header><main id="main" tabindex="-1"></main><footer class="app-footer"><span><i class="status-dot"></i> ${e(project?.name || '知屿')} · 独立知识空间</span><span>PRO KB <b>/</b> PROJECT KNOWLEDGE BASE</span></footer></div></div>`;
}
export function noteCard(note, compact = false) {
  const color = tagColor(note.tags[0]);
  return `<button class="${compact ? 'recent-note' : 'note-card glass'}" data-act="open-note" data-id="${e(note.id)}"><span class="note-file" style="--tag-color:${color}">${icon('note')}</span><span class="note-card-body"><span class="note-title">${e(note.title)}${note.pinned ? icon('star', 'pinned-icon') : ''}</span>${compact ? `<span class="note-subtitle">${e(note.tags[0] || '未分类')}<span>·</span>${relativeTime(note.updatedAt)}</span>` : `<span class="note-excerpt">${e(excerpt(note.content) || '还没有内容，让一个想法从这里开始。')}</span><span class="note-card-tags">${note.tags.slice(0, 3).map(tagChip).join('')}</span><span class="note-card-foot"><span>${relativeTime(note.updatedAt)}更新</span><span>${icon('link')}${extractWikiLinks(note.content).length}</span></span>`}</span>${compact ? icon('right', 'recent-arrow') : ''}</button>`;
}
function graphPanel(state, large = false) {
  const graph = buildGraph(state.filtered || state.notes, state.projectId);
  const tags = projectTags(state.filtered || state.notes);
  return `<section class="graph-panel glass ${large ? 'graph-large' : ''}"><div class="panel-heading"><div><span class="section-icon">${icon('graph')}</span><h2>知识关系图谱</h2><span class="live-pill"><i></i>实时关联</span></div><div class="panel-heading-actions">${button('graph-labels', 'tag', '显示或隐藏图谱标签')}${button('expand-graph', 'expand', large ? '返回概览' : '展开图谱')}</div></div>
    <div class="graph-canvas-wrap"><div class="graph-dot-grid"></div><div id="graph-canvas" class="graph-canvas">${graph.nodes.length ? '' : empty('连接，从一条笔记开始', '在笔记中输入 [[文档名]]，建立知识之间的联系。', button('new-note', 'plus', '创建笔记', 'button primary'))}</div><div class="graph-caption"><span class="tiny-orbit"></span><span>${graph.nodes.length} 个节点 <b>·</b> ${graph.links.length} 个连接</span></div><div class="graph-controls glass">${button('zoom-in', 'plus', '放大图谱')}<span id="zoom-value">100%</span>${button('zoom-out', 'minus', '缩小图谱')}<span class="control-divider"></span>${button('graph-reset', 'center', '居中图谱')}</div></div>
    <div class="graph-footer"><div class="graph-legend">${tags
      .slice(0, 5)
      .map(
        (tag) =>
          `<button data-act="tag" data-tag="${e(tag.name)}"><i class="tag-dot" style="--tag-color:${tag.color}"></i>${e(tag.name)}</button>`,
      )
      .join(
        '',
      )}${state.notes.some((n) => !n.tags.length) ? '<span class="muted">无标签</span>' : ''}</div><span>拖动探索 <b>·</b> 滚轮缩放</span></div></section>`;
}
export function overview(state) {
  const project = state.projects.find((p) => p.id === state.projectId);
  if (!project)
    return `<section class="no-project glass">${empty('为下一个想法，创建一片空间', '每个项目都有独立的笔记、标签与知识图谱。', button('new-project', 'plus', '创建第一个项目', 'button primary'))}</section>`;
  const graph = buildGraph(state.notes, state.projectId);
  const recent = [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const tags = projectTags(state.notes);
  const pinned = state.notes.filter((n) => n.pinned).slice(0, 3);
  return `<section class="page-intro project-hero"><div><div class="intro-kicker"><span class="project-index">0${state.projects.findIndex((p) => p.id === project.id) + 1}</span> / 项目知识库</div><h1>${e(project.name)}</h1><p>${e(project.description || '项目文档与关联知识')}</p><div class="project-metrics"><span><strong>${state.notes.length}</strong> 篇文档</span><i></i><span><strong>${graph.links.length}</strong> 个关联</span><i></i><span><strong>${tags.length}</strong> 个主题</span></div></div><div class="intro-actions">${button('edit-project', 'more', '管理当前项目', 'icon-button subtle')}${button('new-note', 'plus', '新建笔记', 'button primary')}</div></section>
    <div class="overview-grid">${graphPanel(state)}<aside class="recent-panel glass"><div class="panel-heading"><div><span class="rail-index">01</span><h2>最近编辑</h2></div>${button('all-notes', 'arrow', '查看全部笔记')}</div><div class="recent-list">${
      recent
        .slice(0, 5)
        .map((n) => noteCard(n, true))
        .join('') || '<p class="sidebar-hint">创建笔记，开始整理项目资料。</p>'
    }</div><button class="all-notes-link" data-act="all-notes">全部文档 ${icon('arrow')}</button><div class="project-archive"><span class="archive-label">项目档案</span><div><span class="archive-number">${String(state.notes.length).padStart(2, '0')}</span><span>DOCUMENTS<br><b>${recent.length ? relativeTime(recent[0].updatedAt) + '更新' : '暂无文档'}</b></span></div><div class="archive-bars" aria-hidden="true">${Array.from({ length: 25 }, (_, i) => `<i style="height:${12 + ((i * 17 + state.notes.length * 3) % 25)}px"></i>`).join('')}</div></div></aside></div>
    <section class="pinned-section"><div class="section-heading"><h2>星标文档 <span>PINNED DOCUMENTS</span></h2>${button('pinned-notes', 'arrow', '查看全部', 'text-button')}</div><div class="note-grid">${pinned.length ? pinned.map((n) => noteCard(n)).join('') : `<button class="pin-placeholder glass" data-act="all-notes">${icon('star')} 在文档中添加星标，即可固定到这里。</button>`}</div></section>`;
}
export function notesView(state) {
  const title = state.query
    ? '搜索结果'
    : state.tag
      ? state.tag
      : state.view === 'pinned'
        ? '星标笔记'
        : '全部笔记';
  return `<section class="page-intro compact"><div><div class="intro-kicker">DOCUMENT LIBRARY</div><h1>${e(title)}</h1><p>${state.query ? `搜索「${e(state.query)}」，找到 ${state.filtered.length} 篇笔记` : `当前项目 · ${state.filtered.length} 篇笔记`}</p></div>${button('new-note', 'plus', '新建笔记', 'button primary')}</section>
    <div class="notes-toolbar"><div class="filter-chips"><button class="filter-chip ${!state.tag ? 'selected' : ''}" data-act="tag" data-tag="">全部</button>${projectTags(
      state.notes,
    )
      .map(
        (t) =>
          `<button class="filter-chip ${state.tag === t.name ? 'selected' : ''}" data-act="tag" data-tag="${e(t.name)}"><i class="tag-dot" style="--tag-color:${t.color}"></i>${e(t.name)}<span>${t.count}</span></button>`,
      )
      .join(
        '',
      )}</div><div class="view-options"><select id="sort-notes" aria-label="笔记排序"><option value="updated" ${state.sort === 'updated' ? 'selected' : ''}>最近更新</option><option value="title" ${state.sort === 'title' ? 'selected' : ''}>标题排序</option><option value="created" ${state.sort === 'created' ? 'selected' : ''}>创建时间</option></select><div class="segmented">${button('cards', 'grid', '卡片视图', `icon-button ${state.layout === 'cards' ? 'selected' : ''}`)}${button('list', 'list', '列表视图', `icon-button ${state.layout === 'list' ? 'selected' : ''}`)}</div></div></div>
    ${state.filtered.length ? `<div class="note-grid all-note-grid ${state.layout === 'list' ? 'list-layout' : ''}">${state.filtered.map((n) => noteCard(n)).join('')}</div>` : `<section class="glass">${empty('还没有匹配的笔记', state.query || state.tag ? '试试其他关键词，或清除标签筛选。' : '从一条笔记开始，慢慢构建你的知识世界。', button(state.query || state.tag ? 'clear-filters' : 'new-note', state.query || state.tag ? 'close' : 'plus', state.query || state.tag ? '清除筛选' : '新建笔记', 'button secondary'))}</section>`}`;
}
export function fullGraph(state) {
  return `<section class="page-intro compact"><div><div class="intro-kicker">KNOWLEDGE NETWORK</div><h1>关系图谱</h1><p>文档引用关系 · 拖动节点探索，点击打开文档</p></div>${button('new-note', 'plus', '新建笔记', 'button primary')}</section>${graphPanel(state, true)}`;
}
export function editorView(state) {
  const note = state.draft;
  const existing = state.notes.find((n) => n.id === state.noteId);
  const refs = existing ? backlinks(state.notes, existing.id) : [];
  return `<div class="editor-top"><button class="text-button" data-act="back">${icon('back')} 返回知识空间</button><div class="editor-actions"><span id="save-status" class="save-status">${state.dirty ? '有未保存的更改' : '已保存至服务器'}</span>${existing ? button('pin-note', 'star', existing.pinned ? '取消星标' : '添加星标', `icon-button ${existing.pinned ? 'is-pinned' : ''}`) + button('delete-note', 'trash', '删除笔记') : ''}${button('save-note', 'check', '保存笔记', 'button primary')}</div></div>
    <section class="editor-panel glass"><div class="note-heading"><input id="note-title" aria-label="笔记标题" maxlength="120" placeholder="给这个想法起个名字" value="${e(note.title)}"><div class="note-meta"><span>${icon('clock')} ${existing ? `更新于 ${relativeTime(existing.updatedAt)}` : '新的思考，从这里开始'}</span><span>${icon('folder')} ${e(state.projects.find((p) => p.id === state.projectId)?.name || '')}</span></div><label class="tags-input-label" for="note-tags">${icon('tag')}<input id="note-tags" placeholder="添加标签，用逗号分隔" aria-label="笔记标签，用逗号分隔" value="${e(note.tags.join(', '))}"></label></div>
    <div class="editor-toolbar"><div class="format-actions"><button data-format="bold" aria-label="插入粗体"><b>B</b></button><button data-format="italic" aria-label="插入斜体"><i>I</i></button><button data-format="heading" aria-label="插入标题">H<span>2</span></button><span class="control-divider"></span><button data-format="link" aria-label="插入双向链接">${icon('link')}</button><button data-format="list" aria-label="插入列表">${icon('list')}</button><button data-format="code" aria-label="插入代码">${icon('code')}</button></div><div class="segmented editor-tabs">${['edit', 'split', 'preview'].map((m, i) => `<button class="${state.editorMode === m ? 'selected' : ''}" data-act="editor-mode" data-mode="${m}">${['编辑', '分屏', '阅读'][i]}</button>`).join('')}</div></div>
    <div class="editor-body mode-${state.editorMode}"><textarea id="note-content" aria-label="Markdown 正文" spellcheck="false" placeholder="记录一个想法…&#10;&#10;使用 [[文档名]] 连接另一篇笔记。">${e(note.content)}</textarea><article id="markdown-preview" class="markdown">${renderMarkdown(note.content) || '<p class="preview-placeholder">你的想法，会在这里舒展。</p>'}</article></div>
    <div class="editor-bottom"><span>Markdown <span>·</span> 支持 [[双向链接]]</span><span id="word-count">${note.content.length} 字符</span></div></section>
    <section class="backlinks-panel glass"><div class="panel-heading"><div>${icon('link')}<h2>反向链接</h2><span class="count-pill">${refs.length}</span></div><span class="muted">哪些想法，连接到了这里</span></div><div class="backlinks-list">${refs.length ? refs.map((n) => `<button data-act="open-note" data-id="${e(n.id)}">${icon('note')}<span>${e(n.title)}</span>${icon('arrow')}</button>`).join('') : '<p>还没有笔记引用此文档。在其他笔记中输入 [[本篇标题]] 即可建立关联。</p>'}</div></section>`;
}
export function loginView() {
  return `<div class="login-page"><div class="login-brand">${logo()}<strong>知屿</strong><span>PRO KB</span></div><section class="login-card glass"><span class="login-orb">${icon('lock')}</span><div class="intro-kicker">WELCOME TO YOUR SPACE</div><h1>让思考，<br>有一处安静的栖息地。</h1><p>输入空间密码，继续连接你的知识与灵感。</p><form id="login-form"><label for="password">空间访问密码</label><input id="password" type="password" name="password" required autocomplete="current-password" placeholder="输入访问密码"><p id="login-error" class="form-error" role="alert"></p><button class="button primary" type="submit">进入知识空间 ${icon('arrow')}</button></form><span class="login-foot">你的知识，安全保存于服务器。</span></section></div>`;
}
