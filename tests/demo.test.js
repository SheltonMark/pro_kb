import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleProjects } from '../server/seed.js';
import { extractWikiLinks, normalizeTitle } from '../public/js/domain.js';

test('three demo projects contain 12/5/5 notes and every internal link resolves within its own project', () => {
  const projects = sampleProjects();
  assert.deepEqual(
    projects.map((p) => [p.project.name, p.notes.length]),
    [
      ['CS7GV1.0', 12],
      ['嵌入式开发', 5],
      ['Linux 内核', 5],
    ],
  );
  for (const project of projects) {
    const titles = new Set(project.notes.map((n) => normalizeTitle(n.note.title)));
    for (const { note } of project.notes) {
      const targets = extractWikiLinks(note.content);
      assert.ok(targets.length >= 2, note.title);
      for (const target of targets)
        assert.ok(titles.has(normalizeTitle(target)), `${note.title} -> ${target}`);
    }
  }
});
