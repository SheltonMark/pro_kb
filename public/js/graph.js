/** D3 is deliberately contained in this disposable rendering adapter. */
export function mountGraph(container, data, { onOpen, onScale = () => {} } = {}) {
  const d3 = window.d3;
  if (!d3) {
    container.innerHTML =
      '<div class="empty-state"><p>图谱组件未能加载，请刷新页面。笔记仍可正常使用。</p></div>';
    return { destroy() {}, zoom() {}, reset() {}, labels() {} };
  }
  let width = container.clientWidth,
    height = container.clientHeight,
    showLabels = true;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes = data.nodes.map((n) => ({ ...n }));
  const links = data.links.map((l) => ({ ...l }));
  const svg = d3
    .select(container)
    .append('svg')
    .attr('viewBox', [0, 0, width, height])
    .attr('aria-label', '知识关系图谱，拖动节点，滚轮缩放，点击打开笔记');
  const scene = svg.append('g');
  const line = scene.append('g').attr('class', 'graph-links').selectAll('line').data(links).join('line');
  const node = scene
    .append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'graph-node')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (n) => `打开笔记：${n.title}`)
    .on('click', (event, n) => {
      if (!event.defaultPrevented) onOpen(n.id);
    })
    .on('keydown', (event, n) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen(n.id);
      }
    });
  node
    .append('circle')
    .attr('class', 'node-halo')
    .attr('r', (n) => 14 + Math.min(n.degree * 1.4, 10))
    .attr('fill', (n) => n.color)
    .attr('opacity', 0.055);
  node
    .append('circle')
    .attr('class', 'node-core')
    .attr('r', (n) => 5 + Math.min(n.degree * 0.7, 5))
    .attr('fill', (n) => n.color);
  node
    .append('text')
    .attr('dy', (n) => 25 + Math.min(n.degree, 7))
    .attr('text-anchor', 'middle')
    .text((n) => n.title);
  node.append('title').text((n) => `${n.title} · ${n.degree} 个关联`);
  const linked = new Set(links.flatMap((l) => [`${l.source}:${l.target}`, `${l.target}:${l.source}`]));
  function highlight(current) {
    scene.classed('graph-highlighted', !!current);
    node
      .classed('faded', (n) => !!current && n.id !== current.id && !linked.has(`${current.id}:${n.id}`))
      .classed('related', (n) => !!current && (n.id === current.id || linked.has(`${current.id}:${n.id}`)))
      .classed('selected-node', (n) => n.id === current?.id);
    line.classed(
      'emphasized',
      (l) => !!current && (l.source.id === current.id || l.target.id === current.id),
    );
  }
  node
    .on('mouseenter', (_, current) => highlight(current))
    .on('mouseleave', () => highlight(null))
    .on('focus', (_, current) => highlight(current))
    .on('blur', () => highlight(null));
  const zoom = d3
    .zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => {
      scene.attr('transform', event.transform);
      onScale(Math.round(event.transform.k * 100));
    });
  svg.call(zoom).on('dblclick.zoom', null);
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink(links)
        .id((n) => n.id)
        .distance(130)
        .strength(0.16),
    )
    .force('charge', d3.forceManyBody().strength(-440))
    .force(
      'collision',
      d3
        .forceCollide()
        .radius((n) => Math.max(42, n.title.length * 5))
        .iterations(2),
    )
    .force('x', d3.forceX(width / 2).strength(0.028))
    .force('y', d3.forceY(height / 2).strength(0.075))
    .stop();
  const update = () => {
    line
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
    node.attr('transform', (n) => `translate(${n.x},${n.y})`);
    // Place labels in free space instead of letting long Chinese titles overlap.
    const occupied = [];
    for (const n of [...nodes].sort((a, b) => b.degree - a.degree)) {
      const labelWidth = [...n.title].reduce((sum, ch) => sum + (ch.codePointAt(0) > 255 ? 11 : 6), 0) + 10;
      const candidates = [27, -20, 44, -38, 61];
      n.labelDy =
        candidates.find((dy) => {
          const box = {
            left: n.x - labelWidth / 2,
            right: n.x + labelWidth / 2,
            top: n.y + dy - 11,
            bottom: n.y + dy + 3,
          };
          if (
            occupied.some(
              (other) =>
                box.left < other.right &&
                box.right > other.left &&
                box.top < other.bottom &&
                box.bottom > other.top,
            )
          )
            return false;
          occupied.push(box);
          return true;
        }) || 27;
    }
    node.select('text').attr('dy', (n) => n.labelDy);
  };
  simulation.tick(160);
  update();
  function fit() {
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x)) - 65,
      maxX = Math.max(...nodes.map((n) => n.x)) + 65;
    const minY = Math.min(...nodes.map((n) => n.y)) - 40,
      maxY = Math.max(...nodes.map((n) => n.y)) + 60;
    const scale = Math.min(1.4, (width - 44) / (maxX - minX), (height - 34) / (maxY - minY));
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(width / 2 - ((minX + maxX) / 2) * scale, height / 2 - ((minY + maxY) / 2) * scale)
        .scale(scale),
    );
  }
  fit();
  node.call(
    d3
      .drag()
      .on('start', (event, n) => {
        if (!event.active) simulation.alphaTarget(0.12).restart();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (event, n) => {
        n.fx = event.x;
        n.fy = event.y;
      })
      .on('end', (event, n) => {
        if (!event.active) simulation.alphaTarget(0);
        n.fx = null;
        n.fy = null;
      }),
  );
  simulation.on('tick', update);
  if (!reduceMotion) simulation.alpha(0.025).restart();
  const observer = new ResizeObserver(() => {
    if (!container.isConnected) return;
    width = container.clientWidth;
    height = container.clientHeight;
    svg.attr('viewBox', [0, 0, width, height]);
    simulation
      .force('x', d3.forceX(width / 2).strength(0.028))
      .force('y', d3.forceY(height / 2).strength(0.075));
    fit();
  });
  observer.observe(container);
  return {
    destroy() {
      observer.disconnect();
      simulation.stop();
      svg.on('.zoom', null).remove();
    },
    zoom(factor) {
      svg.call(zoom.scaleBy, factor);
    },
    reset: fit,
    labels() {
      showLabels = !showLabels;
      node.selectAll('text').attr('visibility', showLabels ? 'visible' : 'hidden');
      return showLabels;
    },
  };
}
