// Progressive enhancement: the document is fully visible without JavaScript.
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const sections = [...document.querySelectorAll('[data-reveal]')];
let revealObserver;

function showAllSections() {
  revealObserver?.disconnect();
  sections.forEach(section => {
    section.classList.remove('reveal-pending');
    section.classList.add('reveal-visible');
  });
}

if ('IntersectionObserver' in window && !motionPreference.matches) {
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('reveal-pending');
      entry.target.classList.add('reveal-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -35px 0px', threshold: 0.08 });

  sections.forEach(section => {
    // Do not hide content already visible, including a restored scroll position.
    if (section.getBoundingClientRect().top < window.innerHeight) return;
    section.classList.add('reveal-pending');
    revealObserver.observe(section);
  });

  // Keyboard navigation must never place focus in an invisible section.
  document.addEventListener('focusin', event => {
    const section = event.target.closest('[data-reveal]');
    if (!section) return;
    section.classList.remove('reveal-pending');
    section.classList.add('reveal-visible');
    revealObserver.unobserve(section);
  });
}

motionPreference.addEventListener('change', event => {
  if (event.matches) showAllSections();
});
