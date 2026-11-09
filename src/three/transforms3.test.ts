import { describe, expect, it } from "vitest";
import { Vec3 } from "wtc-math";
import {
  apply3,
  compose3,
  rotateX,
  rotateY,
  rotateZ,
  scale3,
  translate3,
} from "./transforms3.js";

const expectVec = (v: Vec3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 9);
  expect(v.y).toBeCloseTo(y, 9);
  expect(v.z).toBeCloseTo(z, 9);
};
const X = new Vec3(1, 0, 0);
const Y = new Vec3(0, 1, 0);
const Z = new Vec3(0, 0, 1);
const quarter = Math.PI / 2;

describe("3D transforms (pinned against wtc-math behaviour)", () => {
  it("turns by the right-hand rule", () => {
    expectVec(apply3(rotateX(quarter), Y), 0, 0, 1); // y → z
    expectVec(apply3(rotateY(quarter), Z), 1, 0, 0); // z → x
    expectVec(apply3(rotateY(quarter), X), 0, 0, -1);
    expectVec(apply3(rotateZ(quarter), X), 0, 1, 0); // x → y
  });

  it("moves and scales", () => {
    expectVec(apply3(translate3(1, 2, 3), X), 2, 2, 3);
    expectVec(apply3(translate3(new Vec3(0, -1, 0)), Y), 0, 0, 0);
    expectVec(apply3(scale3(2), new Vec3(1, 2, 3)), 2, 4, 6);
    expectVec(apply3(scale3(new Vec3(1, 2, 3)), new Vec3(1, 1, 1)), 1, 2, 3);
  });

  it("composes in the order given", () => {
    // Turn x up to y, then move right: (10, 1, 0).
    expectVec(apply3(compose3(rotateZ(quarter), translate3(10)), X), 10, 1, 0);
    // Move right, then turn: (0, 11, 0).
    expectVec(apply3(compose3(translate3(10), rotateZ(quarter)), X), 0, 11, 0);
    expectVec(apply3(compose3(), new Vec3(4, 5, 6)), 4, 5, 6);
  });

  it("leaves its input alone", () => {
    const p = new Vec3(1, 2, 3);
    apply3(translate3(5, 5, 5), p);
    expectVec(p, 1, 2, 3);
  });
});
