// The 3D story's clock. Scrolling sets p, in screen heights from the top of the story. Its first part, why the
// world needs emulators, plays on the opening globe from WHY[0] to WHY[1] while everything after it waits; the
// primer dives to the Amazon, grows its forests in three views at once on their own clock (VIEWS), and rises past
// the satellite lidar back to the planet. storyU maps p to the clock u of the dive, the rise and all that follows
// (the planet, the emulator, the end card), which keep their own timings: linear between the knots [p, u].
export const WHY = [0.5, 6.05];
export const VIEWS = [7.3, 9.6];
// the views' own clock, in screen heights from VIEWS[0]: the sapling sprouts, the frame splits into the three views,
// forty years run, and the fifteen-age view takes the frame back
export const VIEW = {sprout: [0, 0.14], split: [0.1, 0.45], years: [0.5, 1.6], merge: [1.85, VIEWS[1] - VIEWS[0]]};
const KNOTS = [[0, 0], [WHY[0], 0.5], [WHY[1], 0.5], [WHY[1] + 0.1, 0.55], [7.25, 1.96], [VIEWS[0], 2], [VIEWS[1], 6.2], [10.1, 6.71], [11.15, 7.32]];
export function storyU(p) {
  const K = KNOTS, last = K[K.length - 1];
  if (p >= last[0]) return p - last[0] + last[1];
  if (p <= 0) return p;
  let i = 1;
  while (p > K[i][0]) i++;
  const [p0, u0] = K[i - 1], [p1, u1] = K[i];
  return u0 + (u1 - u0) * (p - p0) / (p1 - p0);
}
