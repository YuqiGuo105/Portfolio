import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
    evolutionAt,
    evolutionBoxes,
    readTimeMachineFigure,
    evolutionScene,
    formatMilestoneDate,
    labelWidth,
    linkGeometry,
    placeLabels,
    timeMachineSteps,
    validateEvolution,
} from '../src/lib/architectureEvolution.mjs'
import { sanitize } from '../src/lib/sanitizeHtml.js'

const data = JSON.parse(readFileSync(new URL('../docs/architecture/platform-evolution.json', import.meta.url), 'utf8'))
const index = (id) => data.milestones.findIndex((milestone) => milestone.id === id)
const boxes = evolutionBoxes(data)
const inside = (point, box, margin = 1) => point.x > box.x + margin && point.x < box.x + box.w - margin
    && point.y > box.y + margin && point.y < box.y + box.h - margin
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('the time machine data is internally consistent', () => {
    assert.deepEqual(validateEvolution(data), [])
})

test('the platform starts as a monolith and grows into services, Kafka and an outbox', () => {
    const start = evolutionAt(data, 0)
    assert.deepEqual(start.nodes.map((node) => node.id).sort(), ['next', 'postgres', 'visitors'])
    assert.ok(start.nodes.every((node) => node.status === 'new'))

    const services = evolutionAt(data, index('services'))
    assert.ok(services.nodes.some((node) => node.id === 'kafka' && node.status === 'new'))
    assert.ok(services.links.some((link) => link.from === 'content' && link.to === 'kafka' && link.label === 'after commit'))

    const outbox = evolutionAt(data, index('outbox'))
    assert.ok(outbox.links.some((link) => link.from === 'postgres' && link.to === 'kafka' && link.status === 'new'))
    assert.ok(outbox.addedLinks.some((text) => text.startsWith('PostgreSQL → Kafka (outbox relay')))
})

test('retired parts show as retired once, then disappear', () => {
    const at = index('agent-outbox')
    const retiring = evolutionAt(data, at)
    assert.ok(retiring.nodes.some((node) => node.id === 'assistant' && node.status === 'retired'))
    assert.ok(retiring.retiredNodes.includes('Assistant API'))
    assert.ok(!evolutionAt(data, at + 1).nodes.some((node) => node.id === 'assistant'))

    const shadow = (state) => state.links.find((link) => link.label === 'shadow produce')
    assert.equal(shadow(evolutionAt(data, index('dual-write'))).status, 'new')
    assert.equal(shadow(evolutionAt(data, index('kafka-primary'))).status, 'retired')
    assert.equal(shadow(evolutionAt(data, index('cpu-throttle'))), undefined)
})

test('a link replaced in the same step is drawn once, as the new link', () => {
    const scene = evolutionScene(data, index('kafka-primary'))
    const toKafka = scene.links.filter((link) => link.from === 'next' && link.to === 'kafka')
    assert.deepEqual(toKafka.map((link) => [link.label, link.role]), [['/api/track', 'new']])
})

test('incidents are recorded with their cause and fix, and light up the link that failed', () => {
    const incidents = data.milestones.filter((milestone) => milestone.type === 'incident')
    assert.ok(incidents.length >= 2)
    for (const incident of incidents) {
        const labels = incident.sections.map((section) => section.label)
        assert.ok(labels.includes('Cause') && labels.includes('Fix'), incident.id)
        const scene = evolutionScene(data, index(incident.id))
        assert.ok(scene.links.some((link) => link.role === 'focus'), `${incident.id} highlights a link`)
    }
})

test('node boxes stay inside the canvas', () => {
    for (const box of boxes.values()) {
        assert.ok(box.x >= data.layout.gutter - 1 && box.x + box.w <= data.layout.width, JSON.stringify(box))
        assert.ok(box.y >= 0 && box.y + box.h <= data.layout.height)
    }
})

test('links route between edges: straight when boxes overlap, elbows and arcs otherwise', () => {
    const content = boxes.get('content')
    const postgres = boxes.get('postgres')
    // Boxes that overlap horizontally get one vertical line in the middle of the overlap.
    const down = linkGeometry(content, postgres)
    assert.equal(down.d, `M ${content.cx} ${content.y + content.h} L ${content.cx} ${postgres.y}`)

    // A corridor runs along the gap above the target band and enters the target from above.
    const corridor = linkGeometry(boxes.get('analytics'), postgres, { route: 'corridor' })
    const lane = postgres.y - 23
    assert.ok(corridor.points.some((point) => Math.abs(point.y - lane) < 0.5 && point.x < boxes.get('analytics').x))
    assert.equal(corridor.points.at(-1).y, postgres.y)

    // A side route leaves the side of the source box.
    const kafka = boxes.get('kafka')
    const side = linkGeometry(kafka, boxes.get('indexers'), { route: 'side' })
    assert.deepEqual(side.points[0], { x: kafka.x + kafka.w, y: kafka.cy })

    // Arcs within a band bow above or below the boxes.
    const arc = linkGeometry(boxes.get('analytics'), boxes.get('notify'), 'above')
    assert.ok(arc.label.y < boxes.get('notify').y)
})

test('at every step, no link passes through a node it does not connect', () => {
    data.milestones.forEach((milestone, step) => {
        const scene = evolutionScene(data, step)
        const live = scene.state.nodes.filter((node) => node.status !== 'retired')
        for (const link of scene.links) {
            for (const node of live) {
                if (node.id === link.from || node.id === link.to) continue
                const box = boxes.get(node.id)
                assert.ok(!link.geometry.points.some((point) => inside(point, box)), `${milestone.id}: ${link.from} -> ${link.to} crosses ${node.id}`)
            }
        }
    })
})

test('at every step, link labels fit and stay clear of nodes, tags and each other', () => {
    data.milestones.forEach((milestone, step) => {
        const scene = evolutionScene(data, step)
        const placed = [...scene.labels.values()].filter(Boolean).map((spot) => spot.rect)
        const nodes = scene.state.nodes.map((node) => boxes.get(node.id))
        const tags = [...scene.tags.values()].map((tag) => tag.rect)
        for (const [i, rect] of placed.entries()) {
            assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= data.layout.width && rect.y + rect.h <= data.layout.height)
            for (const other of [...nodes, ...tags, ...placed.slice(i + 1)]) assert.ok(!overlaps(rect, other), `${milestone.id}: label overlaps`)
        }
        const fresh = scene.links.filter((link) => link.role === 'new' && link.label)
        assert.ok(fresh.every((link) => scene.labels.get(link.id)), `${milestone.id}: every new link is labelled`)
    })
})

test('label placement falls back to the side of a line, or gives up', () => {
    const line = { id: 'a', text: 'label', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }
    const blocker = { x: 20, y: 0, w: 25, h: 100 }
    const spot = placeLabels([line], [blocker], { width: 200, height: 100 }).get('a')
    assert.equal(spot.anchor, 'start')
    assert.equal(placeLabels([line], [{ x: 0, y: 0, w: 200, h: 100 }], { width: 200, height: 100 }).get('a'), null)
    assert.ok(labelWidth('Writer API · JWT') > labelWidth('chat'))
})

test('milestone dates format for the timeline', () => {
    assert.equal(formatMilestoneDate('2026-07-01'), 'Jul 1, 2026')
    assert.equal(formatMilestoneDate('2024-01-30', { short: true }), 'Jan 30')
})

test('articles opt into the time machine with a figure that links to a step', () => {
    const figure = (step, extra = '') => `<figure class="time-machine${extra}"><a href="https://www.yuqi.site/architecture#evolution/${step}"><img src="https://www.yuqi.site/diagrams/time-machine/${step}.svg" alt="Step"></a><figcaption><strong>How publishing stopped losing events.</strong> Opens at the outbox &amp; relays.</figcaption></figure>`
    const article = `<article><h2>Design</h2>${figure('outbox')}<p>Text</p>${figure('fencing', ' wide')}${figure('nope')}<figure class="other"><a href="/architecture#evolution/flyway">x</a></figure></article>`
    // What the project page reads is the sanitized article, so the markup has to survive the sanitizer.
    const clean = sanitize(article)
    assert.deepEqual(timeMachineSteps(clean, data), ['outbox', 'fencing'])
    assert.deepEqual(timeMachineSteps('<p>No figure</p>', data), [])
    assert.match(clean, /<figure class="time-machine"><a href="https:\/\/www\.yuqi\.site\/architecture#evolution\/outbox"><img src="https:\/\/www\.yuqi\.site\/diagrams\/time-machine\/outbox\.svg"/)

    const read = readTimeMachineFigure({
        href: 'https://www.yuqi.site/architecture#evolution/outbox',
        lead: 'How publishing stopped losing events.',
        caption: '  How publishing stopped losing events.   Opens at the outbox & relays. ',
    }, data)
    assert.deepEqual(read, { step: 'outbox', heading: { title: 'How publishing stopped losing events', intro: 'Opens at the outbox & relays.' } })
    assert.deepEqual(readTimeMachineFigure({ href: '/architecture#evolution/monolith' }, data), { step: 'monolith', heading: { title: undefined, intro: undefined } })
    assert.equal(readTimeMachineFigure({ href: '/architecture#evolution/nope', lead: 'x' }, data), null)
    assert.equal(readTimeMachineFigure({ href: undefined }, data), null)
})

test('which article shows which step lives in the article, not in the page or the data file', () => {
    assert.equal(data.projects, undefined)
    assert.ok(data.milestones.some((item) => item.id === data.featured), 'the README step exists')
    const page = readFileSync(new URL('../pages/work-single/[id].js', import.meta.url), 'utf8')
    assert.match(page, /evolution: timeMachineSteps\(content, evolutionData\)\.length \? evolutionData : null/)
    assert.match(page, /querySelectorAll\("figure\.time-machine"\)/)
    assert.match(page, /dynamic\(\(\) => import\("\.\.\/\.\.\/src\/components\/ArchitectureTimeMachine"\)\)/)
    assert.doesNotMatch(page, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no project ids in the page')
    // Every step has a static image for the figure to show where the interactive view is not available.
    for (const milestone of data.milestones) {
        assert.ok(existsSync(new URL(`../public/diagrams/time-machine/${milestone.id}.svg`, import.meta.url)), milestone.id)
    }
})
