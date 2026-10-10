import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeTitle, renameWikiLinks } from '../public/js/domain.js';
import { sampleProjects } from './seed.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message) => {
  throw new ApiError(400, 'INVALID_INPUT', message);
};
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请输入有效的对象。');
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('请求中包含不支持的字段。');
  if (Object.values(value).some((field) => field === null)) invalid('字段不能为 null，请填写有效值。');
}
function string(value, label, max, required = false) {
  if (typeof value !== 'string') invalid(`${label}必须是文字。`);
  const result = required ? value.trim() : value;
  if ((required && !result) || result.length > max || (required && /[\r\n\x00-\x1f]/.test(result)))
    invalid(`${label}为空或超出长度限制。`);
  return result;
}
function projectFields(input, previous = {}) {
  object(input, ['name', 'description', 'color']);
  const name = string(input.name ?? previous.name, '项目名称', 120, true);
  const description = string(input.description ?? previous.description ?? '', '项目介绍', 2000);
  const color = input.color ?? previous.color ?? '#8B85E9';
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) invalid('项目颜色必须是六位十六进制颜色。');
  return { name, description, color };
}
function noteFields(input, previous = {}) {
  object(input, ['title', 'content', 'tags', 'pinned', 'version']);
  const title = string(input.title ?? previous.title, '笔记标题', 180, true);
  if (/[\[\]#|\\]/.test(title)) invalid('笔记标题不能包含 [ ] # | 或反斜杠。');
  const content = string(input.content ?? previous.content ?? '', '笔记正文', 500000);
  const rawTags = input.tags ?? previous.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 20) invalid('标签必须是最多 20 项的列表。');
  const tags = [...new Set(rawTags.map((tag) => string(tag, '标签', 40, true)))];
  const pinned = input.pinned ?? previous.pinned ?? false;
  if (typeof pinned !== 'boolean') invalid('置顶状态必须是布尔值。');
  return { title, content, tags, pinned };
}
const projectRow = (row) =>
  row && {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
const noteRow = (row) =>
  row && {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags),
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
const timestamp = (previous = '') =>
  new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();

export function createStore({ filename = ':memory:', seed = false } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const initialized = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'")
    .get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, normalized_title TEXT NOT NULL, content TEXT NOT NULL,
      tags TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(project_id, normalized_title)
    );
    CREATE INDEX IF NOT EXISTS notes_project_updated ON notes(project_id, updated_at DESC);
  `);
  let transactionDepth = 0,
    closed = false;
  function transaction(fn) {
    if (transactionDepth) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }
  function getProject(id) {
    const p = projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
    if (!p) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在或已被删除。');
    return p;
  }
  function getNote(projectId, noteId) {
    getProject(projectId);
    const n = noteRow(
      db.prepare('SELECT * FROM notes WHERE id = ? AND project_id = ?').get(noteId, projectId),
    );
    if (!n) throw new ApiError(404, 'NOTE_NOT_FOUND', '笔记不存在或不属于当前项目。');
    return n;
  }
  function unique(projectId, title, except = '') {
    const duplicate = db
      .prepare('SELECT id FROM notes WHERE project_id = ? AND normalized_title = ? AND id != ?')
      .get(projectId, normalizeTitle(title), except);
    if (duplicate) throw new ApiError(409, 'DUPLICATE_TITLE', '此项目已有同名笔记，请使用其他标题。');
  }
  function touchProject(id) {
    const p = getProject(id);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp(p.updatedAt), id);
  }
  const store = {
    listProjects() {
      return db.prepare('SELECT * FROM projects ORDER BY created_at, id').all().map(projectRow);
    },
    createProject(input) {
      const fields = projectFields(input),
        id = randomUUID(),
        time = timestamp();
      db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        fields.name,
        fields.description,
        fields.color,
        time,
        time,
      );
      return getProject(id);
    },
    updateProject(id, input) {
      return transaction(() => {
        const previous = getProject(id),
          fields = projectFields(input, previous);
        db.prepare(
          'UPDATE projects SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?',
        ).run(fields.name, fields.description, fields.color, timestamp(previous.updatedAt), id);
        return getProject(id);
      });
    },
    deleteProject(id) {
      getProject(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    },
    listNotes(projectId) {
      getProject(projectId);
      return db
        .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC, id')
        .all(projectId)
        .map(noteRow);
    },
    createNote(projectId, input) {
      return transaction(() => {
        getProject(projectId);
        const fields = noteFields(input),
          id = randomUUID(),
          time = timestamp();
        unique(projectId, fields.title);
        db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').run(
          id,
          projectId,
          fields.title,
          normalizeTitle(fields.title),
          fields.content,
          JSON.stringify(fields.tags),
          Number(fields.pinned),
          time,
          time,
        );
        touchProject(projectId);
        return getNote(projectId, id);
      });
    },
    updateNote(projectId, id, input) {
      return transaction(() => {
        const previous = getNote(projectId, id);
        object(input, ['title', 'content', 'tags', 'pinned', 'version']);
        if (!Number.isSafeInteger(input.version) || input.version < 1)
          invalid('保存笔记时需要有效的版本号。');
        if (input.version !== previous.version)
          throw new ApiError(409, 'VERSION_CONFLICT', '笔记已被其他窗口修改，请重新载入后再保存。');
        const fields = noteFields(input, previous);
        unique(projectId, fields.title, id);
        if (fields.title !== previous.title) {
          fields.content = renameWikiLinks(fields.content, previous.title, fields.title);
          for (const referring of store.listNotes(projectId)) {
            if (referring.id === id) continue;
            const content = renameWikiLinks(referring.content, previous.title, fields.title);
            if (content !== referring.content) {
              if (content.length > 500000) invalid('重命名后的关联笔记正文超出长度限制。');
              db.prepare(
                'UPDATE notes SET content = ?, updated_at = ?, version = version + 1 WHERE id = ?',
              ).run(content, timestamp(referring.updatedAt), referring.id);
            }
          }
        }
        if (fields.content.length > 500000) invalid('重命名后的笔记正文超出长度限制。');
        db.prepare(
          'UPDATE notes SET title = ?, normalized_title = ?, content = ?, tags = ?, pinned = ?, updated_at = ?, version = version + 1 WHERE id = ? AND project_id = ?',
        ).run(
          fields.title,
          normalizeTitle(fields.title),
          fields.content,
          JSON.stringify(fields.tags),
          Number(fields.pinned),
          timestamp(previous.updatedAt),
          id,
          projectId,
        );
        touchProject(projectId);
        return getNote(projectId, id);
      });
    },
    deleteNote(projectId, id) {
      return transaction(() => {
        getNote(projectId, id);
        db.prepare('DELETE FROM notes WHERE id = ? AND project_id = ?').run(id, projectId);
        touchProject(projectId);
      });
    },
    exportData() {
      return {
        version: 1,
        projects: store.listProjects(),
        notes: db.prepare('SELECT * FROM notes ORDER BY project_id, created_at, id').all().map(noteRow),
      };
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
  if (!initialized) {
    transaction(() => {
      if (seed) {
        for (const sample of sampleProjects()) {
          const p = store.createProject(sample.project);
          for (const item of sample.notes) {
            const n = store.createNote(p.id, item.note);
            db.prepare('UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?').run(
              item.createdAt,
              item.updatedAt,
              n.id,
            );
          }
          db.prepare('UPDATE projects SET created_at = ?, updated_at = ? WHERE id = ?').run(
            sample.createdAt,
            sample.updatedAt,
            p.id,
          );
        }
      }
      db.prepare('INSERT INTO app_meta VALUES (?, ?)').run('schema_version', '1');
    });
  }
  return store;
}
