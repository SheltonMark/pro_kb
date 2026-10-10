import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/js/markdown.js';
test('renders common Markdown blocks', () => {
  const html = renderMarkdown(
    '# 标题\n\n**重点**和*强调*\n\n- 项目\n- [x] 完成\n\n> 引用\n\n```js\nconst a = 1;\n```',
  );
  for (const token of [
    '<h1',
    '<strong>重点</strong>',
    '<em>强调</em>',
    '<ul>',
    'checked',
    '<blockquote>',
    '<pre>',
  ])
    assert.ok(html.includes(token), token);
});
test('raw HTML and dangerous URLs are not executable', () => {
  const html = renderMarkdown(
    '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[[\" onclick=\"alert(1)]]',
  );
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('data-wiki="" onclick='));
  assert.ok(html.includes('&lt;img'));
});
test('wiki buttons retain target and alias and code is literal', () => {
  const html = renderMarkdown('[[目标#章节|说明]] `[[不会链接]]`');
  assert.ok(html.includes('data-wiki="目标"'));
  assert.ok(html.includes('说明</button>'));
  assert.ok(html.includes('<code>[[不会链接]]</code>'));
});
test('renders tables, external links and numbered lists', () => {
  const html = renderMarkdown(
    '| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n\n1. 第一步\n2. 第二步\n\n[站点](https://example.com)',
  );
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('deep blockquotes stay bounded and escape the remaining source', () => {
  const html = renderMarkdown('>'.repeat(5000) + ' <img src=x onerror=alert(1)>');
  assert.ok((html.match(/<blockquote>/g) || []).length <= 16);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
});

test('unclosed bracket input renders within a bounded time', () => {
  const content = '['.repeat(50000);
  const started = performance.now();
  assert.equal(renderMarkdown(content), `<p>${content}</p>`);
  assert.ok(
    performance.now() - started < 1000,
    'unclosed brackets must not repeatedly rescan the remaining text',
  );
});
