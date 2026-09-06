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
