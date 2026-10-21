// The rendered film's edit (assets/film/cut.json): a beat-timed path through the scroll film with its own
// short titles in place of the page's captions. Only the render mode (index.html?render) loads it; the
// soundtrack (scripts/soundtrack.py) scores the same beats.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const EASE = {
  lin: t => t,
  in: t => t * t * t,
  out: t => 1 - (1 - t) ** 3,
  io: t => (t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
};
const out3 = EASE.out;
const fmt = n => n.toLocaleString('en-US');

// Value of a key list [[beat, value, easing], ...] at beat b; a key's easing shapes the segment that ends on it.
export function keyed(keys, b) {
  if (b <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [b1, v1, e = 'lin'] = keys[i];
    if (b <= b1) {
      const [b0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * EASE[e]((b - b0) / (b1 - b0));
    }
  }
  return keys[keys.length - 1][1];
}

// Wrap each word of el's text in a span, keeping inline markup such as <em>.
function splitWords(el) {
  const ws = [];
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType === 1) { if (n.classList.contains('t-num')) { n.classList.add('w'); ws.push(n); } else walk(n); return; }
    if (n.nodeType !== 3) return;
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.append(part); return; }
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = part;
      frag.append(w);
      ws.push(w);
    });
    n.replaceWith(frag);
  });
  walk(el);
  return ws;
}

// in: a word or line arriving (blur, rise, fade); q runs 0 -> 1
function arrive(el, q) {
  el.style.opacity = q.toFixed(3);
  el.style.transform = `translateY(${((1 - q) * 0.34).toFixed(3)}em)`;
  el.style.filter = q > 0.995 ? '' : `blur(${((1 - q) * 9).toFixed(2)}px)`;
}

export async function createCut({titles, fade, panels, finale}) {
  const cut = await fetch('assets/film/cut.json').then(r => r.json());
  const spb = 60 / cut.bpm;
  await document.fonts.ready;   // counters are measured in their final font

  const cards = cut.titles.map(T => {
    const card = document.createElement('div');
    card.className = `t-card t-${T.pos}${T.kind ? ` t-${T.kind}` : ''}`;
    const main = document.createElement('p');
    main.className = 't-main';
    const count = T.count ? (T.text ?? '{n}').replace('{n}', `<span class="t-num">${fmt(T.count)}</span>`) : T.text;
    main.innerHTML = count;
    card.append(main);
    let sub = null;
    if (T.sub) {
      sub = document.createElement('p');
      sub.className = `t-sub${T.subClass ? ` ${T.subClass}` : ''}`;
      sub.innerHTML = T.sub;
      card.append(sub);
    }
    let parts = [];
    if (T.parts) {
      const row = document.createElement('p');
      row.className = 't-parts';
      parts = T.parts.map(([text, at]) => {
        const s = document.createElement('span');
        s.textContent = text;
        row.append(s);
        return {el: s, at};
      });
      card.append(row);
    }
    // a credit (the authors, then where they work) follows the title in, line by line
    let credit = [];
    if (T.credit) {
      const box = document.createElement('div');
      box.className = 't-credit';
      credit = T.credit.map((line, i) => {
        const p = document.createElement('p');
        p.innerHTML = line;
        box.append(p);
        return {el: p, at: T.creditIn + i * 0.5};
      });
      card.append(box);
    }
    titles.append(card);
    // whole lines arrive at once where words would break a gradient; otherwise word by word
    const words = T.kind === 'brand' || T.kind === 'big' ? [main] : splitWords(main);
    const num = main.querySelector('.t-num');
    if (num && T.kind !== 'big') {
      // the counter keeps its final width, so the words after it never move
      num.style.width = `${num.offsetWidth + 1}px`;
      num.style.textAlign = 'right';
    }
    return {T, card, words, sub, parts, credit, num};
  });
  // the corner tag names the model behind what is on screen, its light pulsing on the beat
  const tags = (cut.tags ?? []).map(T => {
    const el = document.createElement('div');
    el.className = 't-tag';
    el.innerHTML = `<i></i><b>${T.name}</b><span>${T.what}</span>`;
    titles.append(el);
    return {T, el, dot: el.firstChild};
  });
  // the end card's lines follow its title in, half a beat apart
  const finaleParts = [['.finale-sub', 0.5], ['.finale-url', 1], ['.finale-links', 1.5]]
    .map(([sel, at]) => ({el: finale.querySelector(sel), at})).filter(p => p.el);

  return {
    duration: cut.beats * spb,
    at(t) {
      const b = t / spb;
      return {u: keyed(cut.u, b), intro: keyed(cut.intro, b), lidar: keyed(cut.lidar, b)};
    },
    apply(t) {
      const b = t / spb;
      for (const {T, card, words, sub, parts, credit, num} of cards) {
        const x = clamp((b - T.out) * spb / 0.35);
        const on = b >= T.in && x < 1;
        card.style.visibility = on ? 'visible' : 'hidden';
        if (!on) continue;
        card.style.opacity = (1 - x).toFixed(3);
        card.style.filter = x > 0.005 ? `blur(${(x * 7).toFixed(2)}px)` : '';
        const s = (b - T.in) * spb;
        words.forEach((w, i) => arrive(w, out3(clamp((s - i * 0.06) / 0.45))));
        if (sub) arrive(sub, out3(clamp((b - T.subIn) * spb / 0.5)));
        // the newest part is bright, the earlier ones step back
        const now = parts.filter(p => b >= p.at).pop();
        parts.forEach(p => { arrive(p.el, out3(clamp((b - p.at) * spb / 0.4))); p.el.classList.toggle('now', p === now); });
        credit.forEach(c => arrive(c.el, out3(clamp((b - c.at) * spb / 0.5))));
        if (num) num.textContent = fmt(Math.round(T.count * EASE.io(clamp((b - T.in) / (T.countTo - T.in)))));
      }
      for (const {T, el, dot} of tags) {
        const x = clamp((b - T.out) * spb / 0.35);
        const on = b >= T.in && x < 1;
        el.style.visibility = on ? 'visible' : 'hidden';
        if (!on) continue;
        const q = out3(clamp((b - T.in) * spb / 0.5));
        el.style.opacity = (q * (1 - x)).toFixed(3);
        el.style.transform = `translateX(${((1 - q) * 16).toFixed(1)}px)`;
        el.style.filter = q < 0.995 || x > 0.005 ? `blur(${((1 - q + x) * 6).toFixed(2)}px)` : '';
        dot.style.opacity = (0.4 + 0.6 * Math.exp(-(b - Math.floor(b)) * spb / 0.16)).toFixed(3);
      }
      // the four forcing views name themselves one per beat
      const heads = panels.querySelectorAll('.p-head');
      cut.pops.forEach((at, i) => {
        if (!heads[i]) return;
        const q = out3(clamp((b - at) * spb / 0.3));
        heads[i].style.opacity = q.toFixed(3);
        heads[i].style.transform = `translateY(${((1 - q) * 8).toFixed(1)}px) scale(${(0.92 + 0.08 * q).toFixed(3)})`;
      });
      // the end card's title lands on its beat, once the planet has risen, its light sweeping after
      const k = clamp((b - cut.finale) * spb / 0.35);
      finale.style.opacity = k.toFixed(3);
      finale.style.visibility = k > 0 ? 'visible' : 'hidden';
      finale.style.translate = `0 ${((1 - out3(k)) * 16).toFixed(1)}px`;
      finale.style.setProperty('--k', clamp((b - cut.finale) * spb / 1.4).toFixed(3));
      finaleParts.forEach(p => arrive(p.el, out3(clamp((b - cut.finale - p.at) * spb / 0.45))));
      fade.style.opacity = clamp((b - cut.fade[0]) / (cut.fade[1] - cut.fade[0])).toFixed(3);
    },
  };
}
