// The 3D story's clock. Scrolling sets p, in screen heights from the top of the story. storyU maps p to the clock u
// of the dive, the rise and all that follows (the planet, the emulator, the what-ifs, the end card), which keep their
// own timings: linear between the knots [p, u]. Where u stands still, the page plays scenes of its own on p: why
// forests need understanding (WHY, on the opening globe, unrolled into a map), the slow simulation of the planet
// (SLOW, with the planet in 2021) and what an emulator saves (SPEED, with the emulator built). The primer's forests
// grow in three views at once on their own clock (VIEWS).
export const WHY = [0.5, 4.3];
export const VIEWS = [5.55, 7.85];
// the views' own clock, in screen heights from VIEWS[0]: the sapling sprouts, the frame splits into the three views,
// forty years run, and the fifteen-age view takes the frame back
export const VIEW = {sprout: [0, 0.14], split: [0.1, 0.45], years: [0.5, 1.6], merge: [1.85, VIEWS[1] - VIEWS[0]]};
export const SLOW = [10.05, 11.15];
export const SPEED = [12.63, 13.73];
const KNOTS = [[0, 0], [WHY[0], 0.5], [WHY[1], 0.5], [WHY[1] + 0.1, 0.55], [5.5, 1.96], [VIEWS[0], 2], [VIEWS[1], 6.2], [8.35, 6.71],
  [9.4, 7.32], [SLOW[0], 7.97], [SLOW[1], 7.97], [SPEED[0], 9.45], [SPEED[1], 9.45]];
export function storyU(p) {
  const K = KNOTS, last = K[K.length - 1];
  if (p >= last[0]) return p - last[0] + last[1];
  if (p <= 0) return p;
  let i = 1;
  while (p > K[i][0]) i++;
  const [p0, u0] = K[i - 1], [p1, u1] = K[i];
  return u0 + (u1 - u0) * (p - p0) / (p1 - p0);
}
