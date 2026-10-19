// Grows chapter one's tree off the main thread (see hero-grow.js).
import {growHeroTree, heroTreeArrays} from './hero-grow.js';

self.onmessage = ({data}) => {
  const a = heroTreeArrays(growHeroTree(data.heights), {leaf: data.leaf});
  self.postMessage(a, [a.position.buffer, a.normal.buffer, a.a.buffer, a.b.buffer]);
};
