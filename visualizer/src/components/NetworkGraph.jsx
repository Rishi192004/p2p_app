/**
 * NetworkGraph.jsx
 * D3-powered SVG network visualisation.
 * Renders nodes, edges, animates active transmissions, shows failure state.
 */

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

const WIDTH = 680;
const HEIGHT = 520;
const NODE_R = 28;

// Color palette
const COLORS = {
  nodeFill: '#1e2a3a',
  nodeStroke: '#3b82f6',
  nodeLit: '#f59e0b',
  nodeDead: '#ef4444',
  nodeDeadFill: '#2d1515',
  edgeNormal: '#2d4a6e',
  edgeActive: '#60a5fa',
  edgeNew: '#34d399',
  labelColor: '#e2e8f0',
  labelDead: '#6b7280',
  bgGrid: '#0f1923',
};

export default function NetworkGraph({ nodes, edges, deadNodes, activeEdge, litNodes }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    // ── Glow filter for lit nodes ────────────────────────────────────────────
    const glow = defs.append('filter').attr('id', 'glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
    const feMerge = glow.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Pulse filter for dead nodes
    const redGlow = defs.append('filter').attr('id', 'redglow');
    redGlow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const rfm = redGlow.append('feMerge');
    rfm.append('feMergeNode').attr('in', 'coloredBlur');
    rfm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Arrow marker for directed animation hint
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', NODE_R + 12)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', COLORS.edgeActive);

    // ── Background grid ──────────────────────────────────────────────────────
    const grid = svg.append('g').attr('class', 'grid');
    for (let x = 0; x <= WIDTH; x += 40) {
      grid.append('line')
        .attr('x1', x).attr('y1', 0).attr('x2', x).attr('y2', HEIGHT)
        .attr('stroke', '#ffffff08').attr('stroke-width', 1);
    }
    for (let y = 0; y <= HEIGHT; y += 40) {
      grid.append('line')
        .attr('x1', 0).attr('y1', y).attr('x2', WIDTH).attr('y2', y)
        .attr('stroke', '#ffffff08').attr('stroke-width', 1);
    }

    // ── Build node position lookup ───────────────────────────────────────────
    const nodePos = {};
    for (const n of nodes) nodePos[n.id] = { x: n.x, y: n.y };

    // ── Edges ────────────────────────────────────────────────────────────────
    const edgeGroup = svg.append('g').attr('class', 'edges');

    for (const e of edges) {
      const src = nodePos[e.source];
      const tgt = nodePos[e.target];
      if (!src || !tgt) continue;

      const isDead = deadNodes.has(e.source) || deadNodes.has(e.target);
      const isActive =
        activeEdge &&
        ((activeEdge.source === e.source && activeEdge.target === e.target) ||
          (activeEdge.source === e.target && activeEdge.target === e.source));
      const isNew = e.isNew;

      const line = edgeGroup.append('line')
        .attr('x1', src.x).attr('y1', src.y)
        .attr('x2', tgt.x).attr('y2', tgt.y)
        .attr('stroke', isDead ? '#1a1a2e' : isNew ? COLORS.edgeNew : isActive ? COLORS.edgeActive : COLORS.edgeNormal)
        .attr('stroke-width', isActive ? 3 : isNew ? 2 : 1.5)
        .attr('stroke-dasharray', isDead ? '4 4' : isNew ? '6 3' : 'none')
        .attr('opacity', isDead ? 0.3 : isActive ? 1 : 0.7);

      // Animate active edge with a travelling dash
      if (isActive) {
        line.attr('stroke-dasharray', '8 4')
          .attr('stroke-dashoffset', 0);

        // Animate the packet moving along the edge
        edgeGroup.append('circle')
          .attr('r', 5)
          .attr('fill', '#60a5fa')
          .attr('filter', 'url(#glow)')
          .append('animateMotion')
          .attr('dur', '0.4s')
          .attr('repeatCount', '1')
          .attr('path', `M${src.x},${src.y} L${tgt.x},${tgt.y}`);
      }
    }

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeGroup = svg.append('g').attr('class', 'nodes');

    for (const n of nodes) {
      const isDead = deadNodes.has(n.id);
      const isLit = litNodes.has(n.id);
      const g = nodeGroup.append('g')
        .attr('transform', `translate(${n.x}, ${n.y})`);

      // Outer glow ring when lit
      if (isLit && !isDead) {
        g.append('circle')
          .attr('r', NODE_R + 8)
          .attr('fill', 'none')
          .attr('stroke', COLORS.nodeLit)
          .attr('stroke-width', 2)
          .attr('opacity', 0.4);
      }

      // Main circle
      g.append('circle')
        .attr('r', NODE_R)
        .attr('fill', isDead ? COLORS.nodeDeadFill : isLit ? '#1e3a5f' : COLORS.nodeFill)
        .attr('stroke', isDead ? COLORS.nodeDead : isLit ? COLORS.nodeLit : COLORS.nodeStroke)
        .attr('stroke-width', isDead ? 2 : isLit ? 3 : 2)
        .attr('filter', isDead ? 'url(#redglow)' : isLit ? 'url(#glow)' : 'none');

      // Node letter label
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('y', -4)
        .attr('font-size', '18px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'Inter, sans-serif')
        .attr('fill', isDead ? COLORS.labelDead : isLit ? COLORS.nodeLit : COLORS.labelColor)
        .text(n.id);

      // Node subtitle
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('y', 12)
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, sans-serif')
        .attr('fill', isDead ? '#4b5563' : '#64748b')
        .text(isDead ? 'DEAD' : 'ACTIVE');

      // Dead X overlay
      if (isDead) {
        g.append('line')
          .attr('x1', -12).attr('y1', -12).attr('x2', 12).attr('y2', 12)
          .attr('stroke', COLORS.nodeDead).attr('stroke-width', 2.5);
        g.append('line')
          .attr('x1', 12).attr('y1', -12).attr('x2', -12).attr('y2', 12)
          .attr('stroke', COLORS.nodeDead).attr('stroke-width', 2.5);
      }
    }
  }, [nodes, edges, deadNodes, activeEdge, litNodes]);

  return (
    <div className="graph-container">
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ background: COLORS.bgGrid, borderRadius: '12px' }}
      />
    </div>
  );
}
