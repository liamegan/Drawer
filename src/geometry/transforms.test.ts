import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { compose, identity, rotation, scaling, translation } from "./transforms.js";

const apply = (m: ReturnType<typeof identity>, x: number, y: number) => {
  const v = new Vec2(x, y).transformByMat3New(m);
  return [v.x, v.y];
};

const expectPoint = (actual: number[], x: number, y: number) => {
  expect(actual[0]).toBeCloseTo(x, 9);
  expect(actual[1]).toBeCloseTo(y, 9);
};

describe("transforms (pinned against wtc-math behaviour)", () => {
  it("identity leaves points alone", () => {
    expectPoint(apply(identity(), 3, 4), 3, 4);
  });

  it("translation accepts (x, y) or a Vec2", () => {
    expectPoint(apply(translation(10, -2), 1, 1), 11, -1);
    expectPoint(apply(translation(new Vec2(5, 6)), 0, 0), 5, 6);
  });

  it("positive rotation turns clockwise on a y-down screen: +x goes to +y", () => {
    expectPoint(apply(rotation(Math.PI / 2), 1, 0), 0, 1);
  });

  it("rotation about an origin keeps that origin fixed", () => {
    const o = new Vec2(10, 10);
    expectPoint(apply(rotation(Math.PI / 2, o), 10, 10), 10, 10);
    expectPoint(apply(rotation(Math.PI / 2, o), 11, 10), 10, 11);
  });

  it("scaling is uniform with one number, per-axis with two, and respects an origin", () => {
    expectPoint(apply(scaling(2), 3, 4), 6, 8);
    expectPoint(apply(scaling(2, 3), 1, 1), 2, 3);
    expectPoint(apply(scaling(2, 2, new Vec2(10, 10)), 11, 10), 12, 10);
  });

  it("compose applies transforms in the order listed", () => {
    // rotate first: (1,0) -> (0,1), then translate: -> (10,1)
    expectPoint(apply(compose(rotation(Math.PI / 2), translation(10, 0)), 1, 0), 10, 1);
    // translate first: (1,0) -> (11,0), then rotate: -> (0,11)
    expectPoint(apply(compose(translation(10, 0), rotation(Math.PI / 2)), 1, 0), 0, 11);
  });

  it("compose with no arguments is the identity", () => {
    expectPoint(apply(compose(), 7, 8), 7, 8);
  });
});
