/* ============================================================
   DECORATIVE SPIRAL BACKGROUND — BlissBurn brand swoosh
   Draws the two tapered logo arms (plus lighter underlays) on a
   fixed canvas. Instead of tumbling the whole shape, the arms
   flow around their ellipses so the logo silhouette stays
   constant while the spiral appears to rotate.
   Styled/positioned via .spiral-motif in css/style.css.
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('spiralMotifCanvas');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');

    const SIZE = 1000; // internal drawing units (square)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;

    const GOLD = '#f5b80c';
    const GOLD_LIGHT = '#fbd35e';

    const deg = (d) => (d * Math.PI) / 180;
    const TAU = Math.PI * 2;

    /* Each arm is a brush-stroke ellipse: the outer edge sits on the
       ellipse, the inner edge is inset by a width that tapers to a
       point at the tail and is heaviest at the far end. `shrink`
       pulls the radius in along the sweep so the thick end tucks
       inside the tail, giving the spiral overlap. */
    const ARM_OUTER = {
        a: 380, b: 230, tilt: deg(-14),
        start: deg(186), sweep: deg(338),
        width: 88, shrink: 0.06, dx: 0, dy: 0
    };
    const ARM_INNER = {
        a: 205, b: 122, tilt: deg(-14),
        start: deg(348), sweep: deg(-338), // winds the opposite way, tail pointing right
        width: 58, shrink: 0.09, dx: -8, dy: 18
    };

    const STEPS = 120;

    function buildArmPath(arm, phase) {
        const outer = [];
        const inner = [];
        for (let i = 0; i <= STEPS; i++) {
            const t = i / STEPS;
            const ang = arm.start + phase + arm.sweep * t;
            const s = 1 - arm.shrink * t;
            const w = arm.width * Math.pow(t, 1.15);
            const ca = Math.cos(ang);
            const sa = Math.sin(ang);
            outer.push([arm.a * s * ca, arm.b * s * sa]);
            inner.push([(arm.a * s - w) * ca, (arm.b * s - w) * sa]);
        }
        const n = STEPS;
        ctx.beginPath();
        ctx.moveTo(outer[0][0], outer[0][1]);
        for (let i = 1; i <= n; i++) ctx.lineTo(outer[i][0], outer[i][1]);
        // Rounded end cap: bulge along the stroke's tangent direction
        const tx = outer[n][0] - outer[n - 1][0];
        const ty = outer[n][1] - outer[n - 1][1];
        const tl = Math.hypot(tx, ty) || 1;
        const mx = (outer[n][0] + inner[n][0]) / 2 + (tx / tl) * arm.width * 0.5;
        const my = (outer[n][1] + inner[n][1]) / 2 + (ty / tl) * arm.width * 0.5;
        ctx.quadraticCurveTo(mx, my, inner[n][0], inner[n][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
        ctx.closePath();
    }

    function drawArm(arm, phase, scale) {
        ctx.save();
        ctx.translate(arm.dx, arm.dy);
        ctx.rotate(arm.tilt);
        ctx.scale(scale, scale);
        buildArmPath(arm, phase);
        ctx.fill();
        ctx.restore();
    }

    function drawFrame(tSec) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.translate(SIZE / 2, SIZE / 2);

        const breath = 1 + 0.012 * Math.sin((tSec * TAU) / 14);
        ctx.scale(breath, breath);

        // Arms flow around their ellipses (one lap / 60s) in the same
        // direction, so the whole spiral reads as one slow rotation.
        const phase = (tSec * TAU) / 60;
        const lightLead = deg(14); // light underlay runs slightly ahead

        ctx.fillStyle = GOLD_LIGHT;
        drawArm(ARM_OUTER, phase + lightLead, 1.02);
        drawArm(ARM_INNER, phase + lightLead, 1.02);

        ctx.fillStyle = GOLD;
        drawArm(ARM_OUTER, phase, 1);
        drawArm(ARM_INNER, phase, 1);
    }

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
        drawFrame(0);
    } else {
        const loop = (now) => {
            drawFrame(now / 1000);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
})();
