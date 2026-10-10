/** Pure business rules. No browser, storage, network or third-party dependencies. */
export const normalizeTitle = (title) => String(title).normalize('NFKC').trim().toLocaleLowerCase();
export const normalizeTags = (tags) => [
  ...new Set(tags.map((t) => String(t).trim().replace(/^#+/, '').trim()).filter(Boolean)),
];
export const PALETTE = ['#74b8c6', '#9ab893', '#c6af8c', '#ad9fce', '#ce9ba6', '#829dcc'];
const knownTags = ['系统架构', '低功耗', '媒体存储', '云端协同'];
export function tagColor(tag = '') {
  const known = knownTags.indexOf(tag);
  const hash = [...tag].reduce((v, ch) => (v * 31 + ch.codePointAt(0)) >>> 0, 0);
  return PALETTE[known >= 0 ? known : hash % PALETTE.length];
}
export function wikiParts(value) {
  const pipe = value.indexOf('|');
  const destination = (pipe < 0 ? value : value.slice(0, pipe)).trim();
  const hash = destination.indexOf('#');
  return {
    title: (hash < 0 ? destination : destination.slice(0, hash)).trim(),
    heading: hash < 0 ? '' : destination.slice(hash + 1),
    label: pipe < 0 ? destination : value.slice(pipe + 1).trim(),
  };
}

/** Apply a transformation to prose, preserving fenced and inline code verbatim. */
function mapProse(source, transform) {
  const inline = (text) => {
    const pattern = /(`+)([\s\S]*?)\1/g;
    let result = '',
      cursor = 0;
    for (const match of text.matchAll(pattern)) {
      result += transform(text.slice(cursor, match.index)) + match[0];
      cursor = match.index + match[0].length;
    }
    return result + transform(text.slice(cursor));
  };
  let fence = null,
    result = '',
    prose = '';
  for (const line of String(source).match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      result += line;
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        line.slice(marker[0].length).trim() === ''
      )
        fence = null;
    } else if (marker) {
      result += inline(prose) + line;
      prose = '';
      fence = marker[1];
    } else prose += line;
  }
  return result + inline(prose);
}
export function extractWikiLinks(content = '') {
  const found = new Map();
  mapProse(content, (prose) => {
    for (const match of prose.matchAll(/(?<!\\)\[\[([^\[\]\n]+)\]\]/g)) {
      const { title } = wikiParts(match[1]);
      if (title) found.set(normalizeTitle(title), title);
    }
    return prose;
  });
  return [...found.values()];
}
export function renameWikiLinks(content, oldTitle, newTitle) {
  return mapProse(content, (prose) =>
    prose.replace(/(?<!\\)\[\[([^\[\]\n]+)\]\]/g, (full, value) => {
      const { title } = wikiParts(value);
      if (normalizeTitle(title) !== normalizeTitle(oldTitle)) return full;
      const suffix = value.search(/[#|]/);
      return `[[${newTitle}${suffix < 0 ? '' : value.slice(suffix)}]]`;
    }),
  );
}
export function filterNotes(notes, { projectId, query = '', tag = '', pinned = false } = {}) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return notes.filter(
    (note) =>
      (!projectId || note.projectId === projectId) &&
      (!tag || note.tags.includes(tag)) &&
      (!pinned || note.pinned) &&
      words.every((word) =>
        `${note.title}\n${note.content}\n${note.tags.join(' ')}`.toLocaleLowerCase().includes(word),
      ),
  );
}
export function backlinks(notes, noteId) {
  const target = notes.find((n) => n.id === noteId);
  if (!target) return [];
  return notes.filter(
    (n) =>
      n.id !== noteId &&
      n.projectId === target.projectId &&
      extractWikiLinks(n.content).some((title) => normalizeTitle(title) === normalizeTitle(target.title)),
  );
}
export function projectTags(notes) {
  const counts = new Map();
  notes.forEach((n) => n.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  return [...counts]
    .map(([name, count]) => ({ name, count, color: tagColor(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export function buildGraph(notes, projectId) {
  const current = notes.filter((n) => n.projectId === projectId);
  const byTitle = new Map(current.map((n) => [normalizeTitle(n.title), n]));
  const edges = new Map();
  for (const note of current) {
    for (const name of extractWikiLinks(note.content)) {
      const target = byTitle.get(normalizeTitle(name));
      if (target && target.id !== note.id) {
        const key = [note.id, target.id].sort().join(':');
        if (!edges.has(key)) edges.set(key, { source: note.id, target: target.id });
      }
    }
  }
  const links = [...edges.values()];
  const nodes = current.map((n) => ({
    id: n.id,
    title: n.title,
    tags: [...n.tags],
    color: tagColor(n.tags[0]),
    degree: links.filter((e) => e.source === n.id || e.target === n.id).length,
  }));
  return { nodes, links };
}
export function excerpt(content, maxLength = 90) {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[([^\[\]\n]+)\]\]/g, (_, v) => wikiParts(v).label)
    .replace(/[#>*_~`\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
