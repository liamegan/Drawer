import { Vec2 } from "wtc-math";
import {
  angleField,
  curlField,
  flowHatch,
  Noise,
  paper,
  Polyline,
  rect,
  streamlines,
  type Random,
  type VectorField,
} from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/** How a blob is filled. Every kind appears at least once per seed. */
const FILLS = [
  "curl", // flowHatch along curl noise: swirling, evenly spaced
  "grain", // flowHatch along an angle field: long, gently bending grain
  "tone", // flowHatch with a lit tone field: lines crowd on the shadow side
  "dashes", // flowHatch with maxLength: short strokes, like grass or fur
  "inset", // curl flow kept 1.2 mm inside the outline
] as const;
type Fill = (typeof FILLS)[number];

/**
 * Flow fields. Blobs whose outlines are warped by noise are drawn front to
 * back (lowest on the page first), each filled with evenly spaced lines
 * following its own field, the outline and fill on separate pens. Then a
 * slow curl-noise flow fills the background on a third pen, ending at the
 * blobs instead of running under them.
 *
 * Debug (`d`) shows the background field's direction on a coarse grid and
 * labels each blob with its fill.
 */
const sketch: Sketch = {
  title: "Flow",
  paper: paper.A5,
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.6 },

  draw(doc, random, debug) {
    const area = doc.drawArea;
    const rng = random.fork("shapes");
    const noise = new Noise(random.fork("noise"));

    doc.layer("outline", { color: "#1b1b1b", width: 0.3 });
    const fillLayer = doc.layer("fill", { color: "#3a3a3a", width: 0.25 });
    doc.layer("flow", { color: "#2f5d7c", width: 0.25 });
    const pen = fillLayer.pen.width;
    const light = new Vec2(-1, -1).normalise();

    // Spread the blobs out inside the area, letting them overlap a little.
    const placed: { center: Vec2; radius: number }[] = [];
    for (let tries = 0; tries < 300 && placed.length < 7; tries++) {
      const radius = rng.range(13, 24);
      const center = rng.pointIn(area.inset(radius * 1.3));
      const clear = placed.every(
        (p) => p.center.distance(center) > 0.8 * (p.radius + radius),
      );
      if (clear) placed.push({ center, radius });
    }
    // Every kind first, then random extras; trimmed before shuffling so a
    // full page keeps every kind.
    const fills = rng.shuffle(
      [
        ...FILLS,
        ...Array.from({ length: placed.length }, () => rng.pick(FILLS)),
      ].slice(0, placed.length),
    );

    const blobs = placed.map(({ center, radius }, i) => ({
      fill: fills[i],
      center,
      radius,
      outline: warpedBlob(noise, center, radius, i),
      field: blobField(fills[i], noise, rng, i),
    }));

    // Nearest first: the lower a blob sits on the page, the closer it is.
    blobs.sort((a, b) => b.center.y - a.center.y);

    for (const { fill, center, radius, outline, field } of blobs) {
      doc.draw("outline", outline, { silhouette: false, bounds: area });
      const tone = (x: number, y: number) =>
        0.35 -
        0.3 * (((x - center.x) * light.x + (y - center.y) * light.y) / radius);
      doc.draw("fill", fillBlob(fill, outline, field, pen, tone), {
        silhouette: outline,
        bounds: area,
      });
      debug.label(fill, center);
    }

    // The background: a broad, slow flow that stops at the blobs (the mask
    // holds them, plus the occlusion gap) rather than running underneath.
    const background = curlField((x, y) =>
      noise.fbm3(x, y, 7.3, { frequency: 0.012, octaves: 2 }),
    );
    const flow = streamlines(background, {
      region: rect(area.x, area.y, area.width, area.height),
      separation: 2.2,
      minLength: 4,
      stopAt: doc.mask.hiddenTest(area),
    });
    doc.draw("flow", flow, { silhouette: false, bounds: area });

    // Debug: the background field's direction every 8 mm.
    const arrows: Polyline[] = [];
    for (let y = area.y + 4; y < area.max.y; y += 8) {
      for (let x = area.x + 4; x < area.max.x; x += 8) {
        const [dx, dy] = background(x, y);
        const length = Math.hypot(dx, dy);
        if (!(length > 0)) continue;
        const u = new Vec2(dx / length, dy / length).scale(2.5);
        arrows.push(new Polyline([new Vec2(x, y), new Vec2(x + u.x, y + u.y)]));
      }
    }
    debug.path(arrows, "#e07a21");
  },
};

/** Each blob's own flow: noise offset per blob so no two match. */
function blobField(
  fill: Fill,
  noise: Noise,
  rng: Random,
  index: number,
): VectorField {
  const z = index * 3.1 + 0.5;
  if (fill === "grain") {
    // Mostly one way, bending gently with the noise.
    const base = rng.range(0, Math.PI);
    return angleField(
      (x, y) => base + 0.9 * noise.fbm3(x, y, z, { frequency: 0.03 }),
    );
  }
  const frequency = fill === "dashes" ? 0.04 : 0.03;
  return curlField((x, y) => noise.fbm3(x, y, z, { frequency, octaves: 2 }));
}

function fillBlob(
  fill: Fill,
  outline: Polyline,
  field: VectorField,
  pen: number,
  tone: (x: number, y: number) => number,
): Polyline[] {
  switch (fill) {
    case "curl":
      return flowHatch(outline, { field, spacing: 1 });
    case "grain":
      return flowHatch(outline, { field, spacing: 0.9 });
    case "tone":
      return flowHatch(outline, { field, tone, pen });
    case "dashes":
      return flowHatch(outline, { field, spacing: 1.1, maxLength: 3.5 });
    case "inset":
      return flowHatch(outline, { field, spacing: 1, inset: 1.2 });
  }
}

/**
 * A circle whose radius is pushed in and out by noise around it. Noise is
 * sampled on a circle in noise space, so the outline closes without a seam.
 */
function warpedBlob(
  noise: Noise,
  center: Vec2,
  radius: number,
  index: number,
): Polyline {
  const n = 240;
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const wobble = noise.fbm3(
        Math.cos(a) * 0.9,
        Math.sin(a) * 0.9,
        index * 5,
        {
          octaves: 2,
        },
      );
      const r = radius * (1 + 0.3 * wobble);
      return new Vec2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
    }),
    true,
  );
}

export default sketch;
