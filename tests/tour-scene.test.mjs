import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { frameTourTarget, collectTourDiscoveries } from '../src/lib/tourScene.mjs'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('scene framing keeps target above the dock and within a mobile viewport', () => {
    const frame = frameTourTarget({ left: -30, top: 70, width: 600, height: 2000 }, 390, 844, 550)
    assert.equal(frame.left, 12)
    assert.equal(frame.width, 366)
    assert.equal(frame.top, 96)
    assert.equal(frame.top + frame.height, 534)
})

test('offscreen or absent targets do not create a negative highlight', () => {
    assert.equal(frameTourTarget(null, 390, 844, 550), null)
    assert.equal(frameTourTarget({ left: 20, top: -1000, width: 100, height: 100 }, 390, 844, 550), null)
    assert.equal(frameTourTarget({ left: 20, top: 800, width: 100, height: 100 }, 390, 844, 550), null)
})

test('discoveries use real public content links and omit external and hidden clones', () => {
    const dom = new JSDOM(`<section>
        <a href="/work-single/one"><h3>Real project</h3><p>Actual excerpt.</p></a>
        <a href="/work-single/one"><h3>Duplicate</h3></a>
        <a href="https://other.test/work-single/foreign"><h3>External</h3></a>
        <div aria-hidden="true"><a href="/blog-single/hidden"><h3>Hidden slide</h3></a></div>
        <a href="javascript:alert(1)"><h3>Unsafe</h3></a>
        <article class="archive-item"><a href="/blog-single/two"><img alt="Second" src="/photo.png"></a><h3>Second article</h3><p>Article description.</p></article>
    </section>`, { url: 'https://www.yuqi.site/' })
    const results = collectTourDiscoveries(dom.window.document.querySelector('section'), 'https://www.yuqi.site')
    assert.deepEqual(results.map(({ title, href }) => ({ title, href })), [
        { title: 'Real project', href: '/work-single/one' },
        { title: 'Second article', href: '/blog-single/two' },
    ])
    assert.equal(results[1].excerpt, 'Article description.')
    dom.window.close()
})
