// Architecture time machine: which parts of the platform exist at a milestone, where they sit and how links route.
// Pure functions shared by the /architecture page and tests/architecture-evolution.test.mjs.

const TYPES = new Set(["milestone", "decision", "incident"]);
const KINDS = new Set(["request", "event", "data"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMilestoneDate(date, { short = false } = {}) {
  const [year, month, day] = String(date).split("-").map(Number);
  const name = MONTHS[month - 1] || "";
  return short ? `${name} ${day}` : `${name} ${day}, ${year}`;
}

function orderOf(data) {
  return new Map(data.milestones.map((milestone, index) => [milestone.id, index]));
}

// `since` is the milestone that adds an item; `until`, if set, the one that retires it.
function statusAt(item, order, index) {
  const since = order.get(item.since);
  const until = item.until === undefined ? Infinity : order.get(item.until);
  if (since === undefined || since > index) return null;
  if (until <= index) return until === index ? "retired" : null;
  return since === index ? "new" : "active";
}

/** Nodes and links visible at milestone `index`, each tagged new / active / retired, plus what the step changed. */
export function evolutionAt(data, index) {
  const order = orderOf(data);
  const nodes = data.nodes
    .map((node) => ({ ...node, status: statusAt(node, order, index) }))
    .filter((node) => node.status);
  const links = data.links
    .map((link, position) => ({ ...link, id: `${link.from}->${link.to}#${position}`, status: statusAt(link, order, index) }))
    .filter((link) => link.status);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const describe = (link) => `${byId.get(link.from)?.label || link.from} → ${byId.get(link.to)?.label || link.to}${link.label ? ` (${link.label})` : ""}`;
  const pick = (items, status) => items.filter((item) => item.status === status);
  const addedNodes = pick(nodes, "new").map((node) => node.label);
  const retiredNodes = pick(nodes, "retired").map((node) => node.label);
  const addedLinks = pick(links, "new").map(describe);
  const retiredLinks = pick(links, "retired").map(describe);
  return {
    milestone: data.milestones[index],
    nodes,
    links,
    addedNodes,
    retiredNodes,
    addedLinks,
    retiredLinks,
    added: [...addedNodes, ...addedLinks],
    retired: [...retiredNodes, ...retiredLinks],
  };
}

/** A milestone's focus: node ids, and links written as "from>to". */
export function focusOf(milestone) {
  const nodes = new Set();
  const links = new Set();
  for (const item of milestone.focus || []) (item.includes(">") ? links : nodes).add(item);
  return { nodes, links };
}

/** Pixel box of every node: bands are rows, slots are columns; a node may span several slots. */
export function evolutionBoxes(data) {
  const { gutter, slot, nodeWidth, nodeHeight, bands } = data.layout;
  const bandY = new Map(bands.map((band) => [band.id, band.y]));
  return new Map(data.nodes.map((node) => {
    const [first, last] = node.slots;
    const left = gutter + first * slot + (slot - nodeWidth) / 2;
    const right = gutter + last * slot + (slot + nodeWidth) / 2;
    const cy = bandY.get(node.band);
    return [node.id, { x: left, y: cy - nodeHeight / 2, w: right - left, h: nodeHeight, cx: (left + right) / 2, cy }];
  }));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const CORNER = 10;
// Half the gap between two bands: an elbow ("corridor") link runs its horizontal leg there.
const LANE = 23;

function cubicPath(start, c1, c2, end) {
  const at = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
    };
  };
  return {
    d: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`,
    points: Array.from({ length: 33 }, (_, i) => at(i / 32)),
  };
}

/** Straight segments with rounded corners; `points` samples every segment for hit tests and labels. */
function elbowPath(corners) {
  const parts = [`M ${round(corners[0].x)} ${round(corners[0].y)}`];
  for (let i = 1; i < corners.length - 1; i += 1) {
    const [prev, at, next] = [corners[i - 1], corners[i], corners[i + 1]];
    const toward = (target) => {
      const length = Math.hypot(target.x - at.x, target.y - at.y) || 1;
      const r = Math.min(CORNER, length / 2);
      return { x: at.x + ((target.x - at.x) / length) * r, y: at.y + ((target.y - at.y) / length) * r };
    };
    const a = toward(prev);
    const b = toward(next);
    parts.push(`L ${round(a.x)} ${round(a.y)} Q ${round(at.x)} ${round(at.y)} ${round(b.x)} ${round(b.y)}`);
  }
  const last = corners[corners.length - 1];
  parts.push(`L ${round(last.x)} ${round(last.y)}`);
  const points = [];
  for (let i = 0; i < corners.length - 1; i += 1) {
    const [a, b] = [corners[i], corners[i + 1]];
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
    for (let s = 0; s < steps; s += 1) points.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
  }
  points.push(last);
  return { d: parts.join(" "), points };
}

/** The point `fraction` of the way along a sampled path, by length. */
export function pointAlong(points, fraction) {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const target = lengths[lengths.length - 1] * fraction;
  const i = Math.max(1, lengths.findIndex((length) => length >= target));
  const span = lengths[i] - lengths[i - 1] || 1;
  const t = (target - lengths[i - 1]) / span;
  return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
}

/**
 * Route one link between two node boxes. `link` may carry:
 * - `route`: "above" / "below" (arc within a band), "corridor" (down, along the gap above the target band, down
 *   again) or "side" (out of the side of the source, along its band, then up or down into the target);
 * - `x`: a straight vertical line at this x (it must fit both boxes);
 * - `ports`: [startX, endX] where a curved or corridor link leaves and enters.
 * Between bands, boxes that overlap horizontally get a straight vertical line at the middle of the overlap;
 * otherwise the link is a cubic Bézier that leaves one edge and enters the next.
 * Returns the SVG path, sampled points and a default label position.
 */
export function linkGeometry(from, to, link = {}) {
  const options = typeof link === "string" ? { route: link } : link || {};
  const { route, ports = [] } = options;
  const right = (box) => box.x + box.w;
  let path;
  if (Math.abs(from.cy - to.cy) < 1) {
    const forward = to.cx > from.cx;
    if (route === "above" || route === "below") {
      const sign = route === "above" ? -1 : 1;
      const edge = (box) => (sign < 0 ? box.y : box.y + box.h);
      const start = { x: ports[0] ?? from.cx + (forward ? 14 : -14), y: edge(from) };
      const end = { x: ports[1] ?? to.cx + (forward ? -14 : 14), y: edge(to) };
      const lift = 34 + Math.min(40, Math.abs(end.x - start.x) * 0.08);
      path = cubicPath(start, { x: start.x, y: start.y + sign * lift }, { x: end.x, y: end.y + sign * lift }, end);
    } else {
      const start = { x: forward ? right(from) : from.x, y: from.cy };
      const end = { x: forward ? to.x : right(to), y: to.cy };
      path = elbowPath([start, end]);
    }
  } else {
    const down = to.cy > from.cy;
    const startY = down ? from.y + from.h : from.y;
    const endY = down ? to.y : to.y + to.h;
    const overlapLeft = Math.max(from.x, to.x);
    const overlapRight = Math.min(right(from), right(to));
    if (route === "side") {
      const forward = to.cx > from.cx;
      const start = { x: forward ? right(from) : from.x, y: from.cy };
      const endX = ports[1] ?? to.cx;
      path = elbowPath([start, { x: endX, y: start.y }, { x: endX, y: endY }]);
    } else if (route === "corridor") {
      const startX = ports[0] ?? from.cx;
      const endX = ports[1] ?? clamp(from.cx, to.x + 18, right(to) - 18);
      const lane = options.lane ?? (down ? endY - LANE : endY + LANE);
      path = elbowPath([{ x: startX, y: startY }, { x: startX, y: lane }, { x: endX, y: lane }, { x: endX, y: endY }]);
    } else if (options.x !== undefined || (ports.length === 0 && overlapRight - overlapLeft >= 24)) {
      const x = options.x ?? (overlapLeft + overlapRight) / 2;
      path = elbowPath([{ x, y: startY }, { x, y: endY }]);
    } else {
      const start = { x: ports[0] ?? clamp(to.cx, from.x + 18, right(from) - 18), y: startY };
      const end = { x: ports[1] ?? clamp(from.cx, to.x + 18, right(to) - 18), y: endY };
      const bend = Math.max(24, Math.abs(end.y - start.y) * 0.45) * (down ? 1 : -1);
      path = cubicPath(start, { x: start.x, y: start.y + bend }, { x: end.x, y: end.y - bend }, end);
    }
  }
  const mid = pointAlong(path.points, 0.5);
  return { d: path.d, points: path.points, label: { x: round(mid.x), y: round(mid.y) } };
}

// Rough advance widths of system-ui at 10.5px bold, enough to keep labels apart without measuring the DOM.
const NARROW = new Set([..."ijlt.,:;'|!·() /f1r"]);
const WIDE = new Set([..."mwMW@%"]);
export function labelWidth(text, size = 10.5) {
  let width = 0;
  for (const char of String(text)) {
    if (NARROW.has(char)) width += 0.33;
    else if (WIDE.has(char)) width += 0.9;
    else if (char >= "A" && char <= "Z") width += 0.68;
    else width += 0.57;
  }
  return width * size;
}

const LABEL_HEIGHT = 14;
const FRACTIONS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];

/** Points every few pixels along a sampled path, so a small label box cannot slip between samples. */
function densify(points, step = 4) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * Greedy label placement: each label (in priority order) takes the first spot along its own path, centred on the
 * line or beside it, that stays inside the canvas and clear of nodes, of labels placed before it and of other
 * links (so a label never sits on a line it does not name). `strict` links are always avoided; `loose` ones only
 * when a spot exists. A label that fits nowhere returns null; the story panel still lists it.
 */
export function placeLabels(items, obstacles, { width, height }, { strict = [], loose = [] } = {}) {
  const taken = obstacles.map((box) => ({ x: box.x - 3, y: box.y - 3, w: box.w + 6, h: box.h + 6 }));
  const dense = (links) => links.map((link) => ({ id: link.id, points: densify(link.points) }));
  const strictPaths = dense(strict);
  const loosePaths = dense(loose);
  const inside = (rect, point) => point.x > rect.x - 1 && point.x < rect.x + rect.w + 1 && point.y > rect.y - 1 && point.y < rect.y + rect.h + 1;
  const crosses = (rect, paths, own) => paths.some((path) => path.id !== own && path.points.some((point) => inside(rect, point)));
  const clear = (rect) => rect.x >= 2 && rect.y >= 2 && rect.x + rect.w <= width - 2 && rect.y + rect.h <= height - 2
    && taken.every((box) => rect.x >= box.x + box.w || box.x >= rect.x + rect.w || rect.y >= box.y + box.h || box.y >= rect.y + rect.h);
  const placed = new Map();
  for (const item of items) {
    const w = labelWidth(item.text) + 8;
    let spot = null;
    for (const avoidLoose of [true, false]) {
      for (const fraction of FRACTIONS) {
        const p = pointAlong(item.points, fraction);
        const options = [
          { anchor: "middle", x: p.x, left: p.x - w / 2 },
          { anchor: "start", x: p.x + 7, left: p.x + 3 },
          { anchor: "end", x: p.x - 7, left: p.x - 3 - w },
        ];
        for (const option of options) {
          const rect = { x: option.left, y: p.y - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT };
          if (clear(rect) && !crosses(rect, strictPaths, item.id) && !(avoidLoose && crosses(rect, loosePaths, item.id))) {
            spot = { x: round(option.x), y: round(p.y + 3.5), anchor: option.anchor, rect };
            break;
          }
        }
        if (spot) break;
      }
      if (spot) break;
    }
    if (spot) taken.push(spot.rect);
    placed.set(item.id, spot);
  }
  return placed;
}

const TAG_WIDTH = 24;

/** Put a node's NEW tag at the first corner, outside the box, where no link attaches. */
function newTagSpot(box, id, links) {
  const ends = [];
  for (const link of links) {
    const points = link.geometry.points;
    if (link.from === id) ends.push(points[0]);
    if (link.to === id) ends.push(points[points.length - 1]);
  }
  const top = box.y;
  const bottom = box.y + box.h;
  const right = box.x + box.w;
  const corners = [
    { side: top, x: right - 6, anchor: "end", left: right - 6 - TAG_WIDTH, y: top - 5 },
    { side: top, x: box.x + 8, anchor: "start", left: box.x + 8, y: top - 5 },
    { side: bottom, x: right - 6, anchor: "end", left: right - 6 - TAG_WIDTH, y: bottom + 12 },
    { side: bottom, x: box.x + 8, anchor: "start", left: box.x + 8, y: bottom + 12 },
  ];
  const free = corners.find((corner) => !ends.some((point) => Math.abs(point.y - corner.side) < 2
    && point.x > corner.left - 9 && point.x < corner.left + TAG_WIDTH + 9));
  const spot = free || corners[0];
  return { x: spot.x, y: spot.y, anchor: spot.anchor, rect: { x: spot.left, y: spot.y - 9, w: TAG_WIDTH, h: 11 } };
}

/**
 * Everything the diagram draws at one step: each link gets a role (new, focus, active or retired), its route and,
 * if it fits, a label; new nodes get a NEW tag. Links that did not change are drawn faint by the page, so the ones
 * that changed carry the step.
 */
export function evolutionScene(data, index, boxes = evolutionBoxes(data)) {
  const state = evolutionAt(data, index);
  const focus = focusOf(state.milestone);
  const fresh = new Set(state.links.filter((link) => link.status === "new").map((link) => `${link.from}>${link.to}`));
  const links = state.links
    // A link retired in the same step that a new one takes its place is not drawn twice.
    .filter((link) => !(link.status === "retired" && fresh.has(`${link.from}>${link.to}`)))
    .map((link) => {
      const role = link.status === "active" && focus.links.has(`${link.from}>${link.to}`) ? "focus" : link.status;
      return { ...link, role, geometry: linkGeometry(boxes.get(link.from), boxes.get(link.to), link) };
    });
  // Retired links are dashed and listed in the story panel; only new and focused links carry labels.
  const priority = { new: 0, focus: 1 };
  const labelled = links
    .filter((link) => link.label && link.role in priority)
    .sort((a, b) => priority[a.role] - priority[b.role]);
  const obstacles = state.nodes.map((node) => boxes.get(node.id));
  const tags = new Map();
  for (const node of state.nodes.filter((item) => item.status === "new")) {
    const tag = newTagSpot(boxes.get(node.id), node.id, links);
    tags.set(node.id, tag);
    obstacles.push(tag.rect);
  }
  const path = (link) => ({ id: link.id, points: link.geometry.points });
  const labels = placeLabels(
    labelled.map((link) => ({ ...path(link), text: link.label })),
    obstacles,
    data.layout,
    {
      strict: links.filter((link) => link.role !== "active").map(path),
      loose: links.filter((link) => link.role === "active").map(path),
    },
  );
  const touched = new Set();
  for (const link of links.filter((item) => item.role === "new" || item.role === "focus")) {
    touched.add(link.from);
    touched.add(link.to);
  }
  return { state, focus, links, labels, tags, touched };
}

// An article opts into the time machine with a figure that links to one step of the live view, e.g.
//   <figure class="time-machine">
//     <a href="https://www.yuqi.site/architecture#evolution/outbox"><img src="…/diagrams/time-machine/outbox.svg" alt="…"></a>
//     <figcaption><strong>Title</strong> Introduction…</figcaption>
//   </figure>
// Pages that render articles replace such figures with the interactive view; anywhere else the image and link remain.
const STEP_LINK = /\/architecture#evolution\/([a-z0-9-]+)/i;
const TIME_MACHINE_FIGURE = /<figure\b[^>]*\bclass="[^"]*\btime-machine\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi;
const collapse = (text) => String(text || "").replace(/\s+/g, " ").trim();

/** The steps an article's time machine figures open at, in order; links to unknown steps are ignored. */
export function timeMachineSteps(html, data) {
  const known = new Set(data.milestones.map((milestone) => milestone.id));
  const steps = [];
  for (const match of String(html || "").matchAll(TIME_MACHINE_FIGURE)) {
    const step = match[1].match(STEP_LINK)?.[1];
    if (step && known.has(step)) steps.push(step);
  }
  return steps;
}

/**
 * Read one time machine figure: the step from its link, the heading from its caption (the bold lead is the
 * title, the rest of the caption the introduction). Returns null when the link does not name a known step.
 */
export function readTimeMachineFigure({ href, lead, caption }, data) {
  const step = String(href || "").match(STEP_LINK)?.[1];
  if (!step || !data.milestones.some((milestone) => milestone.id === step)) return null;
  const title = collapse(lead).replace(/[.:]$/, "");
  let intro = collapse(caption);
  if (title && intro.startsWith(collapse(lead))) intro = intro.slice(collapse(lead).length).trim();
  return { step, heading: { title: title || undefined, intro: intro || undefined } };
}

/** Consistency checks for the data file; returns a list of problems (empty when valid). */
export function validateEvolution(data) {
  const problems = [];
  const order = new Map();
  let previousDate = "";
  data.milestones.forEach((milestone, index) => {
    const where = `milestone "${milestone.id}"`;
    if (order.has(milestone.id)) problems.push(`${where} is duplicated`);
    order.set(milestone.id, index);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(milestone.date)) problems.push(`${where} needs a YYYY-MM-DD date`);
    if (milestone.date < previousDate) problems.push(`${where} is out of date order`);
    previousDate = milestone.date;
    if (!TYPES.has(milestone.type)) problems.push(`${where} has unknown type "${milestone.type}"`);
    for (const field of ["phase", "title", "summary"]) {
      if (!String(milestone[field] || "").trim()) problems.push(`${where} needs a ${field}`);
    }
    if (!milestone.sections?.length) problems.push(`${where} needs at least one section`);
    if (!milestone.evidence?.length) problems.push(`${where} needs evidence`);
    for (const item of milestone.evidence || []) {
      if (!item.repo || !/^[0-9a-f]{7,40}$/.test(item.sha || "") || !item.text) problems.push(`${where} has incomplete evidence`);
    }
  });

  const bands = new Map(data.layout.bands.map((band) => [band.id, band]));
  const slotsPerRow = Math.floor((data.layout.width - data.layout.gutter) / data.layout.slot);
  const span = (item) => {
    const since = order.get(item.since);
    const until = item.until === undefined ? data.milestones.length : order.get(item.until);
    return { since, until };
  };
  const nodes = new Map();
  for (const node of data.nodes) {
    const where = `node "${node.id}"`;
    if (nodes.has(node.id)) problems.push(`${where} is duplicated`);
    nodes.set(node.id, node);
    if (!bands.has(node.band)) problems.push(`${where} sits in unknown band "${node.band}"`);
    const [first, last] = node.slots || [];
    // Slots are columns; a half slot lets a wide node stop short of the next column.
    const valid = (value) => Number.isInteger(value * 2) && value >= 0 && value < slotsPerRow;
    if (!(valid(first) && valid(last) && first <= last)) problems.push(`${where} has invalid slots`);
    const { since, until } = span(node);
    if (since === undefined) problems.push(`${where} names unknown milestone "${node.since}"`);
    if (until === undefined || (since !== undefined && until <= since)) problems.push(`${where} must be retired after it appears`);
  }
  // Two nodes may share a band and slot only if they never exist at the same time.
  const all = [...nodes.values()];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.band !== b.band) continue;
      const overlapSlots = a.slots[0] <= b.slots[1] && b.slots[0] <= a.slots[1];
      const sa = span(a);
      const sb = span(b);
      const overlapTime = sa.since < sb.until && sb.since < sa.until;
      if (overlapSlots && overlapTime) problems.push(`nodes "${a.id}" and "${b.id}" overlap in band "${a.band}"`);
    }
  }
  data.links.forEach((link) => {
    const where = `link ${link.from} -> ${link.to}`;
    if (!KINDS.has(link.kind)) problems.push(`${where} has unknown kind "${link.kind}"`);
    const from = nodes.get(link.from);
    const to = nodes.get(link.to);
    if (!from || !to) {
      problems.push(`${where} references an unknown node`);
      return;
    }
    const { since, until } = span(link);
    if (since === undefined || until === undefined || until <= since) {
      problems.push(`${where} has an invalid since/until`);
      return;
    }
    for (const node of [from, to]) {
      const life = span(node);
      if (since < life.since || until > life.until) problems.push(`${where} outlives node "${node.id}"`);
    }
  });
  const boxes = evolutionBoxes(data);
  data.links.forEach((link) => {
    const from = boxes.get(link.from);
    const to = boxes.get(link.to);
    if (!from || !to) return;
    const within = (x, box) => x >= box.x + 6 && x <= box.x + box.w - 6;
    if (link.x !== undefined && !(within(link.x, from) && within(link.x, to))) problems.push(`link ${link.from} -> ${link.to}: x ${link.x} is outside a node`);
    const [startX, endX] = link.ports || [];
    if ((startX !== undefined && startX !== null && !within(startX, from)) || (endX !== undefined && endX !== null && !within(endX, to))) {
      problems.push(`link ${link.from} -> ${link.to}: a port is outside its node`);
    }
  });
  data.milestones.forEach((milestone, index) => {
    const state = evolutionAt(data, index);
    const live = new Set(state.nodes.map((node) => node.id));
    const liveLinks = new Set(state.links.map((link) => `${link.from}>${link.to}`));
    const focus = focusOf(milestone);
    for (const id of focus.nodes) {
      if (!live.has(id)) problems.push(`milestone "${milestone.id}" focuses on "${id}", which is not on the diagram then`);
    }
    for (const id of focus.links) {
      if (!liveLinks.has(id)) problems.push(`milestone "${milestone.id}" focuses on link "${id}", which is not on the diagram then`);
    }
  });
  return problems;
}
