import test from 'node:test'
import assert from 'node:assert/strict'
import { tourNarrative } from '../src/lib/tourNarrative.mjs'
import { tourPetDimensions } from '../src/lib/tourScene.mjs'

test('pet dimensions scale up without exceeding narrow or short viewports', () => {
    assert.equal(tourPetDimensions(1366).width, 144)
    assert.equal(tourPetDimensions(390, 844).width, 104)
    assert.equal(tourPetDimensions(320, 568).width, 88)
    assert.equal(tourPetDimensions(844, 390).height, 104)
    for (const width of [320, 390, 640, 1366]) {
        const pet = tourPetDimensions(width)
        assert.ok(pet.width + 2 * pet.margin < width)
    }
})

test('each editorial chapter has a distinct story and grounded follow-up', () => {
    const ids = ['hero', 'about', 'background', 'projects', 'techblogs', 'life', 'realtime', 'contact']
    const stories = ids.map(id => tourNarrative({ id, editorial: true }))
    assert.equal(new Set(stories.map(story => story.title)).size, ids.length)
    for (const story of stories) {
        assert.ok(story.line.length > 30)
        assert.ok(story.question.length > 20)
        assert.ok(['mint', 'peach', 'lavender'].includes(story.tone))
    }
})

test('Chinese chapters are localized without changing evidence boundaries', () => {
    const story = tourNarrative({ id: 'life', editorial: true }, 'zh')
    assert.match(story.title, /编辑器/)
    assert.match(story.question, /公开可访问/)
})

test('dynamic and unknown chapters retain their own content', () => {
    for (const id of ['projects', 'custom']) {
        const step = { id, title: 'Custom focus', content: 'Only this supplied story.' }
        assert.deepEqual(tourNarrative(step), { title: step.title, line: step.content, question: '', tone: 'mint' })
    }
})

test('every editorial chapter has recorded narration that says exactly what the dock shows', async () => {
    const { readFileSync, statSync } = await import('node:fs')
    const { NARRATION_VERSION, narrationAudio, narrationScript, narrationText } = await import('../src/lib/tourNarrative.mjs')
    const root = new URL('../public', import.meta.url)
    const manifest = JSON.parse(readFileSync(new URL(`../public/assets/audio/tour/${NARRATION_VERSION}/manifest.json`, import.meta.url), 'utf8'))
    assert.equal(manifest.version, NARRATION_VERSION)
    const script = narrationScript()
    for (const language of ['en', 'zh']) {
        for (const [id, text] of Object.entries(script[language])) {
            const step = { id, editorial: true }
            assert.equal(text, narrationText(step, language))
            const story = tourNarrative(step, language)
            assert.ok(text.startsWith(story.title) && text.endsWith(story.line), `${language}/${id} reads the dock copy`)
            // A stale recording: the copy changed but the audio was not re-recorded.
            assert.equal(manifest.chapters[language]?.[id]?.text, text, `${language}/${id}.mp3 is out of date; run scripts/generate-tour-narration.py`)
            const src = narrationAudio(step, language)
            assert.equal(src, `/assets/audio/tour/${NARRATION_VERSION}/${language}/${id}.mp3`)
            assert.ok(statSync(new URL(`.${src}`, `${root.href}/`)).size > 10_000, `${src} exists`)
        }
    }
})

test('AI-generated steps have no recording and are read in their own words', async () => {
    const { narrationAudio, narrationText, readingTime } = await import('../src/lib/tourNarrative.mjs')
    const step = { id: 'projects', title: 'Custom focus', content: 'Only this supplied story.' }
    assert.equal(narrationAudio(step, 'en'), null)
    assert.equal(narrationText(step, 'en'), 'Custom focus. Only this supplied story.')
    assert.ok(readingTime(step, 'en') >= 6500)
    const long = { ...step, content: 'A much longer story. '.repeat(20) }
    assert.ok(readingTime(long, 'en') > readingTime(step, 'en'))
})

test('the Chinese tour localizes chapter titles, notes and links, and nothing else', async () => {
    const { localizeTourStep } = await import('../src/lib/tourNarrative.mjs')
    const step = { id: 'background', editorial: true, title: 'My Background', meta: 'Experience', action: { href: '/cv', label: 'View CV' } }
    const zh = localizeTourStep(step, 'zh')
    assert.equal(zh.title, '我的经历')
    assert.deepEqual(zh.action, { href: '/cv', label: '查看简历' })
    assert.equal(zh.targetId, step.targetId)
    assert.equal(localizeTourStep(step, 'en'), step)
    const dynamic = { id: 'background', title: 'AI plan' }
    assert.equal(localizeTourStep(dynamic, 'zh'), dynamic)
})
