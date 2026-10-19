// Grows the film's trees off the main thread (see hero-grow.js). Each spec lists the parts that share
// one geometry (a tree that burns and the seedling that replaces it, say); each geometry is posted as
// soon as it is grown, in order, so the first tree is ready early.
import {growTreeArrays} from './hero-grow.js';

self.onmessage = ({data}) => {
  data.specs.forEach((parts, id) => {
    const a = growTreeArrays(parts);
    self.postMessage({id, a}, [a.position.buffer, a.normal.buffer, a.a.buffer, a.b.buffer]);
  });
};
