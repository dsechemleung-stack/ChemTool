function qs(sel) {
  return document.querySelector(sel);
}

let __tabHistory = [];
let __activeTab = null;

function setBackEnabled(enabled) {
  const backBtn = qs('#backBtn');
  if (!backBtn) return;
  backBtn.disabled = !enabled;
  backBtn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function setActiveTab(tabName) {
  const btns = document.querySelectorAll('.nav__btn');
  const panels = document.querySelectorAll('[data-tab-panel]');

  if (__activeTab && __activeTab !== tabName) {
    __tabHistory.push(__activeTab);
  }
  __activeTab = tabName;
  setBackEnabled(__tabHistory.length > 0);

  for (const b of btns) {
    const isActive = b.dataset.tab === tabName;
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  for (const p of panels) {
    const isActive = p.dataset.tabPanel === tabName;
    p.classList.toggle('tab--active', isActive);
  }

  if (tabName === 'graph') {
    try {
      mountChemGraph();
    } catch (_) {
      // ignore
    }
  }
}

function goBack() {
  const prev = __tabHistory.pop();
  setBackEnabled(__tabHistory.length > 0);
  if (prev) {
    __activeTab = null;
    setActiveTab(prev);
  }
}

function initWidgetNav() {
  const clickables = document.querySelectorAll('[data-nav]');
  for (const el of clickables) {
    const nav = String(el.dataset.nav || '');
    if (!nav) continue;

    const go = () => {
      if (nav.startsWith('tab:')) {
        setActiveTab(nav.slice('tab:'.length));
      }
    };

    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  }

  const homeBtn = qs('#homeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      __tabHistory = [];
      setBackEnabled(false);
      __activeTab = null;
      setActiveTab('home');
    });
  }

  const backBtn = qs('#backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => goBack());
  }
}

function initMagneticCursor() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const magnets = Array.from(document.querySelectorAll('.widgetCard--clickable, .navIconBtn'));
  if (magnets.length === 0) return;

  let mx = 0;
  let my = 0;
  let raf = 0;

  function apply() {
    raf = 0;
    for (const el of magnets) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const dx = mx - cx;
      const dy = my - cy;

      const dist = Math.hypot(dx, dy);
      const radius = Math.max(120, Math.min(260, Math.max(r.width, r.height) * 1.3));

      if (dist < radius) {
        const pull = (1 - dist / radius);
        const strength = el.classList.contains('navIconBtn') ? 12 : 18;
        const tx = (-dx / Math.max(1, dist)) * pull * strength;
        const ty = (-dy / Math.max(1, dist)) * pull * strength;
        el.style.setProperty('--mag-x', `${tx.toFixed(2)}px`);
        el.style.setProperty('--mag-y', `${ty.toFixed(2)}px`);
      } else {
        el.style.setProperty('--mag-x', '0px');
        el.style.setProperty('--mag-y', '0px');
      }
    }
  }

  window.addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    for (const el of magnets) {
      el.style.setProperty('--mag-x', '0px');
      el.style.setProperty('--mag-y', '0px');
    }
  });
}

function hashStringToSeed(str) {
  if (!str) return 0;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function initTabs() {
  const btns = document.querySelectorAll('.nav__btn');
  for (const b of btns) {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab));
  }
}

function initAnimationWidget() {
  const select = qs('#animationSelect');
  const loadBtn = qs('#loadSelectedBtn');
  const stopBtn = qs('#stopAnimationBtn');
  const swfHost = qs('#swfHost');
  const videoPlayer = qs('#videoPlayer');
  const placeholder = qs('#playerPlaceholder');
  const meta = qs('#playerMeta');
  const videoFile = qs('#videoFile');

  let rufflePlayer = null;

  function clearPlayer() {
    meta.textContent = '';

    if (rufflePlayer) {
      try {
        rufflePlayer.remove();
      } catch (_) {
        // ignore
      }
      rufflePlayer = null;
    }

    swfHost.innerHTML = '';
    swfHost.hidden = true;

    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    videoPlayer.hidden = true;

    placeholder.hidden = false;
  }

  async function loadSwf(url) {
    clearPlayer();

    const ruffle = window.RufflePlayer?.newest();
    if (!ruffle) {
      meta.textContent = 'Ruffle failed to load. Check your internet connection (CDN).';
      console.error('Ruffle not available');
      return;
    }

    swfHost.hidden = false;
    placeholder.hidden = true;

    // Configure Ruffle with compatibility settings
    const config = {
      allowScriptAccess: true,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      letterbox: 'on',
      logLevel: 'debug',
      polyfills: true,
    };
    
    rufflePlayer = ruffle.createPlayer(config);
    rufflePlayer.style.width = '100%';
    rufflePlayer.style.height = '100%';

    swfHost.appendChild(rufflePlayer);

    try {
      await rufflePlayer.load({ url });
      meta.textContent = `Loaded SWF: ${url}`;
      console.log('SWF loaded successfully:', url);
    } catch (e) {
      meta.textContent = `Failed to load SWF: ${String(e)}`;
      console.error('SWF load error:', e);
    }
  }

  function loadVideoUrl(url, label) {
    clearPlayer();

    videoPlayer.hidden = false;
    placeholder.hidden = true;

    videoPlayer.src = url;
    videoPlayer.play().catch(() => {
      // autoplay may be blocked
    });

    meta.textContent = `Loaded video: ${label || url}`;
  }

  function parseSelection(value) {
    const idx = value.indexOf(':');
    if (idx === -1) return { kind: 'unknown', src: value };
    return { kind: value.slice(0, idx), src: value.slice(idx + 1) };
  }

  loadBtn.addEventListener('click', () => {
    const v = String(select.value || '');
    const sel = parseSelection(v);

    if (sel.kind === 'swf') {
      loadSwf(sel.src);
      return;
    }

    if (sel.kind === 'video') {
      loadVideoUrl(sel.src, sel.src);
      return;
    }

    meta.textContent = 'Unknown selection.';
  });

  stopBtn.addEventListener('click', () => {
    clearPlayer();
    meta.textContent = 'Stopped.';
  });

  videoFile.addEventListener('change', () => {
    const f = videoFile.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    loadVideoUrl(url, f.name);
  });

  // Preload the SWF by default (since it's the main asset you mentioned)
  const initial = parseSelection(String(select.value || ''));
  if (initial.kind === 'swf') {
    loadSwf(initial.src);
  }
}

let __chemGraphMounted = false;
function mountChemGraph() {
  if (__chemGraphMounted) return;
  const rootEl = qs('#chemGraphRoot');
  if (!rootEl) return;
  if (!window.React || !window.ReactDOM || !window.ChemGraph) return;

  if (typeof window.ReactDOM.createRoot === 'function') {
    window.ReactDOM.createRoot(rootEl).render(window.React.createElement(window.ChemGraph));
  } else if (typeof window.ReactDOM.render === 'function') {
    window.ReactDOM.render(window.React.createElement(window.ChemGraph), rootEl);
  }

  __chemGraphMounted = true;
}

window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWidgetNav();
  initMagneticCursor();
  initAnimationWidget();
  mountChemGraph();
  setBackEnabled(false);
  __activeTab = 'home';
});
