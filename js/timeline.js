// The 3D story's clock. Scrolling sets p, in screen heights from the top of the story. Its first part, why the
// world needs emulators, plays on the opening globe from WHY[0] to WHY[1] while everything after it waits;
// storyU maps p to the clock u of the rest (the primer's dive and forests, the planet, the emulator), which keeps
// its own timings.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const WHY = [0.5, 4.5];
const D = WHY[1] - WHY[0];
export const storyU = p => (p < WHY[0] ? p : p < WHY[1] ? WHY[0] : p - D);
export const whyK = p => clamp((p - WHY[0]) / D);
