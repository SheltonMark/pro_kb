import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWikiLinks,
  renameWikiLinks,
  buildGraph,
  backlinks,
  filterNotes,
  normalizeTags,
} from '../public/js/domain.js';

const notes = [
  {
    id: 'a',
    projectId: 'p1',
    title: '起点',
    content: '参见 [[目标]] 和 [[目标|另一称呼]]、[[未创建]]',
    tags: ['设计'],
    pinned: true,
  },
  { id: 'b', projectId: 'p1', title: '目标', content: '回到 [[起点]]', tags: ['研发'] },
  { id: 'c', projectId: 'p2', title: '目标', content: '[[起点]]', tags: ['私密'] },
];
test('wiki links ignore code and escapes, keep target distinct from alias and heading', () => {
  assert.deepEqual(
    extractWikiLinks('[[目标#章节|说明]] `[[代码]]`\n```md\n[[示例]]\n```\n\\[[转义]] [[目标]]'),
    ['目标'],
  );
});
test('rename rewrites real links and preserves headings, aliases and code', () => {
  const content = '[[目标#章节|说明]] [[ 目标 ]] `[[目标]]`\n~~~\n[[目标]]\n~~~';
  assert.equal(
    renameWikiLinks(content, '目标', '新目标'),
    '[[新目标#章节|说明]] [[新目标]] `[[目标]]`\n~~~\n[[目标]]\n~~~',
  );
});
test('graph contains only current project, no unresolved nodes or duplicate edges', () => {
  const graph = buildGraph(notes, 'p1');
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ['a', 'b'],
  );
  assert.equal(graph.links.length, 1);
  assert.deepEqual(new Set([graph.links[0].source, graph.links[0].target]), new Set(['a', 'b']));
});
test('backlinks stay in target project even for identical titles', () => {
  assert.deepEqual(
    backlinks(notes, 'b').map((n) => n.id),
    ['a'],
  );
});
test('search title, body and tags together with project/tag filter', () => {
  assert.deepEqual(
    filterNotes(notes, { projectId: 'p1', query: '目标', tag: '设计' }).map((n) => n.id),
    ['a'],
  );
  assert.deepEqual(filterNotes(notes, { projectId: 'p1', query: '私密' }), []);
  assert.deepEqual(
    filterNotes(notes, { projectId: 'p1', query: '研发' }).map((n) => n.id),
    ['b'],
  );
});
test('tags are trimmed, normalized and deduplicated', () => {
  assert.deepEqual(normalizeTags(['  #设计 ', '设计', '', '研发']), ['设计', '研发']);
});

test('unclosed wiki brackets remain unchanged without blocking extraction or rename', () => {
  const content = '['.repeat(50000);
  const started = performance.now();
  assert.deepEqual(extractWikiLinks(content), []);
  assert.equal(renameWikiLinks(content, 'Alpha', 'Beta'), content);
  assert.ok(performance.now() - started < 1000, 'wiki scans must not repeatedly rescan an unclosed target');
});
