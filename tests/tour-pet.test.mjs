import test from 'node:test'
import assert from 'node:assert/strict'
import { createTourPetRig, planPetMove, PET_GESTURES, PET_REST, PET_SPEAKING_MOUTH, PET_SPRINGS } from '../src/lib/tourPetRig.mjs'
import { petFigure, petMouth, petWisp, PET_EYES } from '../src/lib/tourPetDrawing.mjs'
import { placeTourPet, tourPetDimensions, tourPetGround } from '../src/lib/tourScene.mjs'

const FRAME = 1 / 60
// A fixed sequence, so every run moves the same way.
function seeded(seed = 7) {
    let value = seed
    return () => (value = (value * 16807) % 2147483647) / 2147483647
}
function rigAt(point = { x: 100, y: 400 }, options = {}) {
    const rig = createTourPetRig({ random: seeded(), width: 100, ...options })
    rig.place(point)
    return rig
}
function run(rig, seconds, each) {
    let pose
    for (let i = 0; i < Math.round(seconds / FRAME); i++) { pose = rig.step(FRAME); each?.(pose, i) }
    return pose
}
const near = (actual, expected, margin, message) => assert.ok(Math.abs(actual - expected) <= margin, `${message || 'value'}: ${actual} is not within ${margin} of ${expected}`)

test('a short way on the level is walked, anything further or steeper is jumped', () => {
    assert.equal(planPetMove(120, 0, 100).kind, 'walk')
    assert.equal(planPetMove(-200, 20, 100).kind, 'walk')
    assert.equal(planPetMove(300, 0, 100).kind, 'hop')
    assert.equal(planPetMove(40, -120, 100).kind, 'hop')
    const near = planPetMove(0, 120, 100), far = planPetMove(600, -300, 100)
    assert.ok(far.duration > near.duration && far.height > near.height, 'a longer jump is higher and takes longer')
    assert.ok(far.duration <= 0.86 && far.height <= 95, 'even across the screen a jump stays quick and on screen')
})

test('he walks in step with the ground and stops on the spot', () => {
    const rig = rigAt()
    rig.travel({ x: 250, y: 400 })
    assert.equal(rig.shown, 'walk')
    let swings = 0, last = 0, highest = 0, facedForward = true
    const end = run(rig, 2, pose => {
        const side = Math.sign(Math.round(pose.legL - pose.legR))
        if (pose.moving && side && side !== last) { swings++; last = side }
        highest = Math.max(highest, pose.air)
        if (pose.moving && pose.turn < 0.9) facedForward = false
    })
    assert.equal(highest, 0, 'a walk never leaves the ground')
    // 150 px at a third of a body width per step is four or five steps.
    assert.ok(swings >= 3 && swings <= 6, `the legs alternate with the distance covered, got ${swings} swings`)
    assert.ok(facedForward, 'he faces the way he walks')
    near(end.x, 250, 0.01, 'x'); near(end.y, 400, 0.01, 'y')
    assert.equal(end.moving, false)
    near(end.legL, 0, 0.5, 'left leg at rest'); near(end.legR, 0, 0.5, 'right leg at rest')
})

test('a jump gathers, arcs, lands where it was sent and rattles the lid', () => {
    const rig = rigAt()
    rig.travel({ x: 420, y: 150 })
    assert.equal(rig.shown, 'hop')
    const plan = planPetMove(320, -250, 100)
    const crouched = run(rig, 0.1)
    near(crouched.x, 100, 0.01, 'he does not leave while gathering')
    assert.ok(crouched.squash > 0.08, 'he crouches first')
    let peak = 0, longest = 0, leaned = 0, tucked = 0, lid = 0, landed = null, clock = 0, before = { x: crouched.x, y: crouched.y }
    const end = run(rig, 3, pose => {
        clock += FRAME
        peak = Math.max(peak, pose.air)
        longest = Math.max(longest, Math.hypot(pose.x - before.x, pose.y - before.y))
        before = { x: pose.x, y: pose.y }
        if (pose.moving) { leaned = Math.max(leaned, pose.lean); tucked = Math.max(tucked, pose.footR) }
        else { landed ??= clock; lid = Math.max(lid, pose.lidY) }
    })
    near(peak, plan.height, 2, 'height of the arc')
    assert.ok(longest < 12, `the path has no breaks, longest frame was ${longest.toFixed(1)} px`)
    assert.ok(leaned > 6, 'he leans into the jump')
    assert.ok(tucked > 20, 'his feet come up in the air')
    near(landed, plan.duration + 0.03, 0.08, 'time in the air')
    assert.ok(lid > 12, 'the lid jumps when he lands')
    near(end.x, 420, 0.01, 'x'); near(end.y, 150, 0.01, 'y')
    assert.equal(end.air, 0)
    // Standing still he is never quite still: his weight and his hanging arm drift a little.
    for (const key of ['squash', 'lean', 'lidY', 'armL', 'headY']) near(end[key], PET_REST[key], key === 'armL' ? 2.5 : key === 'lean' ? 1.2 : 0.6, `${key} settles`)
})

test('a target that moves while he is in the air bends the path without a jolt', () => {
    const rig = rigAt()
    rig.travel({ x: 420, y: 150 })
    let before = rig.position, longest = 0
    const watch = pose => { longest = Math.max(longest, Math.hypot(pose.x - before.x, pose.y - before.y)); before = { x: pose.x, y: pose.y } }
    run(rig, 0.4, watch)
    // The page keeps scrolling under the frame he is jumping to.
    for (let i = 1; i <= 12; i++) { rig.follow({ x: 420, y: 150 - i * 8 }); watch(rig.step(FRAME)) }
    const end = run(rig, 2, watch)
    assert.ok(longest < 14, `no frame moved him more than a stride, got ${longest.toFixed(1)} px`)
    near(end.x, 420, 0.01, 'x'); near(end.y, 54, 0.01, 'y')
})

test('a page that scrolls under him carries him; only a spot that gets away makes him move', () => {
    const rig = rigAt()
    for (let i = 1; i <= 30; i++) { rig.follow({ x: 100, y: 400 - i * 6 }); const pose = rig.step(FRAME); assert.equal(pose.moving, false) }
    assert.equal(rig.shown, 'idle', 'no walking on the spot while the page scrolls')
    const carried = run(rig, 0.5)
    near(carried.y, 220, 0.5, 'he ends on the spot')
    rig.follow({ x: 100, y: 20 })
    assert.equal(rig.moving, true, 'far enough away and he goes after it')
})

test('a chapter that needs no journey still gets a jump on the spot', () => {
    const rig = rigAt()
    rig.travel({ x: 104, y: 400 })
    assert.equal(rig.shown, 'hop')
    let peak = 0
    const end = run(rig, 2, pose => { peak = Math.max(peak, pose.air) })
    near(peak, 27, 1, 'a quarter of his width off the ground')
    assert.deepEqual([end.x, end.y, end.air, end.moving], [104, 400, 0, false])
    // The page settling by a few pixels is not a chapter.
    rig.follow({ x: 106, y: 396 })
    assert.equal(rig.moving, false)
})

test('he hangs from the hand that carries him and collects himself when put down', () => {
    const rig = rigAt()
    rig.grab()
    assert.equal(rig.shown, 'held')
    let swung = 0, trailed = 0
    for (let i = 1; i <= 40; i++) {
        rig.carry({ x: 100 + i * 9, y: 400 })
        const pose = rig.step(FRAME)
        swung = Math.max(swung, pose.swing); trailed = Math.min(trailed, pose.legR)
        assert.equal(pose.held, true)
    }
    assert.ok(swung > 8, `his feet trail behind the hand, swing reached ${swung.toFixed(1)}`)
    assert.ok(trailed < -3, 'and his legs lag behind the body')
    assert.deepEqual(rig.position, { x: 460, y: 400 })
    rig.travel({ x: 0, y: 0 })
    assert.equal(rig.moving, false, 'he does not jump out of the hand')
    rig.release()
    const end = run(rig, 1.5)
    assert.equal(end.held, false)
    assert.deepEqual([end.x, end.y, end.moving], [460, 400, false], 'put down, he stays where he was put')
    near(end.swing, 0, 1.5, 'and stops swinging')
    rig.travel({ x: 0, y: 0 })
    assert.equal(rig.moving, true, 'until the guide moves on')
})

test('narrating moves his mouth a little and stops when the narration does', () => {
    const rig = rigAt()
    rig.speak(true)
    assert.equal(rig.shown, 'speaking')
    let widest = 0, closures = 0, open = false
    run(rig, 8, pose => {
        widest = Math.max(widest, pose.open)
        if (pose.open > 0.1 && !open) open = true
        if (pose.open < 0.04 && open) { open = false; closures++ }
    })
    assert.ok(widest > 0.1 && widest <= PET_SPEAKING_MOUTH[1] + 0.06, `the mouth opens, but not wide: ${widest.toFixed(2)}`)
    assert.ok(closures >= 4, 'phrases have breaths between them')
    rig.speak(false)
    near(run(rig, 0.6).open, 0, 0.02, 'mouth closed')
})

test('each little performance moves what it is named for and ends at rest', () => {
    const moves = {
        curious: pose => pose.head < -3,
        stretch: pose => pose.armL > 20 && pose.eye < 0.4,
        happy: pose => pose.lift < -25 && pose.joy > 0.5,
        balance: pose => pose.footL > 25,
        sleepy: pose => pose.eye < 0.3 && pose.headY > 6,
        greet: pose => pose.armR < -10,
        tiphat: pose => pose.lidY > 45 && pose.eye < 0.2,
        dance: pose => pose.footR > 22 && pose.lean < -3,
        boil: pose => pose.lidY > 40,
        spin: pose => pose.air > 30 && pose.twirl > 0.4 && pose.twirl < 0.6,
        flip: pose => pose.air > 50 && pose.roll > 150 && pose.roll < 210,
        bow: pose => pose.lean > 9 && pose.eye < 0.2,
    }
    assert.deepEqual(Object.keys(moves), [...PET_GESTURES])
    for (const name of PET_GESTURES) {
        const rig = rigAt()
        assert.equal(rig.perform(name, 4), true)
        let seen = false
        run(rig, 4.1, pose => { seen ||= moves[name](pose) })
        assert.ok(seen, `${name} shows`)
        assert.equal(rig.shown, 'idle', `${name} ends`)
        // Legs and feet have no idle habit that could still be playing.
        const end = run(rig, 1.2)
        for (const key of ['lift', 'squash', 'eye', 'joy', 'open', 'air', 'twirl', 'roll']) near(end[key], PET_REST[key] ?? 0, key === 'eye' ? 1 : 0.2, `${name} leaves ${key}`)
    }
    const busy = rigAt()
    busy.travel({ x: 500, y: 100 })
    assert.equal(busy.perform('happy'), false, 'no performances on the way somewhere')
    assert.equal(busy.perform('nonsense'), false)
})

test('he blinks, and his eyes go to what he is showing', () => {
    const rig = rigAt()
    rig.attend({ x: 20, y: 900 })   // down and to his left
    let blinked = false, looked = false
    run(rig, 14, pose => { blinked ||= pose.eye < 0.3; looked ||= pose.px < -3 && pose.py > 2 })
    assert.ok(blinked, 'he blinks')
    assert.ok(looked, 'he looks at the section')
})

test('at rest he is drawn every other frame, and his eyes hold steady at that pace too', () => {
    // A stiff spring stepped too coarsely overshoots further each time: the eye would flutter open and half shut.
    for (const frame of [1 / 30, 1 / 20, 1 / 15]) {
        const rig = rigAt()
        rig.travel({ x: 420, y: 150 })   // he blinks as he lands
        let landedFor = 0, flutter = 0, blinked = false, last = 1
        for (let i = 0; i < Math.round(4 / frame); i++) {
            const pose = rig.step(frame)
            if (pose.moving) continue
            landedFor += frame
            blinked ||= pose.eye < 0.4
            // Once the landing blink is over, the eye is open and stays put until the next blink, which comes no sooner than two seconds on.
            if (landedFor > 0.5 && landedFor < 1.9) flutter = Math.max(flutter, Math.abs(pose.eye - 1), Math.abs(pose.eye - last))
            last = pose.eye
        }
        assert.ok(blinked, 'he blinks on landing')
        assert.ok(flutter < 0.02, `eyes steady at ${Math.round(1 / frame)} frames a second, moved by ${flutter.toFixed(3)}`)
    }
})

test('with reduced motion he is simply where he should be, at rest', () => {
    const rig = createTourPetRig({ random: seeded(), width: 100, still: () => true })
    rig.place({ x: 10, y: 10 }, { scale: 2 })
    rig.travel({ x: 400, y: 300 })
    assert.equal(rig.moving, false)
    assert.equal(rig.perform('happy'), false)
    rig.speak(true)
    const pose = run(rig, 1)
    assert.deepEqual([pose.x, pose.y, pose.air, pose.clock], [400, 300, 0, 0])
    for (const key of Object.keys(PET_SPRINGS)) if (!['browL', 'browR', 'armR', 'vapour'].includes(key)) assert.equal(pose[key], PET_REST[key], key)
})

test('he starts at the size of the opening screen and comes down to his own as he leaves it', () => {
    const rig = createTourPetRig({ random: seeded(), width: 100 })
    rig.place({ x: 100, y: 400 }, { scale: 1.9 })
    near(run(rig, 0.5).scale, 1.9, 0.01, 'he keeps the stage size while he waits')
    rig.travel({ x: 300, y: 100 })
    near(run(rig, 2).scale, 1, 0.02, 'his own size once he has arrived')
})

test('at rest the drawn face sits on the painted one', () => {
    const figure = petFigure({ ...PET_REST, breath: 0, clock: 0 })
    figure.eyes.forEach((eye, index) => {
        const [cx, cy, rx, ry] = PET_EYES[index].rim
        assert.deepEqual(eye.rim, { cx, cy, rx, ry })
        assert.deepEqual([eye.pupil.cx, eye.pupil.cy, eye.pupil.ry], [PET_EYES[index].pupil[0], PET_EYES[index].pupil[1], PET_EYES[index].pupil[3]])
        assert.equal(eye.lash.opacity, 0)
    })
    assert.equal(figure.mouth.filled, false)
    assert.match(figure.mouth.d, /^M562\.5 623\.5C/)
    assert.equal(figure.steamOpacity, 1)
    assert.match(figure.figure, /scale\(1 1\) translate\(-600 -1150\) rotate\(0 600 560\)$/)
    assert.equal(figure.inside.height, 0)
})

test('a lid comes down over the eye: the eye keeps its shape, the closed line curves down, a beam curves it up', () => {
    const curve = d => d.match(/([\d.]+)Q[\d.]+ ([\d.]+)/).slice(1).map(Number)
    const [cx, cy, rx, ry] = PET_EYES[0].rim
    const open = petFigure({ ...PET_REST, breath: 0, clock: 0 }).eyes[0]
    assert.equal(open.lash.opacity, 0)
    assert.ok(curve(open.lid)[0] < cy - ry - 4, 'the lid of an open eye is out of sight above it')
    const half = petFigure({ ...PET_REST, eye: 0.5, breath: 0, clock: 0 }).eyes[0]
    assert.deepEqual([half.rim.rx, half.rim.ry, half.pupil.ry], [rx, ry, PET_EYES[0].pupil[3]], 'a half-closed eye is not a squashed one')
    assert.equal(half.lash.opacity, 1)
    assert.ok(curve(half.lid)[0] > cy - ry && curve(half.lid)[0] < cy + ry, 'the lid is part of the way down')
    const shut = petFigure({ ...PET_REST, eye: 0, breath: 0, clock: 0 }).eyes[0]
    const [ends, middle] = curve(shut.lid)
    // The lowest point of the covering edge is below the eye: nothing of it shows.
    assert.ok((ends + middle) / 2 > cy + ry, 'a shut eye is covered completely')
    const [lashEnds, lashMiddle] = curve(shut.lash.d)
    assert.ok(lashMiddle > lashEnds && (lashEnds + lashMiddle) / 2 < cy + ry - 10, 'the closed line dips, inside the eye')
    const [beamEnds, beamMiddle] = curve(petFigure({ ...PET_REST, joy: 1, breath: 0, clock: 0 }).eyes[1].lash.d)
    assert.ok(beamMiddle < beamEnds, 'beaming, it arches up')
    const aside = petFigure({ ...PET_REST, px: 40, py: -40, breath: 0, clock: 0 }).eyes[0]
    assert.ok(aside.pupil.cx - PET_EYES[0].pupil[0] <= 10 && PET_EYES[0].pupil[1] - aside.pupil.cy <= 9, 'the pupil stays inside the eye')
})

test('the mouth opens from the painted smile, and the lid never sinks into the pot', () => {
    const open = petMouth({ smile: 1, open: 0.3, wide: 0.8 })
    assert.equal(open.filled, true)
    assert.match(open.d, /Z$/)
    assert.equal(petMouth({ smile: -1 }).d.includes('C'), true)
    assert.match(petFigure({ ...PET_REST, lidY: -40, breath: 0, clock: 0 }).lid, /^translate\(0 2\)/)
    // Under a lifted lid: the dark of the pot's mouth, never a tall block.
    assert.deepEqual(petFigure({ ...PET_REST, lidY: 9, breath: 0, clock: 0 }).inside, { y: 416, height: 9 })
    assert.deepEqual(petFigure({ ...PET_REST, lidY: 60, breath: 0, clock: 0 }).inside, { y: 411, height: 14 })
})

test('steam is one closed shape per wisp, rooted on the lid whatever the time', () => {
    const wisp = { x: 555, base: 204, length: 166, sway: 13, width: 35, phase: 0 }
    const foot = d => d.match(/^M([\d.-]+) ([\d.-]+)/).slice(1).map(Number)
    const rest = petWisp(wisp), later = petWisp(wisp, { clock: 3.7, lean: -10, amount: 1 })
    assert.match(rest, /Z$/)
    assert.notEqual(rest, later, 'it ripples')
    near(foot(later)[0], foot(rest)[0], 4, 'the foot of the wisp')
    near(foot(later)[1], 204, 4, 'height of the foot')
    assert.ok(!/NaN/.test(later))
})

test('he stands on the frame when there is room and never under the dock', () => {
    const pet = tourPetDimensions(1440, 900), viewport = { width: 1440, height: 900 }
    const target = { left: 300, top: 400, width: 800, height: 300 }
    assert.deepEqual(placeTourPet({ target, viewport, pet }), { x: 300 + 800 - pet.width - 24, y: 400 - pet.height - 16 })
    // A dock over the frame's right end sends him to the other end.
    const dock = { left: 900, top: 150, right: 1440, bottom: 420 }
    assert.deepEqual(placeTourPet({ target, dock, viewport, pet }), { x: 324, y: 400 - pet.height - 16 })
    // With no section framed he waits in a corner, inside the viewport.
    const phone = tourPetDimensions(390, 844), spot = placeTourPet({ target: null, dock: { left: 0, top: 500, right: 390, bottom: 844 }, viewport: { width: 390, height: 844 }, pet: phone })
    assert.ok(spot.x >= phone.margin && spot.x + phone.width <= 390 - phone.margin + 0.01)
    assert.ok(spot.y + phone.height <= 500 - 14, 'clear of the dock')
})

test('his feet are found from the box he is fitted into', () => {
    // Fitted to the width and centred in the height: 1150 of 1285 down a figure 1224 wide.
    for (const [width, height] of [[144, 168], [104, 122], [88, 104], [200, 220]]) {
        const drawn = width * 1285 / 1224
        near(tourPetGround(width, height), (height - drawn) / 2 + drawn * 1150 / 1285, 0.05, `${width}x${height}`)
    }
})
