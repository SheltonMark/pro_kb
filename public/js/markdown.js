import { wikiParts } from './domain.js';

export const escapeHTML = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
export const headingId = (value) => value.trim().toLocaleLowerCase().replace(/\s+/g, '-');
function safeURL(url, image = false) {
  try {
    const parsed = new URL(url);
    return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:']).includes(parsed.protocol)
      ? escapeHTML(parsed.href)
      : '';
  } catch {
    return '';
  }
}
function inline(source) {
  // Parse the original text once; raw text is always escaped before insertion.
  const expression =
    /\\([\\`*_{}\[\]()#+.!>~-])|(`+)([\s\S]*?)\2|\[\[([^\[\]\n]+)\]\]|(!?)\[([^\[\]\n]*)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let html = '',
    cursor = 0;
  for (const m of source.matchAll(expression)) {
    html += escapeHTML(source.slice(cursor, m.index));
    if (m[1]) html += escapeHTML(m[1]);
    else if (m[2]) html += `<code>${escapeHTML(m[3])}</code>`;
    else if (m[4]) {
      const { title, heading, label } = wikiParts(m[4]);
      html += `<button type="button" class="wiki-link" data-wiki="${escapeHTML(title)}" data-heading="${escapeHTML(heading)}">${escapeHTML(label)}</button>`;
    } else if (m[6] !== undefined) {
      const url = safeURL(m[7], !!m[5]);
      html += !url
        ? escapeHTML(m[6])
        : m[5]
          ? `<img src="${url}" alt="${escapeHTML(m[6])}" loading="lazy" referrerpolicy="no-referrer">`
          : `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHTML(m[6])}</a>`;
    } else if (m[8] || m[9]) html += `<strong>${escapeHTML(m[8] || m[9])}</strong>`;
    else if (m[10]) html += `<del>${escapeHTML(m[10])}</del>`;
    else html += `<em>${escapeHTML(m[11] || m[12])}</em>`;
    cursor = m.index + m[0].length;
  }
  return html + escapeHTML(source.slice(cursor));
}
export function renderMarkdown(content = '', depth = 0) {
  if (depth >= 16) return `<p>${escapeHTML(content).replace(/\n/g, '<br>')}</p>`;
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  let html = '',
    i = 0;
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const blockStart = (line) =>
    /^\s*$|^ {0,3}(#{1,6}\s|`{3,}|~{3,}|>|[-*+]\s|\d+\.\s|(?:---+|\*\*\*+)\s*$)/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])
      )
        code.push(lines[i++]);
      html += `<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`;
      i++;
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level} id="${escapeHTML(headingId(heading[2]))}">${inline(heading[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      html += '<hr>';
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*> ?/, ''));
      html += `<blockquote>${renderMarkdown(quote.join('\n'), depth + 1)}</blockquote>`;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1])) {
      html += `<div class="table-scroll"><table><thead><tr>${cells(line)
        .map((c) => `<th>${inline(c)}</th>`)
        .join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim())
        html += `<tr>${cells(lines[i++])
          .map((c) => `<td>${inline(c)}</td>`)
          .join('')}</tr>`;
      html += '</tbody></table></div>';
      continue;
    }
    const list = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const type = ordered ? 'ol' : 'ul';
      const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      html += `<${type}>`;
      let item;
      while (i < lines.length && (item = lines[i].match(pattern))) {
        const task = item[1].match(/^\[([ xX])\]\s+(.*)$/);
        html += task
          ? `<li class="task-item"><input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''} aria-label="${escapeHTML(task[2])}">${inline(task[2])}</li>`
          : `<li>${inline(item[1])}</li>`;
        i++;
      }
      html += `</${type}>`;
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && !blockStart(lines[i])) {
      if (lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) break;
      paragraph.push(lines[i++]);
    }
    html += `<p>${inline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  return html;
}
