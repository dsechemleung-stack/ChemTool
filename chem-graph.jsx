import { useState, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════
//  CHEMICAL TEXT PARSER
//  "h2so4"  → H · ₂ · S · O · ₄
//  "cu2+"   → Cu · ²⁺          (digits before +/- = charge, not subscript)
//  "fe3+"   → Fe · ³⁺
//  "nh3(g)" → N · H · ₃ · (g)
//  "^2-"    → ²⁻  (explicit ^)
//  "(2-)"   → ²⁻  (parenthesised charge)
// ═══════════════════════════════════════════════════════════════════
function parseChemSegments(raw) {
  const segs = [];
  const s = String(raw).trim();
  let i = 0;
  const push = (type, text) => { if (text !== '' && text != null) segs.push({ type, text }); };

  while (i < s.length) {

    // ── Explicit ^ superscript
    if (s[i] === '^') {
      i++;
      let sup = '';
      while (i < s.length && s[i] !== ' ' && s[i] !== '^' && s[i] !== '(') sup += s[i++];
      push('sup', sup);
      continue;
    }

    // ── Parenthesised group: state symbols (g)(aq) or charges (2-)(3+)
    if (s[i] === '(') {
      const end = s.indexOf(')', i);
      if (end !== -1) {
        const inside = s.slice(i + 1, end);
        if (/^[\d]*[+-]+$/.test(inside) || /^[+-][\d]*$/.test(inside)) {
          push('sup', inside);
        } else {
          push('normal', '(' + inside + ')');
        }
        i = end + 1;
        continue;
      }
    }

    // ── Element starting with uppercase (possibly followed by lowercase)
    if (s[i] >= 'A' && s[i] <= 'Z') {
      let elem = s[i++];
      while (i < s.length && s[i] >= 'a' && s[i] <= 'z') elem += s[i++];
      push('normal', elem);

      // Look ahead: consume digits, then decide sub vs charge
      let digits = '';
      while (i < s.length && s[i] >= '0' && s[i] <= '9') digits += s[i++];

      if (digits) {
        // Digits immediately followed by +/- → they are part of a charge (superscript)
        if (i < s.length && (s[i] === '+' || s[i] === '-')) {
          let charge = digits;
          while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
          push('sup', charge);
        } else {
          // Subscript (formula stoichiometry)
          push('sub', digits);
          // Now check for a standalone charge sign (no digits) e.g. Fe+ after Fe
          if (i < s.length && (s[i] === '+' || s[i] === '-')) {
            const nxt = s[i + 1];
            if (!nxt || nxt === '(' || nxt === ' ' || (nxt >= 'A' && nxt <= 'Z')) {
              let charge = '';
              while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
              push('sup', charge);
            }
          }
        }
      } else {
        // No digits — check for bare charge: Cu+ Fe3+ but digits handled above
        if (i < s.length && (s[i] === '+' || s[i] === '-')) {
          const nxt = s[i + 1];
          if (!nxt || nxt === '(' || nxt === ' ' || (nxt >= 'A' && nxt <= 'Z')) {
            let charge = '';
            while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
            push('sup', charge);
          }
        }
      }
      continue;
    }

    // ── Lowercase run → capitalise first letter (user typed e.g. "nh3" or "cu")
    if (s[i] >= 'a' && s[i] <= 'z') {
      let word = '';
      while (i < s.length && s[i] >= 'a' && s[i] <= 'z') word += s[i++];
      push('normal', word[0].toUpperCase() + word.slice(1));

      // digits after
      let digits = '';
      while (i < s.length && s[i] >= '0' && s[i] <= '9') digits += s[i++];

      if (digits) {
        if (i < s.length && (s[i] === '+' || s[i] === '-')) {
          let charge = digits;
          while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
          push('sup', charge);
        } else {
          push('sub', digits);
          // bare charge after subscript
          if (i < s.length && (s[i] === '+' || s[i] === '-')) {
            const nxt = s[i + 1];
            if (!nxt || nxt === '(' || nxt === ' ' || (nxt >= 'A' && nxt <= 'Z')) {
              let charge = '';
              while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
              push('sup', charge);
            }
          }
        }
      } else {
        if (i < s.length && (s[i] === '+' || s[i] === '-')) {
          const nxt = s[i + 1];
          if (!nxt || nxt === '(' || nxt === ' ' || (nxt >= 'A' && nxt <= 'Z')) {
            let charge = '';
            while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
            push('sup', charge);
          }
        }
      }
      continue;
    }

    // ── Standalone digits
    if (s[i] >= '0' && s[i] <= '9') {
      let num = '';
      while (i < s.length && s[i] >= '0' && s[i] <= '9') num += s[i++];
      if (i < s.length && (s[i] === '+' || s[i] === '-')) {
        let charge = num;
        while (i < s.length && (s[i] === '+' || s[i] === '-')) charge += s[i++];
        push('sup', charge);
      } else {
        // coefficient or trailing number — normal
        push('normal', num);
      }
      continue;
    }

    // ── Bare + or -
    if (s[i] === '+' || s[i] === '-') {
      let ch = '';
      while (i < s.length && (s[i] === '+' || s[i] === '-')) ch += s[i++];
      push('sup', ch);
      continue;
    }

    // ── Everything else (spaces, slashes, arrows…)
    push('normal', s[i++]);
  }

  return segs;
}

// ─── SVG sub/superscript renderer ─────────────────────────────────
// Uses CUMULATIVE dy approach (sibling tspans) — no nesting — reliably
// resets baseline in all browsers.
function ChemTspans({ segs, color, fontSize }) {
  const subDy  =  Math.round(fontSize * 0.37);
  const supDy  = -Math.round(fontSize * 0.40);
  const subSz  =  Math.round(fontSize * 0.71);
  const supSz  =  Math.round(fontSize * 0.71);

  const result = [];
  let dyOff = 0; // cumulative y offset from baseline currently

  segs.forEach((seg, idx) => {
    if (seg.type === 'sub') {
      result.push(
        <tspan key={idx} dy={subDy - dyOff} fontSize={subSz} fill={color}>{seg.text}</tspan>
      );
      dyOff = subDy;
    } else if (seg.type === 'sup') {
      result.push(
        <tspan key={idx} dy={supDy - dyOff} fontSize={supSz} fill={color}>{seg.text}</tspan>
      );
      dyOff = supDy;
    } else {
      result.push(
        <tspan key={idx} dy={dyOff === 0 ? 0 : -dyOff} fontSize={fontSize} fill={color}>{seg.text}</tspan>
      );
      dyOff = 0;
    }
  });

  // Final baseline reset if we ended on a super/sub
  if (dyOff !== 0) {
    result.push(<tspan key="__reset" dy={-dyOff} fontSize={fontSize}>{''}</tspan>);
  }

  return result;
}

// Approximate rendered width of chem segments
function chemWidth(segs, fs) {
  return segs.reduce((w, s) => {
    const sz = s.type === 'normal' ? fs : fs * 0.71;
    return w + s.text.length * sz * 0.6;
  }, 0);
}

// ─── Axis label parser: handles dm-3 → dm + sup(-3), ^2 → sup(2) ─
function parseAxisSegs(str) {
  const segs = [];
  let i = 0;
  const push = (type, text) => { if (text) segs.push({ type, text }); };
  while (i < str.length) {
    if (str[i] === '^') {
      i++;
      let s = '';
      while (i < str.length && str[i] !== ' ' && str[i] !== '/') s += str[i++];
      push('sup', s);
      continue;
    }
    // Negative exponent after letter/digit: dm-3, m-2
    if (str[i] === '-' && i > 0 && /[\w]/.test(str[i - 1])) {
      let exp = '-';
      i++;
      while (i < str.length && /\d/.test(str[i])) exp += str[i++];
      if (exp.length > 1) { push('sup', exp); continue; }
      push('normal', exp); continue;
    }
    push('normal', str[i++]);
  }
  return segs;
}

// ─── Curve fitting: C(t) = a + b·exp(−k·t) ───────────────────────
function fitExp(pts) {
  if (!pts || pts.length < 3) return null;
  const ts = pts.map(p => p[0]), cs = pts.map(p => p[1]);
  let bestA = cs[cs.length - 1], bestB = cs[0] - bestA, bestK = 0.05, bestErr = Infinity;
  for (let ki = 1; ki <= 1400; ki++) {
    const k = ki * 0.003;
    const us = ts.map(t => Math.exp(-k * t));
    const n = pts.length;
    const su  = us.reduce((a, u) => a + u, 0);
    const su2 = us.reduce((a, u) => a + u * u, 0);
    const sc  = cs.reduce((a, c) => a + c, 0);
    const scu = us.reduce((a, u, i) => a + u * cs[i], 0);
    const D = n * su2 - su * su;
    if (Math.abs(D) < 1e-12) continue;
    const b = (n * scu - su * sc) / D;
    const a = (sc - b * su) / n;
    const err = pts.reduce((s, p) => { const d = p[1] - a - b * Math.exp(-k * p[0]); return s + d * d; }, 0);
    if (err < bestErr) { bestErr = err; bestK = k; bestA = a; bestB = b; }
  }
  return { a: bestA, b: bestB, k: bestK };
}
function evalFit(f, t) { return f.a + f.b * Math.exp(-f.k * t); }
function parseCSV(raw) {
  return (raw || '').split(/[\n;]/).map(l => {
    const p = l.split(',').map(s => parseFloat(s.trim()));
    return p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]) ? [p[0], p[1]] : null;
  }).filter(Boolean);
}
function parseEqSpecies(eq) {
  const m = eq.match(/^(.+?)\s*(?:→|->|⇌|<->|<=>|=)\s*(.+)$/);
  if (!m) return null;
  const side = s => s.split('+').map(t => {
    const r = t.trim().match(/^(\d*\.?\d+)?\s*(.+)$/);
    return r ? { coeff: r[1] ? +r[1] : 1, name: r[2].trim() } : null;
  }).filter(Boolean);
  return { reactants: side(m[1]), products: side(m[2]) };
}
function fmtNum(v) {
  const r = Math.round(v * 10000) / 10000;
  return r === Math.floor(r) ? String(Math.floor(r)) : String(r);
}

const COLORS = ['#111111','#c0392b','#2471a3','#1e8449','#7d3c98','#d35400','#148f77','#922b21'];
const TF = { fontFamily: "'Times New Roman', Times, serif" };

const DEFAULT_SPECIES = [{
  id: 1, name: 'Q(g)',
  raw: '0,1\n5,0.75\n10,0.45\n20,0.15\n40,0.025\n60,0.005',
  directFit: null, visible: true, labelVisible: true,
  lx: 365, ly: 322, color: '#111111'
}];

// ─── Reusable UI atoms ────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ ...TF, fontSize: 13.5, fontWeight: 'bold', borderBottom: '1.5px solid #ccc', paddingBottom: 4, marginBottom: 9, color: '#1a1a1a' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Chip({ active, onToggle, children, activeColor = '#27ae60', style = {} }) {
  return (
    <button onClick={onToggle} style={{
      ...TF, padding: '2px 8px', border: 'none', borderRadius: 10, cursor: 'pointer',
      fontSize: 10, lineHeight: 1.7, whiteSpace: 'nowrap', transition: 'background .15s',
      background: active ? activeColor : '#aaa', color: 'white', ...style
    }}>{children}</button>
  );
}

function NumInput({ label, value, onChange, step, min }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 2, color: '#444' }}>{label}</div>
      <input type="number" value={value} step={step} min={min}
        onChange={e => onChange(e.target.value)}
        style={{ ...TF, width: '100%', padding: '3px 6px', border: '1px solid #c8c8c8', fontSize: 12, boxSizing: 'border-box', borderRadius: 3, background: '#fff' }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════
export default function ChemGraph() {
  const SW = 750, SH = 540;
  const PAD = { t: 32, r: 60, b: 72, l: 94 };
  const PW = SW - PAD.l - PAD.r;
  const PH = SH - PAD.t - PAD.b;

  // ── Settings
  const [yLabel, setYLabel]     = useState('concentration / mol dm-3');
  const [xLabel, setXLabel]     = useState('time / s');
  const [yMax,   setYMax]       = useState(2);
  const [xMax,   setXMax]       = useState(60);
  const [yGrid,  setYGrid]      = useState(20);
  const [xGrid,  setXGrid]      = useState(30);
  const [fontSize, setFontSize] = useState(14);
  const [showMajorGrid,  setShowMajorGrid]  = useState(true);
  const [showMinorGrid,  setShowMinorGrid]  = useState(true);

  // ── Equation & auto curves
  const [equation,      setEquation]      = useState('Q(g) -> 2P(g)');
  const [autoSpecies,   setAutoSpecies]   = useState([]);
  // Which species to use as stoichiometry reference (null = first)
  const [refSpeciesId,  setRefSpeciesId]  = useState(null);

  // ── Manual species
  const [species, setSpecies] = useState(DEFAULT_SPECIES);

  // ── Draw mode
  const [drawMode,   setDrawMode]   = useState(false);
  const [drawColor,  setDrawColor]  = useState('#c0392b');
  const [drawName,   setDrawName]   = useState('');
  const [liveStroke, setLiveStroke] = useState([]);
  const isDrawing  = useRef(false);
  const strokePts  = useRef([]);

  // ── Label drag
  const [dragging, setDragging] = useState(null);
  const svgRef = useRef(null);

  // ── Clear All
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearAll = () => {
    setSpecies(DEFAULT_SPECIES);
    setAutoSpecies([]);
    setRefSpeciesId(null);
    setDrawMode(false);
    setLiveStroke([]);
    isDrawing.current = false;
    strokePts.current = [];
    setShowClearConfirm(false);
  };

  // ── Coordinate transforms
  const tx  = useCallback(x  => PAD.l + (x  / xMax) * PW, [xMax, PW]);
  const ty  = useCallback(y  => PAD.t + (1 - y / yMax) * PH, [yMax, PH]);
  const itx = useCallback(px => ((px - PAD.l) / PW) * xMax, [xMax, PW]);
  const ity = useCallback(py => (1 - (py - PAD.t) / PH) * yMax, [yMax, PH]);

  const getSvgPt = useCallback(e => {
    const r = svgRef.current.getBoundingClientRect();
    return { px: (e.clientX - r.left) * (SW / r.width), py: (e.clientY - r.top) * (SH / r.height) };
  }, [SW, SH]);

  const inPlot = useCallback(({ px, py }) =>
    px >= PAD.l && px <= PAD.l + PW && py >= PAD.t && py <= PAD.t + PH,
    [PAD, PW, PH]);

  // ── Curve path
  const curvePath = useCallback((fit, steps = 450) => {
    return 'M' + Array.from({ length: steps + 1 }, (_, i) => {
      const t = (i / steps) * xMax;
      return `${tx(t).toFixed(2)},${ty(Math.max(0, evalFit(fit, t))).toFixed(2)}`;
    }).join(' L');
  }, [xMax, tx, ty]);

  // ── Fits
  const fits = useMemo(() =>
    species.map(s => ({ id: s.id, fit: s.directFit ?? fitExp(parseCSV(s.raw)) })),
    [species]);

  // ── Mouse handlers
  const onSvgMouseDown = useCallback(e => {
    if (drawMode) {
      const pt = getSvgPt(e);
      if (inPlot(pt)) {
        isDrawing.current = true;
        strokePts.current = [[pt.px, pt.py]];
        setLiveStroke([[pt.px, pt.py]]);
        e.preventDefault();
      }
    }
  }, [drawMode, getSvgPt, inPlot]);

  const onSvgMouseMove = useCallback(e => {
    if (drawMode && isDrawing.current) {
      const { px, py } = getSvgPt(e);
      strokePts.current.push([px, py]);
      if (strokePts.current.length % 3 === 0) setLiveStroke([...strokePts.current]);
      return;
    }
    if (!dragging) return;
    const { px, py } = getSvgPt(e);
    const upd = s => s.id === dragging.id ? { ...s, lx: px, ly: py } : s;
    dragging.isAuto ? setAutoSpecies(p => p.map(upd)) : setSpecies(p => p.map(upd));
  }, [drawMode, dragging, getSvgPt]);

  function downsample(arr, n) {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
  }

  const onSvgMouseUp = useCallback(() => {
    if (drawMode && isDrawing.current) {
      isDrawing.current = false;
      const raw = strokePts.current;
      strokePts.current = [];
      setLiveStroke([]);
      if (raw.length >= 5) {
        const dataPts = raw
          .filter(([px, py]) => inPlot({ px, py }))
          .map(([px, py]) => [Math.max(0, itx(px)), Math.max(0, ity(py))]);
        dataPts.sort((a, b) => a[0] - b[0]);
        const fit = fitExp(downsample(dataPts, 50));
        if (fit) {
          const name = drawName.trim() || `Curve ${Date.now().toString().slice(-3)}`;
          // Back-sample the fitted curve at 20 evenly-spaced points so stoichiometry
          // generation can use this species as the reference, exactly like typed data.
          const backSampleN = 20;
          const backRaw = Array.from({ length: backSampleN }, (_, i) => {
            const t = (i / (backSampleN - 1)) * xMax;
            const c = Math.max(0, evalFit(fit, t));
            return `${parseFloat(t.toFixed(4))},${parseFloat(c.toFixed(6))}`;
          }).join('\n');
          setSpecies(prev => [...prev, {
            id: Date.now(), name, raw: backRaw, directFit: fit,
            visible: true, labelVisible: true, color: drawColor,
            lx: PAD.l + PW * 0.62, ly: PAD.t + PH * 0.28
          }]);
          setDrawName('');
        }
      }
      return;
    }
    setDragging(null);
  }, [drawMode, drawName, drawColor, inPlot, itx, ity, PAD, PW, PH]);

  const onLabelMouseDown = useCallback((e, id, isAuto) => {
    if (drawMode) return;
    e.stopPropagation(); e.preventDefault();
    setDragging({ id, isAuto });
  }, [drawMode]);

  // ── Stoichiometry generation
  const generateAuto = useCallback(() => {
    const parsed = parseEqSpecies(equation);
    if (!parsed) { alert("Couldn't parse equation. Use e.g.: Q(g) -> 2P(g)"); return; }

    // Use the selected reference species (or fall back to first)
    const refSpecies = (refSpeciesId && species.find(s => s.id === refSpeciesId)) || species[0];
    if (!refSpecies) { alert('No reference species found.'); return; }

    const refFit = refSpecies.directFit ?? fitExp(parseCSV(refSpecies.raw));
    if (!refFit) { alert(`Need valid data for reference species "${refSpecies.name}".`); return; }

    const refName = refSpecies.name.trim();
    const inR   = parsed.reactants.some(r => r.name === refName);
    const entry = inR
      ? parsed.reactants.find(r => r.name === refName)
      : parsed.products.find(p => p.name === refName);
    const fc    = entry?.coeff ?? 1;

    const c0    = evalFit(refFit, 0);
    const cinf  = refFit.a;
    const delta = c0 - cinf;

    const newAuto = []; let ci = 1;
    [...parsed.reactants, ...parsed.products].forEach(sp => {
      if (sp.name === refName) return;
      const spInR   = parsed.reactants.some(r => r.name === sp.name);
      const ratio   = sp.coeff / fc;
      const sameDir = inR === spInR;
      const sp0     = sameDir ? (c0 * sp.coeff) / fc : 0;
      const spInf   = sameDir ? sp0 - ratio * delta : ratio * delta;
      newAuto.push({
        id: `auto_${sp.name}_${ci}_${Date.now()}`,
        name: sp.name,
        fit: { a: spInf, b: sp0 - spInf, k: refFit.k },
        visible: true, labelVisible: true,
        color: COLORS[ci % COLORS.length],
        lx: PAD.l + PW * 0.74,
        ly: PAD.t + PH * (0.08 + ci * 0.2)
      });
      ci++;
    });
    setAutoSpecies(newAuto);
  }, [equation, species, refSpeciesId, PAD, PW, PH]);

  // ── Grid derived
  const yMajStep = Math.max(1, Math.round(yGrid / 5));
  const xMajStep = Math.max(1, Math.round(xGrid / 5));
  const yStep = yMax / yGrid;
  const xStep = xMax / xGrid;

  const allCurves = useMemo(() => [
    ...species.map(s => ({ ...s, fit: fits.find(f => f.id === s.id)?.fit, isAuto: false })),
    ...autoSpecies.map(s => ({ ...s, isAuto: true }))
  ], [species, autoSpecies, fits]);

  const livePathStr = liveStroke.length > 1
    ? 'M' + liveStroke.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')
    : null;

  // ── Axis label renderer (shared sub/sup logic for axis)
  function AxisSegs({ str, fs }) {
    const segs = parseAxisSegs(str);
    const result = [];
    let dyOff = 0;
    const subDy = Math.round(fs * 0.37), supDy = -Math.round(fs * 0.40);
    const subSz = Math.round(fs * 0.71), supSz = Math.round(fs * 0.71);
    segs.forEach((seg, idx) => {
      if (seg.type === 'sub') {
        result.push(<tspan key={idx} dy={subDy - dyOff} fontSize={subSz}>{seg.text}</tspan>);
        dyOff = subDy;
      } else if (seg.type === 'sup') {
        result.push(<tspan key={idx} dy={supDy - dyOff} fontSize={supSz}>{seg.text}</tspan>);
        dyOff = supDy;
      } else {
        result.push(<tspan key={idx} dy={-dyOff} fontSize={fs}>{seg.text}</tspan>);
        dyOff = 0;
      }
    });
    if (dyOff !== 0) result.push(<tspan key="r" dy={-dyOff} fontSize={fs}>{''}</tspan>);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...TF, display: 'flex', minHeight: '100vh', background: '#e9e2d4', padding: 16, gap: 16, boxSizing: 'border-box' }}>

      {/* ═══════ PANEL ═══════ */}
      <div style={{
        width: 290, flexShrink: 0, background: '#f9f7f2', borderRadius: 7,
        padding: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.16)',
        overflowY: 'auto', maxHeight: 'calc(100vh - 32px)', boxSizing: 'border-box'
      }}>

        {/* Clear All */}
        {!showClearConfirm ? (
          <button onClick={() => setShowClearConfirm(true)}
            style={{ ...TF, width: '100%', marginBottom: 14, padding: '6px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12.5 }}>
            🗑 Clear All
          </button>
        ) : (
          <div style={{ marginBottom: 14, padding: '8px', background: '#fdedec', border: '1px solid #e74c3c', borderRadius: 5 }}>
            <div style={{ ...TF, fontSize: 11.5, color: '#922b21', marginBottom: 6 }}>Reset everything to defaults?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={clearAll}
                style={{ ...TF, flex: 1, padding: '4px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}>Yes, clear</button>
              <button onClick={() => setShowClearConfirm(false)}
                style={{ ...TF, flex: 1, padding: '4px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Graph Settings */}
        <Section title="⬜ Graph Settings">
          {[['Y-axis label', yLabel, setYLabel], ['X-axis label', xLabel, setXLabel]].map(([lbl, val, set]) => (
            <div key={lbl} style={{ marginBottom: 8 }}>
              <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 2, color: '#444' }}>{lbl}</div>
              <input value={val} onChange={e => set(e.target.value)}
                style={{ ...TF, width: '100%', padding: '4px 7px', border: '1px solid #c8c8c8', fontSize: 12, boxSizing: 'border-box', background: '#fff', borderRadius: 3 }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
            <NumInput label="Y max" value={yMax} onChange={v => setYMax(+v || 1)} />
            <NumInput label="X max" value={xMax} onChange={v => setXMax(+v || 1)} />
          </div>
          <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
            <NumInput label="Y grids (×5)" value={yGrid} step={5} min={5}
              onChange={v => setYGrid(Math.max(5, Math.round(+v / 5) * 5))} />
            <NumInput label="X grids (×5)" value={xGrid} step={5} min={5}
              onChange={v => setXGrid(Math.max(5, Math.round(+v / 5) * 5))} />
          </div>

          {/* Font size */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 3, color: '#444' }}>
              Font size — <span style={{ color: '#2471a3', fontWeight: 'normal' }}>{fontSize}px</span>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <input type="range" min={9} max={24} value={fontSize}
                onChange={e => setFontSize(+e.target.value)}
                style={{ flex: 1, accentColor: '#2471a3' }} />
              <input type="number" min={9} max={24} value={fontSize}
                onChange={e => setFontSize(Math.min(24, Math.max(9, +e.target.value)))}
                style={{ ...TF, width: 42, padding: '3px 5px', border: '1px solid #c8c8c8', fontSize: 12, textAlign: 'center', borderRadius: 3 }} />
            </div>
          </div>

          {/* Grid visibility */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Chip active={showMajorGrid} onToggle={() => setShowMajorGrid(v => !v)} activeColor="#555">
              {showMajorGrid ? '▦ Major grid' : '□ Major grid'}
            </Chip>
            <Chip active={showMinorGrid} onToggle={() => setShowMinorGrid(v => !v)} activeColor="#888">
              {showMinorGrid ? '▪ Minor grid' : '· Minor grid'}
            </Chip>
          </div>
        </Section>

        {/* ── Draw Mode */}
        <Section title="✏️ Draw a Curve">
          <div style={{ ...TF, fontSize: 10.5, color: '#666', marginBottom: 7, lineHeight: 1.5 }}>
            Enable draw mode, sketch freehand on the graph. Release to auto-fit a reaction-shaped exponential curve.
          </div>
          <div style={{ display: 'flex', gap: 7, marginBottom: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 2, color: '#444' }}>Label for drawn curve</div>
              <input value={drawName} onChange={e => setDrawName(e.target.value)} placeholder="e.g. NH3"
                style={{ ...TF, width: '100%', padding: '4px 7px', border: '1px solid #c8c8c8', fontSize: 12, boxSizing: 'border-box', borderRadius: 3 }} />
            </div>
            <div>
              <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 2, color: '#444' }}>Color</div>
              <input type="color" value={drawColor} onChange={e => setDrawColor(e.target.value)}
                style={{ width: 34, height: 27, padding: 0, border: '1px solid #ccc', cursor: 'pointer', borderRadius: 3, display: 'block' }} />
            </div>
          </div>
          <button onClick={() => { setDrawMode(d => !d); setLiveStroke([]); isDrawing.current = false; }}
            style={{
              ...TF, width: '100%', padding: '7px', border: 'none', borderRadius: 5,
              cursor: 'pointer', fontSize: 13, fontWeight: 'bold', transition: 'all .2s',
              background: drawMode ? '#922b21' : '#7d3c98', color: 'white',
              boxShadow: drawMode ? '0 0 0 3px #f1948a55' : 'none'
            }}>
            {drawMode ? '🔴 Drawing ON — click to stop' : '✏️ Enable Draw Mode'}
          </button>
          {drawMode && (
            <div style={{ marginTop: 6, padding: '5px 8px', background: '#f5eeff', border: '1px solid #c39bd3', borderRadius: 4 }}>
              <span style={{ ...TF, fontSize: 10.5, color: '#6c3483' }}>Click &amp; drag inside the graph. Release to fit curve.</span>
            </div>
          )}
        </Section>

        {/* ── Species Data */}
        <Section title="⚗️ Species Data">
          {species.map(s => (
            <div key={s.id} style={{ border: '1px solid #d4d4d4', borderRadius: 5, padding: 9, marginBottom: 9, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <input value={s.name}
                  onChange={e => setSpecies(p => p.map(x => x.id === s.id ? { ...x, name: e.target.value } : x))}
                  placeholder="e.g. H2SO4(aq)"
                  style={{ ...TF, flex: 1, minWidth: 55, padding: '3px 6px', border: '1px solid #ccc', fontSize: 12.5, borderRadius: 3 }} />
                <input type="color" value={s.color}
                  onChange={e => setSpecies(p => p.map(x => x.id === s.id ? { ...x, color: e.target.value } : x))}
                  style={{ width: 26, height: 24, padding: 0, border: '1px solid #ccc', cursor: 'pointer', borderRadius: 2 }} />
                <Chip active={s.visible}
                  onToggle={() => setSpecies(p => p.map(x => x.id === s.id ? { ...x, visible: !x.visible } : x))}>
                  {s.visible ? '● Curve' : '○ Curve'}
                </Chip>
                <Chip active={s.labelVisible} activeColor="#2471a3"
                  onToggle={() => setSpecies(p => p.map(x => x.id === s.id ? { ...x, labelVisible: !x.labelVisible } : x))}>
                  {s.labelVisible ? '● Label' : '○ Label'}
                </Chip>
                {species.length > 1 && (
                  <button onClick={() => setSpecies(p => p.filter(x => x.id !== s.id))}
                    style={{ ...TF, background: '#c0392b', color: 'white', border: 'none', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: 12 }}>×</button>
                )}
              </div>
              {s.directFit ? (
                <div style={{ ...TF, fontSize: 10.5, color: '#7d5a2a', padding: '4px 7px', background: '#fdf5e4', border: '1px solid #e8d5a0', borderRadius: 3 }}>
                  ✏️ Drawn — a={fmtNum(s.directFit.a)} b={fmtNum(s.directFit.b)} k={fmtNum(s.directFit.k)}
                  <span style={{ color: '#1e8449', marginLeft: 6 }}>· {parseCSV(s.raw).length} pts back-sampled ✓</span>
                  <button onClick={() => setSpecies(p => p.map(x => x.id === s.id ? { ...x, directFit: null, raw: '' } : x))}
                    style={{ ...TF, marginLeft: 8, background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 10.5, textDecoration: 'underline' }}>
                    clear
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ ...TF, fontSize: 10, color: '#888', marginBottom: 2 }}>Data — time, conc per line:</div>
                  <textarea value={s.raw}
                    onChange={e => setSpecies(p => p.map(x => x.id === s.id ? { ...x, raw: e.target.value } : x))}
                    rows={4} style={{ width: '100%', fontSize: 11.5, padding: 4, border: '1px solid #ccc', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'monospace', borderRadius: 3 }} />
                </>
              )}
            </div>
          ))}
          <button onClick={() => setSpecies(p => [...p, {
            id: Date.now(), name: `Species ${p.length + 1}`,
            raw: '0,0.5\n20,0.3\n60,0.1', directFit: null,
            visible: true, labelVisible: true,
            color: COLORS[(p.length + 1) % COLORS.length],
            lx: PAD.l + PW * 0.5, ly: PAD.t + PH * 0.4
          }])}
            style={{ ...TF, width: '100%', padding: '6px', background: '#2c3e50', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
            + Add Species
          </button>
        </Section>

        {/* ── Stoichiometry */}
        <Section title="⚖️ Stoichiometry">
          <div style={{ ...TF, fontSize: 10.5, color: '#666', marginBottom: 5, lineHeight: 1.5 }}>
            Generates curves for all other species in the equation from any reference species — including drawn curves. Supports: → ⇌ -&gt;
          </div>

          {/* Reference species selector */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...TF, fontSize: 10.5, fontWeight: 'bold', marginBottom: 3, color: '#444' }}>
              Reference species (whose data drives the calculation)
            </div>
            <select
              value={refSpeciesId ?? ''}
              onChange={e => setRefSpeciesId(e.target.value === '' ? null : Number(e.target.value))}
              style={{ ...TF, width: '100%', padding: '4px 7px', border: '1px solid #c8c8c8', fontSize: 12.5, boxSizing: 'border-box', background: '#fff', borderRadius: 3, cursor: 'pointer' }}
            >
              {species.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {s.name || `Species ${i + 1}`}{s.directFit ? ' [drawn]' : ''}
                  {i === 0 && !refSpeciesId ? ' (default)' : ''}
                </option>
              ))}
            </select>
            {(() => {
              const ref = (refSpeciesId && species.find(s => s.id === refSpeciesId)) || species[0];
              const hasFit = ref && (ref.directFit || parseCSV(ref.raw).length >= 3);
              return ref ? (
                <div style={{ ...TF, fontSize: 10, marginTop: 3, color: hasFit ? '#1e8449' : '#c0392b' }}>
                  {hasFit
                    ? `✓ "${ref.name}" has ${ref.directFit ? 'drawn fit' : parseCSV(ref.raw).length + ' data points'} — ready`
                    : `✗ "${ref.name}" needs ≥3 data points or a drawn curve`}
                </div>
              ) : null;
            })()}
          </div>

          <input value={equation} onChange={e => setEquation(e.target.value)}
            style={{ ...TF, width: '100%', padding: '4px 7px', border: '1px solid #c8c8c8', marginBottom: 7, fontSize: 12.5, boxSizing: 'border-box', background: '#fff', borderRadius: 3 }}
            placeholder="e.g. Q(g) -> 2P(g)" />
          <button onClick={generateAuto}
            style={{ ...TF, width: '100%', padding: '6px', background: '#1e8449', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
            Generate Stoichiometric Curves
          </button>
          {autoSpecies.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {autoSpecies.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
                  <div style={{ width: 20, height: 3, background: s.color, borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ ...TF, fontSize: 12, flex: 1 }}>{s.name}</span>
                  <Chip active={s.visible}
                    onToggle={() => setAutoSpecies(p => p.map(x => x.id === s.id ? { ...x, visible: !x.visible } : x))}>
                    {s.visible ? '● Curve' : '○ Curve'}
                  </Chip>
                  <Chip active={s.labelVisible} activeColor="#2471a3"
                    onToggle={() => setAutoSpecies(p => p.map(x => x.id === s.id ? { ...x, labelVisible: !x.labelVisible } : x))}>
                    {s.labelVisible ? '● Label' : '○ Label'}
                  </Chip>
                </div>
              ))}
              <button onClick={() => setAutoSpecies([])}
                style={{ ...TF, marginTop: 5, width: '100%', padding: '4px', background: '#922b21', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                Clear Generated
              </button>
            </div>
          )}
        </Section>

        <div style={{ padding: '7px 9px', background: '#f0ede3', borderRadius: 4, border: '1px solid #d9d4c0' }}>
          <div style={{ ...TF, fontSize: 10, color: '#666', lineHeight: 1.6 }}>
            <strong>Tips:</strong> Axis labels: <code>dm-3</code>→dm⁻³, <code>^2</code>→².<br />
            Species: <code>h2so4</code>→H₂SO₄, <code>cu2+</code>→Cu²⁺.<br />
            Drawn curves are back-sampled → usable as stoichiometry reference.<br />
            Drag labels. Toggle chips to hide curve or label independently.
          </div>
        </div>
      </div>

      {/* ═══════ SVG ═══════ */}
      <div style={{ flex: 1, background: 'white', borderRadius: 7, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.14)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'hidden' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SW} ${SH}`}
          width="100%"
          style={{ maxWidth: SW, userSelect: 'none', touchAction: 'none', cursor: drawMode ? 'crosshair' : (dragging ? 'grabbing' : 'default') }}
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
        >
          <defs>
            <clipPath id="pc"><rect x={PAD.l} y={PAD.t} width={PW} height={PH} /></clipPath>
          </defs>
          <rect x={0} y={0} width={SW} height={SH} fill="white" />

          {/* ── Minor grid */}
          {showMinorGrid && Array.from({ length: yGrid - 1 }, (_, i) => {
            const v = (i + 1) * yStep;
            const maj = (i + 1) % yMajStep === 0;
            if (maj) return null; // drawn by major grid
            return <line key={`ymn${i}`} x1={PAD.l} y1={ty(v)} x2={PAD.l + PW} y2={ty(v)} stroke="#e4e4e4" strokeWidth={0.4} />;
          })}
          {showMinorGrid && Array.from({ length: xGrid - 1 }, (_, i) => {
            const v = (i + 1) * xStep;
            const maj = (i + 1) % xMajStep === 0;
            if (maj) return null;
            return <line key={`xmn${i}`} x1={tx(v)} y1={PAD.t} x2={tx(v)} y2={PAD.t + PH} stroke="#e4e4e4" strokeWidth={0.4} />;
          })}

          {/* ── Major grid */}
          {showMajorGrid && Array.from({ length: yGrid - 1 }, (_, i) => {
            if ((i + 1) % yMajStep !== 0) return null;
            const v = (i + 1) * yStep;
            return <line key={`ymj${i}`} x1={PAD.l} y1={ty(v)} x2={PAD.l + PW} y2={ty(v)} stroke="#c0c0c0" strokeWidth={0.7} />;
          })}
          {showMajorGrid && Array.from({ length: xGrid - 1 }, (_, i) => {
            if ((i + 1) % xMajStep !== 0) return null;
            const v = (i + 1) * xStep;
            return <line key={`xmj${i}`} x1={tx(v)} y1={PAD.t} x2={tx(v)} y2={PAD.t + PH} stroke="#c0c0c0" strokeWidth={0.7} />;
          })}

          {/* ── Axes */}
          <line x1={PAD.l} y1={PAD.t}      x2={PAD.l}      y2={PAD.t + PH} stroke="black" strokeWidth={2} />
          <line x1={PAD.l} y1={PAD.t + PH} x2={PAD.l + PW} y2={PAD.t + PH} stroke="black" strokeWidth={2} />
          <polygon points={`${PAD.l},${PAD.t - 11} ${PAD.l - 4.5},${PAD.t + 2} ${PAD.l + 4.5},${PAD.t + 2}`} fill="black" />
          <polygon points={`${PAD.l + PW + 11},${PAD.t + PH} ${PAD.l + PW - 2},${PAD.t + PH - 4.5} ${PAD.l + PW - 2},${PAD.t + PH + 4.5}`} fill="black" />

          {/* ── Y ticks */}
          {Array.from({ length: yGrid + 1 }, (_, i) => {
            if (i % yMajStep !== 0) return null;
            const v = i * yStep; const y = ty(v);
            return (
              <g key={`yt${i}`}>
                <line x1={PAD.l - 6} y1={y} x2={PAD.l} y2={y} stroke="black" strokeWidth={1.5} />
                <text x={PAD.l - 10} y={y + fontSize * 0.37} textAnchor="end" style={{ ...TF, fontSize, fill: '#000' }}>
                  {fmtNum(v)}
                </text>
              </g>
            );
          })}

          {/* ── X ticks */}
          {Array.from({ length: xGrid + 1 }, (_, i) => {
            if (i % xMajStep !== 0) return null;
            const v = i * xStep; const x = tx(v);
            return (
              <g key={`xt${i}`}>
                <line x1={x} y1={PAD.t + PH} x2={x} y2={PAD.t + PH + 6} stroke="black" strokeWidth={1.5} />
                <text x={x} y={PAD.t + PH + fontSize + 9} textAnchor="middle" style={{ ...TF, fontSize, fill: '#000' }}>
                  {fmtNum(v)}
                </text>
              </g>
            );
          })}

          {/* ── Axis labels */}
          <text transform="rotate(-90)" x={-(PAD.t + PH / 2)} y={fontSize}
            textAnchor="middle" style={{ ...TF, fontSize: fontSize + 1, fill: '#000' }}>
            <AxisSegs str={yLabel} fs={fontSize + 1} />
          </text>
          <text x={PAD.l + PW / 2} y={SH - 7}
            textAnchor="middle" style={{ ...TF, fontSize: fontSize + 1, fill: '#000' }}>
            <AxisSegs str={xLabel} fs={fontSize + 1} />
          </text>

          {/* ── Curves */}
          <g clipPath="url(#pc)">
            {allCurves.filter(s => s.visible && s.fit).map(s => (
              <path key={`cv${s.id}`} d={curvePath(s.fit)}
                fill="none" stroke={s.color ?? '#000'} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>

          {/* ── Live draw preview */}
          <g clipPath="url(#pc)">
            {livePathStr && (
              <path d={livePathStr} fill="none" stroke={drawColor}
                strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="6,3" opacity={0.7} />
            )}
          </g>

          {/* ── Draw mode border */}
          {drawMode && (
            <rect x={PAD.l} y={PAD.t} width={PW} height={PH}
              fill="rgba(125,60,152,0.035)" stroke="#7d3c98" strokeWidth={1.5} strokeDasharray="9,5"
              style={{ pointerEvents: 'none' }} />
          )}

          {/* ── Labels with chem sub/superscript */}
          {allCurves.map(s => {
            if (!s.labelVisible) return null;
            const segs = parseChemSegments(s.name);
            const approxW = chemWidth(segs, fontSize + 1) + 18;
            const bh = fontSize + 14;
            return (
              <g key={`lb${s.id}`}
                onMouseDown={e => onLabelMouseDown(e, s.id, s.isAuto)}
                style={{ cursor: drawMode ? 'crosshair' : 'grab' }}>
                <rect x={s.lx - approxW / 2} y={s.ly - bh + 3} width={approxW} height={bh + 4}
                  rx={3} fill="rgba(255,255,255,0.90)" stroke="none" />
                <text x={s.lx} y={s.ly} textAnchor="middle"
                  style={{ ...TF, fontSize: fontSize + 1, fill: s.color ?? '#000' }}>
                  <ChemTspans segs={segs} color={s.color ?? '#000'} fontSize={fontSize + 1} />
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
