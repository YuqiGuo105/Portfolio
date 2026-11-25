import { forwardRef, useImperativeHandle, useRef } from "react"
import { PET_ART, PET_BROWS, PET_EYES, petFigure } from "../../lib/tourPetDrawing.mjs"
import { PET_REST } from "../../lib/tourPetRig.mjs"

const REST = petFigure({ ...PET_REST, breath: 0, clock: 0 })
const ELLIPSE = ["cx", "cy", "rx", "ry"]

/**
 * The guide's Mr. Pot: the illustration cut into parts, with his face and steam drawn over it.
 * It renders at rest; whoever owns the rig calls draw(pose) each frame, which only touches
 * attributes that changed.
 */
const TourPetFigure = forwardRef(function TourPetFigure(_props, ref) {
    const svg = useRef(null)
    const parts = useRef(null)
    const drawn = useRef(new Map())

    useImperativeHandle(ref, () => ({
        draw(pose) {
            if (!svg.current) return
            if (!parts.current) {
                parts.current = new Map()
                for (const node of svg.current.querySelectorAll("[data-part]")) parts.current.set(node.dataset.part, node)
            }
            const put = (part, name, value) => {
                const key = `${part}.${name}`
                if (drawn.current.get(key) === value) return
                drawn.current.set(key, value)
                parts.current.get(part)?.setAttribute(name, value)
            }
            const next = petFigure(pose)
            for (const part of ["figure", "armL", "armR", "legL", "legR", "head", "lid"]) put(part, "transform", next[part])
            put("inside", "y", next.inside.y)
            put("inside", "height", next.inside.height)
            next.eyes.forEach((eye, index) => {
                for (const shape of ["rim", "white", "pupil", "glint"]) for (const name of ELLIPSE) put(`${shape}${index}`, name, eye[shape][name])
                put(`lid${index}`, "d", eye.lid)
                put(`lidCheek${index}`, "d", eye.lid)
                put(`lash${index}`, "d", eye.lash.d)
                put(`lash${index}`, "opacity", eye.lash.opacity)
            })
            next.brows.forEach((transform, index) => put(`brow${index}`, "transform", transform))
            put("mouth", "d", next.mouth.d)
            put("mouth", "fill", next.mouth.filled ? PET_ART.ink : "none")
            next.steam.forEach((d, index) => put(`wisp${index}`, "d", d))
            put("steam", "opacity", next.steamOpacity)
        },
    }), [])

    const layer = (name, clip) => (
        <g className={`st-pet-layer st-pet-${name}`} clipPath={`url(#st-pet-${clip}-clip)`}>
            <image href={PET_ART.href} width={PET_ART.width} height={PET_ART.height} />
        </g>
    )

    return (
        <svg ref={svg} className="st-pet-rig" viewBox={`0 0 ${PET_ART.width} ${PET_ART.height}`} aria-hidden="true" draggable={false}
            style={{ display: "block", width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            <defs>
                {/* The lid and the pot share the dark line between them, so no seam shows when the lid is down. */}
                <clipPath id="st-pet-lid-clip"><path d="M238 206H1000V431H238Z" /></clipPath>
                {/* The chin dips a little lower in the middle than at the sides; the whole of its line stays with the head. */}
                <clipPath id="st-pet-head-clip"><path d="M238 423H1000V580H880L855 695 795 765Q600 778 440 765L322 730 298 590H238Z" /></clipPath>
                <clipPath id="st-pet-core-clip">
                    {/* The dark line between the hanging arm and the body is the body's own side, so the torso keeps it:
                        an arm that swings away must not take the outline with it. The arm layer has the same line as its
                        inner edge; at rest the two lie on each other. The top follows the underside of the chin, whose line
                        belongs to the head alone, or a tilted head would leave a second chin behind. */}
                    <path d="M438 762L460 762 500 765 600 770 700 764 740 759 756 765H778V774L757 771 780 864 764 1015H452L451 990 451 978 449 970 445 962 444 950 443 935 441 920 438 905 438 890 439 872 442 855 446 838 453 820 460 806 478 795 485 780Z" />
                </clipPath>
                {/* The arm's inner edge is the line it shares with the body and nothing beyond it; below the hand the line is the leg's. */}
                <clipPath id="st-pet-left-arm-clip"><path d="M320 750H485V780L478 795 467 812 463 830 460 845 458 860 456 875 456 905 458 920 461 935 466 950 467 972 450 981 447 1000 430 1010H320Z" /></clipPath>
                {/* Cut along the underside of the raised arm: the body's side below the armpit stays with the body. */}
                <clipPath id="st-pet-right-arm-clip"><path d="M750 780L845 722 890 590H1020V800L940 792 922 810 905 826 890 840 875 852 860 861 845 868 830 874 815 878 800 881 786 883 770 876 756 862Z" /></clipPath>
                {/* The legs begin under the line of the belly, which is the body's: a leg that carried its own copy of that
                    line would show it below the body whenever it swung. The left one is notched where the hand hangs in
                    front of the hip, so the hand goes with the arm. */}
                <clipPath id="st-pet-left-leg-clip"><path d="M440 995H536L548 1002 560 1006 570 1010 577 1014H595V1180H405V1012H440Z" /></clipPath>
                <clipPath id="st-pet-right-leg-clip"><path d="M604 1014H634L642 1010 652 1006 664 1002 676 995H815V1180H604Z" /></clipPath>
                {PET_EYES.map((eye, index) => (
                    <clipPath key={index} id={`st-pet-eye-clip-${index}`}>
                        <ellipse cx={eye.rim[0]} cy={eye.rim[1]} rx={eye.rim[2] + 3.5} ry={eye.rim[3] + 3.5} />
                    </clipPath>
                ))}
                {PET_EYES.map((eye, index) => (
                    <clipPath key={index} id={`st-pet-cheek-clip-${index}`}><circle cx={eye.cheek[0]} cy={eye.cheek[1]} r={eye.cheek[2]} /></clipPath>
                ))}
            </defs>

            <g data-part="figure" transform={REST.figure}>
                {/* Under everything, and hidden at rest: what shows when a part swings away from the body. A neck with its
                    own outline for when the head tilts and the chin lifts off a shoulder; skin over each hip and the start
                    of each inner leg line, so a leg that swings stays joined to the belly. */}
                <g className="st-pet-joints">
                    <ellipse cx="600" cy="764" rx="158" ry="19" fill={PET_ART.skin} stroke={PET_ART.ink} strokeWidth="13" />
                    <path d="M470 1000H576V1036H470ZM636 1000H742V1036H636Z" fill={PET_ART.skin} />
                    <path d="M583 1006V1038M627 1006V1038" fill="none" stroke={PET_ART.ink} strokeWidth="11" />
                </g>
                <g data-part="armL" transform={REST.armL}>{layer("arm st-pet-arm-left", "left-arm")}</g>
                <g data-part="armR" transform={REST.armR}>{layer("arm st-pet-arm-right", "right-arm")}</g>
                <g data-part="legL" transform={REST.legL}>{layer("leg st-pet-leg-left", "left-leg")}</g>
                <g data-part="legR" transform={REST.legR}>{layer("leg st-pet-leg-right", "right-leg")}</g>
                {layer("core", "core")}
                <g data-part="head" transform={REST.head}>
                    {layer("head", "head")}
                    <rect data-part="inside" x="345" width="514" y={REST.inside.y} height={REST.inside.height} fill={PET_ART.inside} />
                    <g className="st-pet-face">
                        {/* Paint over the illustration's own features, cheeks included where an eye covers one. */}
                        {PET_EYES.map((eye, index) => (
                            <g key={index} clipPath={`url(#st-pet-eye-clip-${index})`}>
                                <rect x={eye.rim[0] - 60} y={eye.rim[1] - 70} width="120" height="140" fill={PET_ART.skin} />
                                <circle cx={eye.cheek[0]} cy={eye.cheek[1]} r={eye.cheek[2]} fill={PET_ART.blush} />
                            </g>
                        ))}
                        {PET_BROWS.map((brow, index) => <path key={index} d={brow.d} fill="none" stroke={PET_ART.skin} strokeWidth="24" strokeLinecap="round" />)}
                        <path d={REST.mouth.d} fill="none" stroke={PET_ART.skin} strokeWidth="25" strokeLinecap="round" />

                        {PET_EYES.map((_eye, index) => (
                            <g key={index}>
                                <ellipse data-part={`rim${index}`} {...REST.eyes[index].rim} fill={PET_ART.ink} />
                                <ellipse data-part={`white${index}`} {...REST.eyes[index].white} fill={PET_ART.white} />
                                <ellipse data-part={`pupil${index}`} {...REST.eyes[index].pupil} fill={PET_ART.ink} />
                                <ellipse data-part={`glint${index}`} {...REST.eyes[index].glint} fill={PET_ART.white} />
                                {/* The lid comes down over the eye: skin, the cheek where it reaches under the eye, and the dark edge. */}
                                <g clipPath={`url(#st-pet-eye-clip-${index})`}>
                                    <path data-part={`lid${index}`} d={REST.eyes[index].lid} fill={PET_ART.skin} />
                                    <g clipPath={`url(#st-pet-cheek-clip-${index})`}><path data-part={`lidCheek${index}`} d={REST.eyes[index].lid} fill={PET_ART.blush} /></g>
                                    <path data-part={`lash${index}`} d={REST.eyes[index].lash.d} opacity={REST.eyes[index].lash.opacity}
                                        fill="none" stroke={PET_ART.ink} strokeWidth="14" strokeLinecap="round" />
                                </g>
                            </g>
                        ))}
                        {PET_BROWS.map((brow, index) => (
                            <path key={index} data-part={`brow${index}`} d={brow.d} transform={REST.brows[index]}
                                fill="none" stroke={PET_ART.ink} strokeWidth="15" strokeLinecap="round" />
                        ))}
                        <path data-part="mouth" d={REST.mouth.d} fill="none" stroke={PET_ART.ink} strokeWidth="14.5" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                    <g data-part="lid" transform={REST.lid}>{layer("lid", "lid")}</g>
                    <g data-part="steam" className="st-pet-steam" opacity={REST.steamOpacity} fill={PET_ART.vapour}>
                        {REST.steam.map((d, index) => <path key={index} data-part={`wisp${index}`} d={d} />)}
                    </g>
                </g>
            </g>
        </svg>
    )
})

export default TourPetFigure
