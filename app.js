function qs(sel) {
  return document.querySelector(sel);
}

function setActiveTab(tabName) {
  const btns = document.querySelectorAll('.nav__btn');
  const panels = document.querySelectorAll('[data-tab-panel]');

  for (const b of btns) {
    const isActive = b.dataset.tab === tabName;
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  for (const p of panels) {
    const isActive = p.dataset.tabPanel === tabName;
    p.classList.toggle('tab--active', isActive);
  }
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
      return;
    }

    swfHost.hidden = false;
    placeholder.hidden = true;

    rufflePlayer = ruffle.createPlayer();
    rufflePlayer.style.width = '100%';
    rufflePlayer.style.height = '100%';

    swfHost.appendChild(rufflePlayer);

    try {
      await rufflePlayer.load({ url });
      meta.textContent = `Loaded SWF: ${url}`;
    } catch (e) {
      meta.textContent = `Failed to load SWF: ${String(e)}`;
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

function initGraphWidget() {
  const typeEl = qs('#datasetType');
  const countEl = qs('#pointCount');
  const seedEl = qs('#seed');
  const genBtn = qs('#generateGraphBtn');
  const resetBtn = qs('#resetGraphBtn');
  const meta = qs('#chartMeta');

  const ctx = qs('#chartCanvas');
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'y',
          data: [],
          borderColor: 'rgba(78, 230, 168, 0.95)',
          backgroundColor: 'rgba(78, 230, 168, 0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: 'rgba(255,255,255,0.85)' },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `y = ${Number(ctx.parsed.y).toFixed(4)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.65)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.65)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
      },
    },
  });

  function generateData(kind, count, seedStr) {
    const labels = [];
    const data = [];

    const seed = hashStringToSeed(seedStr);
    const rand = mulberry32(seed || 1);

    for (let i = 0; i < count; i++) {
      labels.push(String(i + 1));

      let y = 0;
      if (kind === 'random') {
        y = rand();
      } else if (kind === 'sine') {
        y = 0.5 + 0.45 * Math.sin((i / Math.max(1, count - 1)) * Math.PI * 2);
      } else if (kind === 'linear') {
        y = i / Math.max(1, count - 1);
      }

      data.push(y);
    }

    return { labels, data };
  }

  function applyData(kind) {
    const count = Math.max(5, Math.min(500, Number(countEl.value || 50)));
    const seedStr = String(seedEl.value || '');

    const { labels, data } = generateData(kind, count, seedStr);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = `${kind} (n=${count})`;
    chart.update();

    meta.textContent = `Generated ${kind} dataset with ${count} points.`;
  }

  genBtn.addEventListener('click', () => applyData(String(typeEl.value)));

  resetBtn.addEventListener('click', () => {
    seedEl.value = '';
    countEl.value = '50';
    typeEl.value = 'random';
    applyData('random');
  });

  applyData('random');
}

window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initAnimationWidget();
  initGraphWidget();
});
