// Only presentation fields travel with recommendation cards, not the full subsystem document.
export function projectCoverData(system) {
  const config = system?.diagram_config;
  if (!config || !Array.isArray(config.nodes) || !Array.isArray(config.edges) || !Array.isArray(config.domains)) return null;
  const label = value => typeof value === 'string' ? value.slice(0, 160) : '';
  const position = value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  const nodes = config.nodes.slice(0, 10).filter(node => node && label(node.id) && position(node.x) && position(node.y))
    .map(node => ({ id: label(node.id), code: label(node.code), label: label(node.label), title: label(node.title),
      x: Number(node.x), y: Number(node.y), shape: label(node.shape), tone: label(node.tone) }));
  const ids = new Set(nodes.map(node => node.id));
  const edges = config.edges.slice(0, 30).filter(edge => edge && ids.has(edge.from) && ids.has(edge.to))
    .map(edge => ({ from: edge.from, to: edge.to, kind: label(edge.kind) }));
  const domains = config.domains.slice(0, 8).filter(zone => zone && position(zone.x) && position(zone.width))
    .map(zone => ({ label: label(zone.label), x: Number(zone.x), width: Number(zone.width) }));
  const result = { title: label(system.title), eyebrow: label(system.eyebrow), diagram_config: {
    coverTheme: label(config.coverTheme), coverLayout: label(config.coverLayout), coverStatus: label(config.coverStatus),
    coverMotif: label(config.coverMotif), nodes, edges, domains,
  } };
  return nodes.length >= 2 && edges.length && domains.length &&
    [result.title, result.eyebrow, result.diagram_config.coverTheme, result.diagram_config.coverLayout,
      result.diagram_config.coverStatus, result.diagram_config.coverMotif].every(value => value.trim()) ? result : null;
}
