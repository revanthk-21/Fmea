"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, ArrowRight, ArrowLeft, Link2, CheckCircle2,
  Loader2, ChevronDown, ChevronRight, AlertTriangle, Zap, Download
} from "lucide-react";

const apiBase = process.env.NEXT_PUBLIC_DFMEA_API ?? "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL STATE TYPE  (passed from DFMEALauncher for Cases 2 & 3)
// ─────────────────────────────────────────────────────────────────────────────

type DFMEAMode = "new_design" | "new_use_case" | "design_change";

type WizardInitialState = {
  mode:            DFMEAMode;
  focusElement?:   string;
  lowerElements?:  string[];
  higherElements?: string[];
  focusFunctions?: string[];
  lowerFunctions?: Record<string, string[]>;
  higherFunctions?: Record<string, string[]>;
  noiseFactors?: {
    pieceTopiece?:        string[];
    changeOverTime?:      string[];
    customerUsage?:       string[];
    externalEnvironment?: string[];
    systemInteractions?:  string[];
  };
  oldNoiseFactors?: {
    flat:        string[];
    by_category: Record<string, string[]>;
  };
  failureModes?: Array<{
    focus_fn:        string;
    failure_mode:    string;
    failure_effect:  string;
    severity:        number | null;
    lower_elements:  string[];
    old_noise_factors?: string[];
  }>;
  sodReference?: Record<string, {
    max_severity: number | null;
    avg_occurrence: number | null;
    avg_detection: number | null;
    max_rpn: number | null;
  }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Level = "lower" | "focus" | "higher";
type Element = { id: string; name: string; level: Level };
type Func    = { id: string; elementName: string; name: string; level: Level };
type Noise   = Record<string, string[]>;
type Connections = {
  lower_to_focus:  [string, string][];
  focus_to_higher: [string, string][];
};

type SuggestionItem = { id: string; name: string; elementName: string; similarity: number };
type SuggestionResponse = Record<string, { lower: SuggestionItem[]; higher: SuggestionItem[] }>;

type CauseItem = {
  id:                 string;
  cause:              string;
  noise_category:     string;
  noise_factor:       string;
  noise_driven:       boolean;  // always true for Case 1 — cause IS the noise factor manifesting
  selected:           boolean;
  prevention_methods: string;
  detection_methods:  string;
  occurrence_answer:  string;
  detection_answer:   string;
  occurrence?:        number;
  detection?:         number;
  rpn?:               number;
  action_priority?:   string;
};

type CauseGroup = {
  focus_fn_id:    string;
  focus_function: string;
  failure_mode:   string;
  lower_element:  string;
  lower_function: string;
  causes:         CauseItem[];
};

type DFMEARow = {
  id:                 string;
  focus_element:      string;
  focus_function:     string;
  failure_mode:       string;
  lower_element:      string;
  lower_function:     string;
  noise_factor:       string;
  failure_cause:      string;
  higher_element:     string;
  higher_function:    string;
  failure_effect:     string;
  severity:           number | undefined;
  prevention_methods: string;
  detection_methods:  string;
  occurrence:         number | undefined;
  detection:          number | undefined;
  rpn:                number | undefined;
  action_priority:    string;
  occurrence_answer:  string;
  detection_answer:   string;
};

// ─────────────────────────────────────────────────────────────────────────────
// IFMEA TYPES
// ─────────────────────────────────────────────────────────────────────────────

type IFMEAInterface = {
  id:              string;   // same id as the BConn it came from
  fromElement:     string;
  toElement:       string;
  connType:        ConnType;
  nominalTransfer: string;   // user-typed: what is transferred
  focusFns:        string[]; // selected focus function names (multi-select)
  focusFnIds:      string[]; // selected focus function ids
  modes:           IFMEAModeRec[];
  modesLoading:    boolean;
  modesGenerated:  boolean;
};

type IFMEAModeRec = {
  id:       string;
  mode:     string;
  selected: boolean;
};

type IFMEACauseItem = {
  id:                 string;
  cause:              string;
  noise_category:     string;
  noise_factor:       string;
  selected:           boolean;
  prevention_methods: string;
  detection_methods:  string;
  occurrence_answer:  string;
  detection_answer:   string;
  occurrence?:        number;
  detection?:         number;
  rpn?:               number;
  action_priority?:   string;
};

type IFMEACauseGroup = {
  interfaceId:     string;
  fromElement:     string;
  toElement:       string;
  connType:        ConnType;
  nominalTransfer: string;
  failureMode:     string;
  focusFns:        string[]; // focus functions this group covers
  causes:          IFMEACauseItem[];
};

type IFMEARow = {
  id:                 string;
  from_element:       string;
  to_element:         string;
  conn_type:          string;
  nominal_transfer:   string;
  failure_mode:       string;
  failure_cause:      string;
  noise_factor:       string;
  failure_effect:     string;  // effect on higher-level function
  severity:           number | undefined;
  prevention_methods: string;
  detection_methods:  string;
  occurrence:         number | undefined;
  detection:          number | undefined;
  rpn:                number | undefined;
  action_priority:    string;
  occurrence_answer:  string;
  detection_answer:   string;
};


// P-Diagram state type
type PDiagramState = {
  // Noise categories (5 standard columns) — these feed the Noise step
  noiseCategories: {
    pieceTopiece:        string[];
    changeOverTime:      string[];
    customerUsage:       string[];
    externalEnvironment: string[];
    systemInteractions:  string[];
  };
  // Middle section
  inputs:  string[];
  outputs: string[];   // auto-derived from focus functions, user can edit
  // Bottom section (functions auto-populated, rest user-filled)
  functions:               string[];   // from focus functions
  functionalRequirements:  string[];
  controlFactors:          string[];
  nonFunctionalRequirements: string[];
  unintendedOutputs:       string[];
};

// Interface Matrix — stores P/E/I/M rating (-2..+2) per element pair
// Key format: "fromElement::toElement"
type MatrixCell = {
  P: number | null;  // Physical
  E: number | null;  // Energy
  I: number | null;  // Information
  M: number | null;  // Material
};
type InterfaceMatrix = Record<string, MatrixCell>;   // key = "A::B"

function matrixKey(a: string, b: string) { return `${a}::${b}`; }
function emptyCell(): MatrixCell { return { P: null, E: null, I: null, M: null }; }

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SIMILARITY_DEFAULTS = { TOP_K_LOWER: 3, TOP_K_HIGHER: 2, THRESHOLD: 0.55 };

const STEPS = [
  "Elements",       // 0
  "B-Diagram",      // 1
  "IFMEA",          // 2  ← new
  "Functions",      // 3
  "P-Diagram",      // 4
  "Connections",    // 5
  "Failure Modes",  // 6
  "Failure Causes", // 7
  "Risk Rating",    // 8
  "Review & Export",// 9
];

const OCCURRENCE_OPTIONS = [
  { value: "very_high", label: "Very High",  rating: 9, desc: "Almost certain — occurs frequently" },
  { value: "high",      label: "High",       rating: 7, desc: "Will occur with some regularity" },
  { value: "moderate",  label: "Moderate",   rating: 5, desc: "Occasional occurrence expected" },
  { value: "low",       label: "Low",        rating: 3, desc: "Occurrence is low" },
  { value: "very_low",  label: "Very Low",   rating: 2, desc: "Occurrence very unlikely" },
  { value: "unlikely",  label: "Unlikely",   rating: 1, desc: "Failure excluded / extremely unlikely" },
];

const DETECTION_OPTIONS = [
  { value: "unlikely",  label: "Unlikely",  rating: 9, desc: "No test method / cannot detect" },
  { value: "low",       label: "Low",       rating: 7, desc: "Method exists but unproven / indirect" },
  { value: "moderate",  label: "Moderate",  rating: 5, desc: "Proven method from comparable product" },
  { value: "high",      label: "High",      rating: 3, desc: "Proven method confirmed for this product" },
  { value: "certain",   label: "Certain",   rating: 1, desc: "Automated / continuous detection" },
];

const O_MAP: Record<string, number> = {
  very_high: 9, high: 7, moderate: 5, low: 3, very_low: 2, unlikely: 1,
};
const D_MAP: Record<string, number> = {
  unlikely: 9, low: 7, moderate: 5, high: 3, certain: 1,
};

// P-Diagram noise category keys → display labels
const NOISE_CAT_LABELS: Record<keyof PDiagramState["noiseCategories"], string> = {
  pieceTopiece:        "Piece to Piece Variation",
  changeOverTime:      "Change Over Time",
  customerUsage:       "Customer Usage",
  externalEnvironment: "External Environment",
  systemInteractions:  "System Interactions",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function uid(p = "id") { return `${p}_${Math.random().toString(36).slice(2, 9)}`; }

function computeRating(oAns: string, dAns: string, s: number) {
  const o   = O_MAP[oAns] ?? 5;
  const d   = D_MAP[dAns] ?? 5;
  const rpn = s * o * d;
  const ap  = s >= 9 || rpn >= 200 ? "H" : rpn >= 100 ? "M" : "L";
  return { occurrence: o, detection: d, rpn, action_priority: ap };
}

/** Derive a completed-function string from a function name.
 *  e.g. "Maintain geometry" → "Geometry maintained"
 *  Heuristic: move the first word (verb) to end as past participle if possible,
 *  otherwise just append "achieved". */
function derivedOutput(fnName: string): string {
  if (!fnName.trim()) return "";
  // Simple inversion: "Verb Noun" → "Noun verbed"
  const words = fnName.trim().split(/\s+/);
  if (words.length >= 2) {
    const verb = words[0].toLowerCase();
    const rest = words.slice(1).join(" ");
    // Common verb → past participle map
    const pp: Record<string, string> = {
      maintain: "maintained",   manage:  "managed",     transfer: "transferred",
      enable:   "enabled",      absorb:  "absorbed",    deliver:  "delivered",
      support:  "supported",    provide: "provided",    control:  "controlled",
      limit:    "limited",      resist:  "resisted",    prevent:  "prevented",
      transmit: "transmitted",  reduce:  "reduced",     protect:  "protected",
      ensure:   "ensured",      carry:   "carried",     hold:     "held",
      guide:    "guided",       isolate: "isolated",    seal:     "sealed",
    };
    const pastTense = pp[verb] ?? (verb.endsWith("e") ? verb + "d" : verb + "ed");
    return rest.charAt(0).toUpperCase() + rest.slice(1) + " " + pastTense;
  }
  return fnName + " achieved";
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <Card className="mb-6 shadow-sm">
      <CardContent className="p-6 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Collapsible({ title, badge, badgeVariant = "secondary", defaultOpen = false, children }: {
  title: string; badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium"
      >
        <span className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          {title}
        </span>
        {badge && <Badge variant={badgeVariant} className="shrink-0 ml-2">{badge}</Badge>}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function OptionPills({ options, value, onChange }: {
  options: { value: string; label: string; rating: number; desc: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-left rounded-lg border p-3 text-sm transition-all select-none ${
            value === opt.value
              ? "border-primary bg-primary/10 ring-1 ring-primary"
              : "border-border hover:border-primary/40 hover:bg-muted/40"
          }`}
        >
          <div className="font-semibold">{opt.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.desc}</div>
          <div className="text-xs font-mono text-primary mt-1">Rating = {opt.rating}</div>
        </button>
      ))}
    </div>
  );
}

function RpnBadge({ rpn }: { rpn: number }) {
  const variant = rpn >= 200 ? "destructive" : rpn >= 100 ? "secondary" : "outline";
  return <Badge variant={variant}>RPN = {rpn}</Badge>;
}
function ApBadge({ ap }: { ap: string }) {
  const variant = ap === "H" ? "destructive" : ap === "M" ? "secondary" : "outline";
  return <Badge variant={variant}>AP = {ap}</Badge>;
}

// Editable list helper used in P-Diagram form
function EditList({ items, onChange, placeholder }: {
  items: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            className="text-xs h-7 flex-1" value={item} placeholder={placeholder}
            onChange={e => { const n = [...items]; n[i] = e.target.value; onChange(n); }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" className="h-7 text-xs w-full"
        onClick={() => onChange([...items, ""])}>
        <Plus className="h-3 w-3 mr-1" />Add
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// B-DIAGRAM — INTERACTIVE CONNECTION EDITOR
// ─────────────────────────────────────────────────────────────────────────────

type ConnType = "P" | "E" | "I" | "M";

type BConn = {
  id:       string;
  fromKey:  string;   // e.g. "lower-0", "focus", "higher-2"
  toKey:    string;
  type:     ConnType;
};

const CONN_META: Record<ConnType, { label: string; color: string; dash?: string }> = {
  P: { label: "Physical",     color: "#1d4ed8" },               // blue  — solid
  E: { label: "Energy",       color: "#15803d" },               // green — solid
  I: { label: "Information",  color: "#b45309", dash: "6,3" },  // amber — dashed
  M: { label: "Material",     color: "#b91c1c", dash: "2,4" },  // red   — dotted
};

// Layout constants (shared between interactive editor and static SVG export)
const W = 900; const H = 560;
const BX = 220; const BY = 70; const BW = 460; const BH = 380;
const BOX_W = 140; const BOX_H = 36;
const L_X = BX + 28;
const H_X = BX + BW + 50;
const FOCUS_CX = BX + BW / 2;
const FOCUS_CY = BY + BH / 2;
const FOCUS_W  = 160; const FOCUS_H = 44;


// Build the arrowhead path for a connection line
function arrowHead(x2: number, y2: number, x1: number, y1: number, size = 8) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  return `M${x2},${y2} L${x2 + size * Math.cos(a1)},${y2 + size * Math.sin(a1)} L${x2 + size * Math.cos(a2)},${y2 + size * Math.sin(a2)} Z`;
}

// Shorten line so it ends at box edge rather than centre
function shortenLine(
  x1: number, y1: number, x2: number, y2: number, margin = 20
): [number, number, number, number] {
  const dx = x2 - x1; const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < margin * 2) return [x1, y1, x2, y2];
  const ux = dx / len; const uy = dy / len;
  return [
    x1 + ux * margin, y1 + uy * margin,
    x2 - ux * margin, y2 - uy * margin,
  ];
}

// Midpoint for label
function midpoint(x1: number, y1: number, x2: number, y2: number) {
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

// Build initial positions — spread boxes out with generous spacing so nothing overlaps
function buildInitialPositions(
  lowerNames: string[],
  higherNames: string[],
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};

  // Focus box — centre of canvas
  pos["focus"] = { x: FOCUS_CX - FOCUS_W / 2, y: FOCUS_CY - FOCUS_H / 2 };

  // Lower boxes — evenly spaced left column, generous 60px vertical gap
  const lGap  = 60;
  const lTotalH = lowerNames.length * BOX_H + (lowerNames.length - 1) * lGap;
  const lTop  = Math.max(BY + 20, FOCUS_CY - lTotalH / 2);
  lowerNames.forEach((_, i) => {
    pos[`lower-${i}`] = { x: L_X, y: lTop + i * (BOX_H + lGap) };
  });

  // Higher boxes — right column with same generous spacing
  const hGap  = 60;
  const hTotalH = higherNames.length * BOX_H + (higherNames.length - 1) * hGap;
  const hTop  = Math.max(BY + 20, FOCUS_CY - hTotalH / 2);
  higherNames.forEach((_, i) => {
    pos[`higher-${i}`] = { x: H_X, y: hTop + i * (BOX_H + hGap) };
  });

  return pos;
}

function BDiagramSVG({
  focusName, lowerNames, higherNames, conns, setConns,
}: {
  focusName:  string;
  lowerNames: string[];
  higherNames: string[];
  conns:    BConn[];
  setConns: React.Dispatch<React.SetStateAction<BConn[]>>;
}) {

  // ── State (conns lifted to parent) ─────────────────────────────────────────
  const [pendingFrom,setPending]    = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ConnType>("P");
  const [hoveredConn,setHovConn]    = useState<string | null>(null);
  const [mode,       setMode]       = useState<"connect" | "move">("move");

  // Box positions — keyed by box key ("focus", "lower-0", "higher-1" …)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(
    () => buildInitialPositions(lowerNames, higherNames)
  );

  // Rebuild positions if elements change (new names added/removed)
  const lowerKey  = lowerNames.join("|");
  const higherKey = higherNames.join("|");
  const prevLower  = React.useRef(lowerKey);
  const prevHigher = React.useRef(higherKey);
  useEffect(() => {
    if (prevLower.current !== lowerKey || prevHigher.current !== higherKey) {
      setPositions(buildInitialPositions(lowerNames, higherNames));
      prevLower.current  = lowerKey;
      prevHigher.current = higherKey;
    }
  }, [lowerKey, higherKey]);

  // Drag state — stored in a ref to avoid re-renders during drag
  const drag = React.useRef<{
    key: string;
    startMx: number; startMy: number;
    startBx: number; startBy: number;
  } | null>(null);

  const svgRef    = React.useRef<SVGSVGElement>(null);
  const isDragging = React.useRef(false);

  // ── Helper: SVG coordinates from mouse event ───────────────────────────────

  const svgPoint = (e: React.MouseEvent | MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect  = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  // ── Box centre (reads from positions state) ────────────────────────────────

  const centre = useCallback((key: string): { x: number; y: number } => {
    const p = positions[key];
    if (!p) return { x: 0, y: 0 };
    if (key === "focus") return { x: p.x + FOCUS_W / 2, y: p.y + FOCUS_H / 2 };
    return { x: p.x + BOX_W / 2, y: p.y + BOX_H / 2 };
  }, [positions]);

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const onBoxMouseDown = useCallback((e: React.MouseEvent, key: string) => {
    if (mode !== "move") return;
    e.stopPropagation();
    isDragging.current = false;
    const pt = svgPoint(e);
    const p  = positions[key] ?? { x: 0, y: 0 };
    drag.current = { key, startMx: pt.x, startMy: pt.y, startBx: p.x, startBy: p.y };
  }, [mode, positions]);

  const onSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    const pt = svgPoint(e);
    const dx = pt.x - drag.current.startMx;
    const dy = pt.y - drag.current.startMy;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) isDragging.current = true;
    const key = drag.current.key;
    const nx  = drag.current.startBx + dx;
    const ny  = drag.current.startBy + dy;
    setPositions(p => ({ ...p, [key]: { x: nx, y: ny } }));
  }, []);

  const onSvgMouseUp = useCallback(() => {
    drag.current = null;
  }, []);

  // ── Click to connect ───────────────────────────────────────────────────────

  const handleBoxClick = useCallback((key: string) => {
    if (mode !== "connect") return;
    if (isDragging.current) return;  // ignore click that ended a drag

    if (!pendingFrom) {
      setPending(key);
    } else {
      if (pendingFrom === key) { setPending(null); return; }
      const exists = conns.some(
        c => (c.fromKey === pendingFrom && c.toKey === key) ||
             (c.fromKey === key && c.toKey === pendingFrom)
      );
      if (!exists) {
        setConns(p => [...p, { id: uid("bc"), fromKey: pendingFrom, toKey: key, type: activeType }]);
      }
      setPending(null);
    }
  }, [mode, pendingFrom, conns, activeType]);

  const removeConn    = (id: string) => setConns(p => p.filter(c => c.id !== id));
  const changeConnType = (id: string, t: ConnType) =>
    setConns(p => p.map(c => c.id === id ? { ...c, type: t } : c));

  // ── Download helpers ───────────────────────────────────────────────────────

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("foreignObject").forEach(fo => {
      const text = fo.querySelector("div")?.textContent ?? "";
      const txt  = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const fx   = parseFloat(fo.getAttribute("x") ?? "0");
      const fy   = parseFloat(fo.getAttribute("y") ?? "0");
      const fw   = parseFloat(fo.getAttribute("width") ?? "100");
      const fh   = parseFloat(fo.getAttribute("height") ?? "20");
      txt.setAttribute("x",           String(fx + fw / 2));
      txt.setAttribute("y",           String(fy + fh / 2 + 4));
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("font-size",   "10");
      txt.setAttribute("fill",        "#333");
      txt.setAttribute("font-family", "Arial, sans-serif");
      txt.textContent = text;
      fo.parentNode?.replaceChild(txt, fo);
    });
    const xml  = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${focusName || "b-diagram"}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = () => {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a   = document.createElement("a");
        a.href = url; a.download = `${focusName || "b-diagram"}.png`; a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  // ── Cursor logic ───────────────────────────────────────────────────────────

  const svgCursor = drag.current ? "grabbing"
    : mode === "move"    ? "grab"
    : pendingFrom        ? "crosshair"
    : "crosshair";

  // ── Box renderer (shared for lower/higher/focus) ───────────────────────────

  const renderBox = (
    key: string,
    label: string,
    fill: string, fillPending: string,
    stroke: string, strokeHov: string, strokePending: string,
    textColor: string,
  ) => {
    const p          = positions[key] ?? { x: 0, y: 0 };
    const isPending  = pendingFrom === key;
    const isFocus    = key === "focus";
    const bw         = isFocus ? FOCUS_W : BOX_W;
    const bh         = isFocus ? FOCUS_H : BOX_H;

    return (
      <g key={key}
        onMouseDown={e => onBoxMouseDown(e, key)}
        onClick={() => handleBoxClick(key)}
        style={{ cursor: mode === "move" ? (drag.current?.key === key ? "grabbing" : "grab") : "crosshair" }}
      >
        {/* Drag handle hint — subtle shadow */}
        <rect x={p.x + 2} y={p.y + 3} width={bw} height={bh} rx={isFocus ? 8 : 6}
          fill="rgba(0,0,0,0.06)" />
        <rect x={p.x} y={p.y} width={bw} height={bh} rx={isFocus ? 8 : 6}
          fill={isPending ? fillPending : fill}
          stroke={isPending ? strokePending : strokeHov}
          strokeWidth={isPending ? 2.5 : 1.8}
        />
        {/* Label via text (not foreignObject so SVG export works) */}
        <text x={p.x + bw / 2} y={p.y + bh / 2 + 4}
          textAnchor="middle" fontSize={10} fontWeight={isFocus ? "700" : "600"}
          fill={textColor}>
          {label.length > 20 ? label.slice(0, 18) + "…" : label}
        </text>
        {/* Move icon hint */}
        {mode === "move" && (
          <text x={p.x + bw - 10} y={p.y + 11} fontSize={8} fill={textColor} opacity={0.4}>⠿</text>
        )}
        {isPending && mode === "connect" && (
          <text x={p.x + bw / 2} y={p.y + bh + 13}
            textAnchor="middle" fontSize={8} fill={strokePending} fontStyle="italic">
            selected — click another box
          </text>
        )}
      </g>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* ── Toolbar ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">

          {/* Mode toggle */}
          <div className="flex rounded-lg border overflow-hidden w-fit">
            {(["move", "connect"] as const).map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setPending(null); }}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors capitalize ${
                  mode === m ? "bg-primary text-primary-foreground" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}>
                {m === "move" ? "✥ Move boxes" : "⤢ Draw connections"}
              </button>
            ))}
          </div>

          {/* Connection type pills — only shown in connect mode */}
          {mode === "connect" && (
            <div className="flex gap-2 flex-wrap">
              {(Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][]).map(([t, meta]) => (
                <button key={t} type="button" onClick={() => setActiveType(t)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-all ${
                    activeType === t ? "text-white shadow-sm" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                  style={activeType === t ? { background: meta.color, borderColor: meta.color } : {}}>
                  <span className="inline-block w-5"
                    style={{ borderTop: `2px ${meta.dash ? "dashed" : "solid"} ${activeType === t ? "white" : meta.color}` }} />
                  {t} — {meta.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status + download */}
        <div className="flex items-center gap-2 flex-wrap">
          {mode === "connect" && (
            pendingFrom ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
                <span className="animate-pulse w-2 h-2 rounded-full bg-amber-500 inline-block" />
                Click a second box to draw a {CONN_META[activeType].label} connection
              </div>
            ) : (
              <div className="text-xs text-muted-foreground px-2">Click any box to start a connection</div>
            )
          )}
          {mode === "move" && (
            <div className="text-xs text-muted-foreground px-2">Drag any box to reposition it</div>
          )}
          <Button variant="outline" size="sm" onClick={() => setPositions(buildInitialPositions(lowerNames, higherNames))}>
            Reset layout
          </Button>
          <Button variant="outline" size="sm" onClick={downloadSVG}>
            <Download className="h-3.5 w-3.5 mr-1.5" />SVG
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPNG}>
            <Download className="h-3.5 w-3.5 mr-1.5" />PNG
          </Button>
          {conns.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-700"
              onClick={() => setConns([])}>
              Clear connections
            </Button>
          )}
        </div>
      </div>

      {/* ── SVG canvas ── */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden" style={{ cursor: svgCursor }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", display: "block", fontFamily: "Arial, sans-serif", minHeight: 320 }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
        >
          <defs>
            {(Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][]).map(([t, meta]) => (
              <marker key={t} id={`arrow-${t}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L0,8 L8,4 Z" fill={meta.color} />
              </marker>
            ))}
          </defs>

          {/* ── Focus system boundary ── */}
          <rect x={BX} y={BY} width={BW} height={BH} rx={16}
            fill="#EAF3FB" stroke="#3B82F6" strokeWidth={2} strokeDasharray="10,5" />
          <text x={BX + BW / 2} y={BY - 12} textAnchor="middle"
            fontSize={10} fontWeight="700" fill="#3B82F6" letterSpacing="0.8">
            {(focusName || "FOCUS SYSTEM").toUpperCase()} — BOUNDARY
          </text>

          {/* ── Connections (drawn beneath boxes) ── */}
          {conns.map(conn => {
            const from  = centre(conn.fromKey);
            const to    = centre(conn.toKey);
            const [x1, y1, x2, y2] = shortenLine(from.x, from.y, to.x, to.y, 22);
            const mid   = midpoint(x1, y1, x2, y2);
            const meta  = CONN_META[conn.type];
            const isHov = hoveredConn === conn.id;

            return (
              <g key={conn.id}
                onMouseEnter={() => setHovConn(conn.id)}
                onMouseLeave={() => setHovConn(null)}
                onClick={() => removeConn(conn.id)}
                style={{ cursor: "pointer" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={meta.color} strokeWidth={isHov ? 2.5 : 1.8}
                  strokeDasharray={meta.dash}
                  markerEnd={`url(#arrow-${conn.type})`}
                  opacity={isHov ? 1 : 0.85} />
                <rect x={mid.x - 14} y={mid.y - 8} width={28} height={16} rx={4}
                  fill={isHov ? meta.color : "white"} stroke={meta.color} strokeWidth={1} />
                <text x={mid.x} y={mid.y + 4} textAnchor="middle"
                  fontSize={9} fontWeight="700" fill={isHov ? "white" : meta.color}>
                  {conn.type}
                </text>
                {isHov && (
                  <text x={mid.x + 18} y={mid.y + 4} fontSize={12} fill="#ef4444" fontWeight="700">×</text>
                )}
              </g>
            );
          })}

          {/* ── Lower element boxes ── */}
          {lowerNames.map((name, i) =>
            renderBox(`lower-${i}`, name,
              "#F3E8FF", "#E9D5FF", "#c084fc", "#9333EA", "#7e22ce", "#4B0082")
          )}

          {/* ── Focus system box ── */}
          {renderBox("focus", focusName || "Focus System",
            "#DBEAFE", "#BFDBFE", "#60a5fa", "#3B82F6", "#1d4ed8", "#1e3a5f")}

          {/* ── Higher element boxes ── */}
          {higherNames.map((name, i) =>
            renderBox(`higher-${i}`, name,
              "#ECFDF5", "#D1FAE5", "#6ee7b7", "#059669", "#065f46", "#064E3B")
          )}

          {/* ── Legend ── */}
          {(() => {
            const LY = BY + BH + 32;
            const entries = Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][];
            const gap = (W - 80) / entries.length;
            return (
              <g>
                <rect x={30} y={LY - 8} width={W - 60} height={38} rx={8}
                  fill="#F9FAFB" stroke="#E5E7EB" strokeWidth={1} />
                {entries.map(([t, meta], idx) => {
                  const lx = 56 + idx * gap;
                  return (
                    <g key={t}>
                      <line x1={lx} y1={LY + 11} x2={lx + 22} y2={LY + 11}
                        stroke={meta.color} strokeWidth={2} strokeDasharray={meta.dash} />
                      <path d={arrowHead(lx + 22, LY + 11, lx, LY + 11, 5)} fill={meta.color} />
                      <text x={lx + 28} y={LY + 15} fontSize={9} fill="#374151" fontWeight="600">{t}</text>
                      <text x={lx + 40} y={LY + 15} fontSize={9} fill="#6B7280"> — {meta.label}</text>
                    </g>
                  );
                })}
              </g>
            );
          })()}
        </svg>
      </div>

      {/* ── Connection list ── */}
      {conns.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Connections ({conns.length}) — hover + click on the diagram, or use × below to remove
            </p>
          </div>
          <div className="divide-y">
            {conns.map(conn => {
              const meta      = CONN_META[conn.type];
              const nameOf    = (k: string) => k === "focus" ? focusName
                : k.startsWith("lower-")  ? lowerNames[parseInt(k.split("-")[1])]
                : higherNames[parseInt(k.split("-")[1])];

              return (
                <div key={conn.id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3 text-sm min-w-0">
                    <span className="shrink-0 px-2 py-0.5 rounded text-xs font-bold text-white"
                      style={{ background: meta.color }}>{conn.type}</span>
                    <span className="truncate text-gray-700 font-medium">{nameOf(conn.fromKey)}</span>
                    <span className="text-gray-400 shrink-0">↔</span>
                    <span className="truncate text-gray-700 font-medium">{nameOf(conn.toKey)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">({meta.label})</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {(Object.keys(CONN_META) as ConnType[]).filter(t => t !== conn.type).map(t => (
                      <button key={t} type="button" title={`Change to ${CONN_META[t].label}`}
                        onClick={() => changeConnType(conn.id, t)}
                        className="w-5 h-5 rounded text-[9px] font-bold text-white flex items-center justify-center"
                        style={{ background: CONN_META[t].color }}>{t}</button>
                    ))}
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-600"
                      onClick={() => removeConn(conn.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P-DIAGRAM FORM + RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function PDiagramView({
  pDiagram, focusName, setPDiagram,
}: {
  pDiagram: PDiagramState;
  focusName: string;
  setPDiagram: React.Dispatch<React.SetStateAction<PDiagramState>>;
}) {
  const setNC = <K extends keyof PDiagramState["noiseCategories"]>(k: K, v: string[]) =>
    setPDiagram(p => ({ ...p, noiseCategories: { ...p.noiseCategories, [k]: v } }));

  const noiseCatKeys = Object.keys(NOISE_CAT_LABELS) as Array<keyof PDiagramState["noiseCategories"]>;

  return (
    <div className="space-y-5">

      {/* ── TOP: Noise factor categories ── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">
            Noise Factor Categories
            <span className="ml-2 font-normal text-gray-400 normal-case">
              (these populate the Noise Factors step)
            </span>
          </p>
        </div>
        <div className="grid grid-cols-5 divide-x divide-gray-200">
          {noiseCatKeys.map(key => (
            <div key={key} className="p-3 space-y-2">
              <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5 leading-tight">
                {NOISE_CAT_LABELS[key]}
              </p>
              <EditList
                items={pDiagram.noiseCategories[key]}
                onChange={v => setNC(key, v)}
                placeholder="Add factor…"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── MIDDLE: Inputs → System Box → Outputs ── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Signal Flow</p>
        </div>
        <div className="grid grid-cols-[1fr_auto_200px_auto_1fr] items-start gap-0 p-4">

          {/* Inputs */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-2 py-1">Inputs</p>
            <EditList
              items={pDiagram.inputs}
              onChange={v => setPDiagram(p => ({ ...p, inputs: v }))}
              placeholder="e.g. Braking torque (Nm)"
            />
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center px-3 pt-7">
            <span className="text-2xl text-gray-300 select-none">→</span>
          </div>

          {/* Focus system box */}
          <div className="flex items-center justify-center">
            <div className="border-2 border-gray-400 rounded-lg bg-gray-100 px-4 py-5 text-center w-full">
              <p className="text-[11px] font-bold text-gray-800 leading-snug">{focusName || "Focus System"}</p>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center px-3 pt-7">
            <span className="text-2xl text-gray-300 select-none">→</span>
          </div>

          {/* Outputs (auto-derived, editable) */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-2 py-1">
              Outputs
              <span className="font-normal text-gray-400 ml-1">(auto-derived)</span>
            </p>
            <EditList
              items={pDiagram.outputs}
              onChange={v => setPDiagram(p => ({ ...p, outputs: v }))}
              placeholder="e.g. Geometry maintained"
            />
          </div>
        </div>
      </div>

      {/* ── BOTTOM: Analysis columns ── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">System Analysis</p>
        </div>
        <div className="grid grid-cols-5 divide-x divide-gray-200">

          {/* Functions — auto-populated, read-only display */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5">
              Functions
              <span className="block font-normal text-gray-400">(from Step 3)</span>
            </p>
            {pDiagram.functions.length === 0
              ? <p className="text-[10px] text-muted-foreground italic">Add focus functions in Step 3.</p>
              : pDiagram.functions.map((fn, i) => (
                  <div key={i} className="text-[10px] px-2 py-1 bg-blue-50 border border-blue-200 rounded text-blue-800 leading-snug">
                    {fn}
                  </div>
                ))}
          </div>

          {/* Functional Requirements */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5">
              Functional Requirements
            </p>
            <EditList
              items={pDiagram.functionalRequirements}
              onChange={v => setPDiagram(p => ({ ...p, functionalRequirements: v }))}
              placeholder="e.g. Max load 5000 kg"
            />
          </div>

          {/* Control Factors */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5">
              Control Factors
            </p>
            <EditList
              items={pDiagram.controlFactors}
              onChange={v => setPDiagram(p => ({ ...p, controlFactors: v }))}
              placeholder="e.g. Wall thickness (mm)"
            />
          </div>

          {/* Non-Functional Requirements */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5">
              Non-Functional Requirements
            </p>
            <EditList
              items={pDiagram.nonFunctionalRequirements}
              onChange={v => setPDiagram(p => ({ ...p, nonFunctionalRequirements: v }))}
              placeholder="e.g. Weight &lt; 120 kg"
            />
          </div>

          {/* Unintended Outputs */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-bold text-center bg-gray-200 rounded px-1 py-0.5">
              Unintended Outputs / Error States
            </p>
            <EditList
              items={pDiagram.unintendedOutputs}
              onChange={v => setPDiagram(p => ({ ...p, unintendedOutputs: v }))}
              placeholder="e.g. Fluid leaks"
            />
          </div>

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function DFMEAWizard({ initialState }: { initialState?: WizardInitialState }) {
  const mode = initialState?.mode ?? "new_design";
  const [step, setStep] = useState(0);

  // ── Step 0 ── Elements — seeded from initialState for Cases 2 & 3
  const [lowerElements, setLowerElements] = useState<Element[]>(() =>
    (initialState?.lowerElements ?? []).map(name => ({ id: uid("el"), name, level: "lower" as const }))
  );
  const [focusElement, setFocusElement] = useState<Element | null>(() =>
    initialState?.focusElement
      ? { id: uid("el"), name: initialState.focusElement, level: "focus" as const }
      : null
  );
  const [higherElements, setHigherElements] = useState<Element[]>(() =>
    (initialState?.higherElements ?? []).map(name => ({ id: uid("el"), name, level: "higher" as const }))
  );

  // ── Step 1 ── B-Diagram — lifted so IFMEA step can read them
  // Case 3: boxes exist (from elements above) but NO connections (empty bConns)
  const [bConns, setBConns] = useState<BConn[]>([]);

  // ── Step 2 ── IFMEA
  const [ifmeaInterfaces,      setIfmeaInterfaces]      = useState<IFMEAInterface[]>([]);
  const [ifmeaCauseGroups,     setIfmeaCauseGroups]     = useState<IFMEACauseGroup[]>([]);
  const [ifmeaCausesLoading,   setIfmeaCausesLoading]   = useState(false);
  const [ifmeaCausesGenerated, setIfmeaCausesGenerated] = useState(false);
  const [ifmeaRows,            setIfmeaRows]            = useState<IFMEARow[]>([]);
  const [ifmeaRowsLoading,     setIfmeaRowsLoading]     = useState(false);
  const [ifmeaPhase,           setIfmeaPhase]           = useState<"matrix"|"modes"|"causes"|"rate">("matrix");
  const [ifmeaMatrix,          setIfmeaMatrix]          = useState<InterfaceMatrix>({});
  const [reviewTab,            setReviewTab]            = useState<"dfmea"|"ifmea">("dfmea");

  // Sync bConns → ifmeaInterfaces (preserves existing nominalTransfer/modes)
  useEffect(() => {
    setIfmeaInterfaces(prev => {
      const existing = Object.fromEntries(prev.map(i => [i.id, i]));
      const lN = lowerElements.map(e => e.name);
      const hN = higherElements.map(e => e.name);
      const nameOf = (k: string) =>
        k === "focus"            ? (focusElement?.name ?? "Focus System")
        : k.startsWith("lower-") ? (lN[parseInt(k.split("-")[1])] ?? k)
        : (hN[parseInt(k.split("-")[1])] ?? k);
      return bConns.map(conn => existing[conn.id] ?? {
        id: conn.id, fromElement: nameOf(conn.fromKey), toElement: nameOf(conn.toKey),
        connType: conn.type, nominalTransfer: "",
        focusFns: [], focusFnIds: [],
        modes: [], modesLoading: false, modesGenerated: false,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bConns.map(c => c.id + c.type))]);

  // ── Step 3 ── Functions — seeded from initialState for Cases 2 & 3
  const [functions, setFunctions] = useState<Func[]>(() => {
    if (!initialState) return [];
    const out: Func[] = [];
    // Focus functions
    (initialState.focusFunctions ?? []).forEach(name => {
      if (name) out.push({ id: uid("fn"), elementName: initialState.focusElement ?? "", name, level: "focus" });
    });
    // Lower functions — { elementName: [fn, fn] }
    Object.entries(initialState.lowerFunctions ?? {}).forEach(([elName, fns]) => {
      fns.forEach(name => { if (name) out.push({ id: uid("fn"), elementName: elName, name, level: "lower" }); });
    });
    // Higher functions
    Object.entries(initialState.higherFunctions ?? {}).forEach(([elName, fns]) => {
      fns.forEach(name => { if (name) out.push({ id: uid("fn"), elementName: elName, name, level: "higher" }); });
    });
    return out;
  });
  const focusFunctions  = useMemo(() => functions.filter(f => f.level === "focus"),  [functions]);
  const lowerFunctions  = useMemo(() => functions.filter(f => f.level === "lower"),  [functions]);
  const higherFunctions = useMemo(() => functions.filter(f => f.level === "higher"), [functions]);

  // ── Step 3 ── P-Diagram (also drives noise for step 4+)
  const [pDiagram, setPDiagram] = useState<PDiagramState>(() => {
    // Case 3: pre-fill noise factors from imported DFMEA (environment unchanged)
    const nf = initialState?.noiseFactors;
    return {
      noiseCategories: {
        pieceTopiece:        nf?.pieceTopiece        ?? [],
        changeOverTime:      nf?.changeOverTime       ?? [],
        customerUsage:       nf?.customerUsage        ?? [],
        externalEnvironment: nf?.externalEnvironment  ?? [],
        systemInteractions:  nf?.systemInteractions   ?? [],
      },
      inputs: [], outputs: [],
      functions: [], functionalRequirements: [], controlFactors: [],
      nonFunctionalRequirements: [], unintendedOutputs: [],
    };
  });

  // Sync focus functions → pDiagram.functions and auto-derive outputs
  useEffect(() => {
    const fns = focusFunctions.map(f => f.name).filter(Boolean);
    const outs = fns.map(fn => derivedOutput(fn));
    setPDiagram(p => ({
      ...p,
      functions: fns,
      // Only overwrite outputs if user hasn't added custom ones beyond auto-derived
      outputs: p.outputs.length > 0 && p.outputs.some(o => !outs.includes(o))
        ? p.outputs
        : outs,
    }));
  }, [focusFunctions.map(f => f.name).join(",")]);

  // Derived noise: flatten p-diagram noise categories into the Noise format
  // (used by downstream steps)
  const noiseFromPDiagram = useMemo((): Noise => {
    const nc = pDiagram.noiseCategories;
    const result: Noise = {};
    const keys = Object.keys(NOISE_CAT_LABELS) as Array<keyof PDiagramState["noiseCategories"]>;
    for (const k of keys) {
      const items = nc[k].filter(Boolean);
      if (items.length) result[NOISE_CAT_LABELS[k]] = items;
    }
    return result;
  }, [pDiagram.noiseCategories]);

  // ── Step 5 ── Connections
  const [connections, setConnections] = useState<Connections>({ lower_to_focus: [], focus_to_higher: [] });
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestApplied, setSuggestApplied] = useState(false);

  // ── Step 6 ── Failure modes
  const [modesByFocus, setModesByFocus] = useState<
    Record<string, { options: string[]; selected: Set<string>; loading: boolean }>
  >({});

  // ── Step 7 ── Cause groups
  const [causeGroups,     setCauseGroups]     = useState<CauseGroup[]>([]);
  const [causesLoading,   setCausesLoading]   = useState(false);
  const [causesGenerated, setCausesGenerated] = useState(false);

  // ── Step 9 ── Final rows
  const [rows,        setRows]        = useState<DFMEARow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep(s => Math.max(s - 1, 0));

  // ── Element helpers ──────────────────────────────────────────────────────

  const addLowerElement  = () => setLowerElements(p => [...p, { id: uid("el"), name: "", level: "lower" }]);
  const addHigherElement = () => setHigherElements(p => [...p, { id: uid("el"), name: "", level: "higher" }]);

  // ── Function helpers ─────────────────────────────────────────────────────

  const addFunction    = (elementName: string, level: Level) =>
    setFunctions(p => [...p, { id: uid("fn"), elementName, name: "", level }]);
  const removeFunction = (id: string) => setFunctions(p => p.filter(f => f.id !== id));
  const updateFunction = useCallback((id: string, val: string) =>
    setFunctions(p => p.map(f => f.id === id ? { ...f, name: val } : f)), []);

  // ── Connection helpers ───────────────────────────────────────────────────

  const toggleLowerToFocus = (lId: string, fId: string) =>
    setConnections(p => {
      const exists = p.lower_to_focus.some(([l, f]) => l === lId && f === fId);
      return {
        ...p,
        lower_to_focus: exists
          ? p.lower_to_focus.filter(([l, f]) => !(l === lId && f === fId))
          : [...p.lower_to_focus, [lId, fId]],
      };
    });

  const toggleFocusToHigher = (fId: string, hId: string) =>
    setConnections(p => {
      const exists = p.focus_to_higher.some(([f, h]) => f === fId && h === hId);
      return {
        ...p,
        focus_to_higher: exists
          ? p.focus_to_higher.filter(([f, h]) => !(f === fId && h === hId))
          : [...p.focus_to_higher, [fId, hId]],
      };
    });

  // ── AI suggest connections ───────────────────────────────────────────────

  const fetchAndApplySuggestions = async () => {
    if (!focusFunctions.length) return;
    setSuggestLoading(true);
    try {
      const body = {
        lower_functions:  lowerFunctions.map(f => ({ id: f.id, name: f.name, elementName: f.elementName })),
        focus_functions:  focusFunctions.map(f => ({ id: f.id, name: f.name, elementName: f.elementName })),
        higher_functions: higherFunctions.map(f => ({ id: f.id, name: f.name, elementName: f.elementName })),
        top_k_lower:  SIMILARITY_DEFAULTS.TOP_K_LOWER,
        top_k_higher: SIMILARITY_DEFAULTS.TOP_K_HIGHER,
        threshold:    SIMILARITY_DEFAULTS.THRESHOLD,
      };
      const r = await fetch(`${apiBase}/api/dfmea/similarity/suggest`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await r.json();
      const sugg: { suggestions?: SuggestionResponse } = data ?? {};
      if (!sugg.suggestions) { setSuggestLoading(false); return; }
      const lf  = new Set(connections.lower_to_focus.map(([l, f]) => `${l}::${f}`));
      const fh  = new Set(connections.focus_to_higher.map(([f, h]) => `${f}::${h}`));
      const nextLower:  [string, string][] = [...connections.lower_to_focus];
      const nextHigher: [string, string][] = [...connections.focus_to_higher];
      for (const ff of focusFunctions) {
        const pack = sugg.suggestions[ff.id];
        if (!pack) continue;
        for (const it of (pack.lower ?? [])) {
          const k = `${it.id}::${ff.id}`;
          if (!lf.has(k)) { lf.add(k); nextLower.push([it.id, ff.id]); }
        }
        for (const it of (pack.higher ?? [])) {
          const k = `${ff.id}::${it.id}`;
          if (!fh.has(k)) { fh.add(k); nextHigher.push([ff.id, it.id]); }
        }
      }
      setConnections({ lower_to_focus: nextLower, focus_to_higher: nextHigher });
      setSuggestApplied(true);
    } catch (e) {
      console.error("Similarity suggest failed:", e);
    } finally {
      setSuggestLoading(false);
    }
  };

  useEffect(() => {
    if (step === 5 && !suggestApplied && (lowerFunctions.length || higherFunctions.length)) {
      fetchAndApplySuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);


  // ── IFMEA helpers ────────────────────────────────────────────────────────────

  // ── Interface matrix helpers ────────────────────────────────────────────────

  const setMatrixCell = (from: string, to: string, type: ConnType, val: number | null) => {
    const k = matrixKey(from, to);
    setIfmeaMatrix(prev => ({
      ...prev,
      [k]: { ...(prev[k] ?? emptyCell()), [type]: val },
    }));
  };

  // Derive all unique element names for matrix axes (lower + focus + higher)
  const allElementNames = useMemo(() => {
    const names = new Set<string>();
    lowerElements.forEach(e => { if (e.name) names.add(e.name); });
    if (focusElement?.name) names.add(focusElement.name);
    higherElements.forEach(e => { if (e.name) names.add(e.name); });
    names.add("Environment"); // always include environment as standard IFMEA axis
    return Array.from(names);
  }, [lowerElements, focusElement, higherElements]);

  const updateIfmeaTransfer = (id: string, val: string) =>
    setIfmeaInterfaces(p => p.map(i => i.id === id ? { ...i, nominalTransfer: val } : i));

  // Toggle a focus function in/out of an interface's selection (multi-select)
  const toggleIfmeaFocusFn = (ifaceId: string, ffId: string) => {
    const ff = focusFunctions.find(f => f.id === ffId);
    if (!ff) return;
    setIfmeaInterfaces(p => p.map(i => {
      if (i.id !== ifaceId) return i;
      const already = i.focusFnIds.includes(ffId);
      return {
        ...i,
        focusFnIds: already ? i.focusFnIds.filter(id => id !== ffId) : [...i.focusFnIds, ffId],
        focusFns:   already ? i.focusFns.filter(n => n !== ff.name)  : [...i.focusFns,   ff.name],
      };
    }));
  };

  const fetchIfmeaModes = async (iface: IFMEAInterface) => {
    setIfmeaInterfaces(p => p.map(i => i.id === iface.id ? { ...i, modesLoading: true } : i));
    try {
      const r = await fetch(`${apiBase}/api/ifmea/interface-failure-modes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_element: iface.fromElement, to_element: iface.toElement,
          connection_type: iface.connType, nominal_transfer: iface.nominalTransfer,
          focus_element: focusElement?.name ?? "",
        }),
      });
      const data = await r.json();
      const modes: IFMEAModeRec[] = (data.failure_modes ?? []).map((m: string) => ({
        id: uid("im"), mode: m, selected: false,
      }));
      setIfmeaInterfaces(p => p.map(i => i.id === iface.id
        ? { ...i, modes, modesLoading: false, modesGenerated: true } : i));
    } catch {
      setIfmeaInterfaces(p => p.map(i => i.id === iface.id ? { ...i, modesLoading: false } : i));
    }
  };

  const toggleIfmeaMode = (ifaceId: string, modeId: string) =>
    setIfmeaInterfaces(p => p.map(i => i.id !== ifaceId ? i : {
      ...i, modes: i.modes.map(m => m.id === modeId ? { ...m, selected: !m.selected } : m),
    }));

  const generateIfmeaCauses = async () => {
    setIfmeaCausesLoading(true); setIfmeaCausesGenerated(false); setIfmeaCauseGroups([]);
    const groups: IFMEACauseGroup[] = [];
    const cleanNoise = Object.fromEntries(
      Object.entries(noiseFromPDiagram).map(([k, arr]) => [k, arr.filter(Boolean)])
    );
    for (const iface of ifmeaInterfaces) {
      const selectedModes = iface.modes.filter(m => m.selected).map(m => m.mode);
      if (!selectedModes.length || !iface.nominalTransfer.trim()) continue;
      try {
        const r = await fetch(`${apiBase}/api/ifmea/interface-causes/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_element: iface.fromElement, to_element: iface.toElement,
            connection_type: iface.connType, nominal_transfer: iface.nominalTransfer,
            failure_modes: selectedModes, noise_factors: cleanNoise,
          }),
        });
        const data = await r.json();
        for (const g of data.groups ?? []) {
          groups.push({
            interfaceId: iface.id, fromElement: iface.fromElement,
            toElement: iface.toElement, connType: iface.connType,
            nominalTransfer: iface.nominalTransfer, failureMode: g.failure_mode,
            focusFns: iface.focusFns,
            causes: (g.causes ?? []).map((c: { cause: string; noise_category: string; noise_factor: string }) => ({
              id: uid("ic"), cause: c.cause, noise_category: c.noise_category,
              noise_factor: c.noise_factor, selected: false,
              prevention_methods: "", detection_methods: "",
              occurrence_answer: "", detection_answer: "",
            })),
          });
        }
      } catch (e) { console.error("IFMEA cause gen failed:", iface.id, e); }
    }
    setIfmeaCauseGroups(groups); setIfmeaCausesLoading(false); setIfmeaCausesGenerated(true);
  };

  const toggleIfmeaCause = (gi: number, cId: string) =>
    setIfmeaCauseGroups(p => p.map((g, i) => i !== gi ? g : {
      ...g, causes: g.causes.map(c => c.id === cId ? { ...c, selected: !c.selected } : c),
    }));

  const updateIfmeaCauseField = (gi: number, cId: string, field: keyof IFMEACauseItem, val: string) =>
    setIfmeaCauseGroups(p => p.map((g, i) => i !== gi ? g : {
      ...g, causes: g.causes.map(c => c.id === cId ? { ...c, [field]: val } : c),
    }));

  const ifmeaTotalSelected = useMemo(
    () => ifmeaCauseGroups.reduce((a, g) => a + g.causes.filter(c => c.selected).length, 0),
    [ifmeaCauseGroups]
  );
  const ifmeaTotalRated = useMemo(
    () => ifmeaCauseGroups.reduce(
      (a, g) => a + g.causes.filter(c => c.selected && c.occurrence_answer && c.detection_answer).length, 0),
    [ifmeaCauseGroups]
  );

  const buildIfmeaRows = async () => {
    setIfmeaRowsLoading(true);
    const draft: IFMEARow[] = [];
    for (const group of ifmeaCauseGroups) {
      for (const cause of group.causes.filter(c => c.selected)) {
        const rated = cause.occurrence_answer && cause.detection_answer
          ? computeRating(cause.occurrence_answer, cause.detection_answer, 5)
          : { occurrence: undefined, detection: undefined, rpn: undefined, action_priority: "" };
        draft.push({
          id: uid("ir"), from_element: group.fromElement, to_element: group.toElement,
          conn_type: group.connType, nominal_transfer: group.nominalTransfer,
          failure_mode: group.failureMode, failure_cause: cause.cause,
          noise_factor: `${cause.noise_category}: ${cause.noise_factor}`,
          failure_effect:     "",
          severity: undefined, prevention_methods: cause.prevention_methods,
          detection_methods: cause.detection_methods,
          occurrence: rated.occurrence, detection: rated.detection,
          rpn: rated.rpn, action_priority: rated.action_priority ?? "",
          occurrence_answer: cause.occurrence_answer, detection_answer: cause.detection_answer,
        });
      }
    }
    if (draft.length) {
      try {
        const r = await fetch(`${apiBase}/api/ifmea/interface-effects/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: draft.map(row => ({
              row_id: row.id, from_element: row.from_element, to_element: row.to_element,
              connection_type: row.conn_type, nominal_transfer: row.nominal_transfer,
              failure_mode: row.failure_mode,
            })),
          }),
        });
        const data = await r.json();
        const effMap: Record<string, { failure_effect: string }> = {};
        for (const res of data.results ?? []) effMap[res.row_id] = res;
        draft.forEach(row => {
          if (effMap[row.id]) {
            row.failure_effect = effMap[row.id].failure_effect;
          }
        });
      } catch (e) { console.error("IFMEA effects failed:", e); }
    }
    if (draft.length) {
      try {
        const r = await fetch(`${apiBase}/api/ifmea/interface-severity/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: draft.map(row => ({
              row_id: row.id, to_element: row.to_element,
              failure_effect: row.failure_effect,
            })),
          }),
        });
        const data = await r.json();
        const sevMap: Record<string, number> = {};
        for (const res of data.results ?? []) sevMap[res.row_id] = res.severity_rank;
        draft.forEach(row => {
          const s = sevMap[row.id]; if (!s) return;
          row.severity = s;
          if (row.occurrence_answer && row.detection_answer) {
            const { occurrence, detection, rpn, action_priority } =
              computeRating(row.occurrence_answer, row.detection_answer, s);
            row.occurrence = occurrence; row.detection = detection;
            row.rpn = rpn; row.action_priority = action_priority;
          }
        });
      } catch (e) { console.error("IFMEA severity failed:", e); }
    }
    setIfmeaRows(draft); setIfmeaRowsLoading(false);
  };

  const exportMatrixCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const types: ConnType[] = ["P","E","I","M"];
    // Header row: blank corner + element names (one column per element per type = 4 per element)
    const headerCols = allElementNames.flatMap(el => types.map(t => `${el} (${t})`));
    const rows = [["", ...headerCols].map(esc).join(",")];
    for (const rowEl of allElementNames) {
      const rowCells = allElementNames.flatMap(colEl => {
        if (rowEl === colEl) return types.map(() => esc("//"));
        const k = matrixKey(rowEl, colEl);
        const cell = ifmeaMatrix[k] ?? emptyCell();
        return types.map(t => esc(cell[t] === null ? "" : cell[t]));
      });
      rows.push([esc(rowEl), ...rowCells].join(","));
    }
    const csv = rows.join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    Object.assign(document.createElement("a"), { href: url, download: "interface_matrix.csv" }).click();
    URL.revokeObjectURL(url);
  };

  const exportIfmeaCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const headers = ["From Element","To Element","Conn Type","Nominal Transfer","Failure Mode",
      "Failure Cause","Noise Factor","Failure Effect on Higher Function",
      "S","O","D","RPN","AP","Prevention Methods","Detection Methods"];
    const csv = [headers.map(esc).join(",")]
      .concat(ifmeaRows.map(r => [
        r.from_element, r.to_element, r.conn_type, r.nominal_transfer,
        r.failure_mode, r.failure_cause, r.noise_factor,
        r.failure_effect,
        r.severity ?? "", r.occurrence ?? "", r.detection ?? "", r.rpn ?? "", r.action_priority,
        r.prevention_methods, r.detection_methods,
      ].map(esc).join(",")))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    Object.assign(document.createElement("a"), { href: url, download: "ifmea.csv" }).click();
    URL.revokeObjectURL(url);
  };

  // ── Failure mode helpers ─────────────────────────────────────────────────

  const fetchModes = async (ff: Func) => {
    if (!focusElement) return;
    setModesByFocus(p => ({
      ...p,
      [ff.id]: { options: p[ff.id]?.options ?? [], selected: p[ff.id]?.selected ?? new Set(), loading: true },
    }));
    try {
      const r    = await fetch(`${apiBase}/api/dfmea/failure-modes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus_function_name: ff.name, focus_element_name: focusElement.name }),
      });
      const data = await r.json();
      const opts: string[] = data.failure_modes || [];
      setModesByFocus(p => ({
        ...p, [ff.id]: { options: opts, selected: p[ff.id]?.selected ?? new Set(), loading: false },
      }));
    } catch {
      setModesByFocus(p => ({ ...p, [ff.id]: { ...p[ff.id], loading: false } }));
    }
  };

  const toggleMode = (focusId: string, mode: string) =>
    setModesByFocus(p => {
      const rec = p[focusId] || { options: [], selected: new Set<string>(), loading: false };
      const sel = new Set(rec.selected);
      sel.has(mode) ? sel.delete(mode) : sel.add(mode);
      return { ...p, [focusId]: { ...rec, selected: sel } };
    });

  const addCustomMode = (ff: Func, val: string) => {
    if (!val.trim()) return;
    setModesByFocus(p => {
      const rec  = p[ff.id] || { options: [], selected: new Set<string>(), loading: false };
      const opts = Array.from(new Set([...rec.options, val.trim()]));
      const sel  = new Set(rec.selected); sel.add(val.trim());
      return { ...p, [ff.id]: { options: opts, selected: sel, loading: false } };
    });
  };

  // ── Generate all causes ──────────────────────────────────────────────────

  const generateAllCauses = async () => {
    if (!focusElement) return;
    setCausesLoading(true);
    setCausesGenerated(false);
    setCauseGroups([]);

    const groups: CauseGroup[] = [];
    const cleanNoise = Object.fromEntries(
      Object.entries(noiseFromPDiagram).map(([k, arr]) => [k, arr.filter(Boolean)])
    );

    for (const ff of focusFunctions) {
      const modes = Array.from(modesByFocus[ff.id]?.selected || []);
      if (!modes.length) continue;

      const lowerIds   = connections.lower_to_focus.filter(([, fid]) => fid === ff.id).map(([lid]) => lid);
      const lowerConns = lowerFunctions
        .filter(lf => lowerIds.includes(lf.id))
        .map(lf => ({ lower_element: lf.elementName, lower_function: lf.name }));
      if (!lowerConns.length) continue;

      try {
        const r    = await fetch(`${apiBase}/api/dfmea/failure-causes/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            focus_element:     focusElement.name,
            focus_function:    ff.name,
            failure_modes:     modes,
            lower_connections: lowerConns,
            noise_factors:     cleanNoise,
          }),
        });
        const data = await r.json();
        for (const g of data.groups || []) {
          groups.push({
            focus_fn_id:    ff.id,
            focus_function: ff.name,
            failure_mode:   g.failure_mode,
            lower_element:  g.lower_element,
            lower_function: g.lower_function,
            causes: (g.causes || []).map((c: { cause: string; noise_category: string; noise_factor: string }) => ({
              id:                 uid("c"),
              cause:              c.cause,
              noise_category:     c.noise_category,
              noise_factor:       c.noise_factor,
              noise_driven:       true,   // Case 1: every generated cause is noise-driven by definition
              selected:           false,
              prevention_methods: "",
              detection_methods:  "",
              occurrence_answer:  "",
              detection_answer:   "",
            })),
          });
        }
      } catch (e) { console.error("Cause generation failed:", ff.name, e); }
    }

    setCauseGroups(groups);
    setCausesLoading(false);
    setCausesGenerated(true);
  };

  // ── Cause helpers ────────────────────────────────────────────────────────

  const toggleCause = (gi: number, cId: string) =>
    setCauseGroups(p => p.map((g, i) =>
      i !== gi ? g : { ...g, causes: g.causes.map(c => c.id === cId ? { ...c, selected: !c.selected } : c) }
    ));

  const updateCauseField = (gi: number, cId: string, field: keyof CauseItem, val: string) =>
    setCauseGroups(p => p.map((g, i) =>
      i !== gi ? g : { ...g, causes: g.causes.map(c => c.id === cId ? { ...c, [field]: val } : c) }
    ));

  const totalSelected = useMemo(
    () => causeGroups.reduce((acc, g) => acc + g.causes.filter(c => c.selected).length, 0),
    [causeGroups]
  );
  const totalRated = useMemo(
    () => causeGroups.reduce(
      (acc, g) => acc + g.causes.filter(c => c.selected && c.occurrence_answer && c.detection_answer).length, 0
    ),
    [causeGroups]
  );

  // ── Build final rows ─────────────────────────────────────────────────────

  const buildFinalRows = async () => {
    if (!focusElement) return;
    setRowsLoading(true);
    const draft: DFMEARow[] = [];

    for (const group of causeGroups) {
      const ff = focusFunctions.find(f => f.id === group.focus_fn_id);
      if (!ff) continue;
      const higherIds   = connections.focus_to_higher.filter(([fid]) => fid === ff.id).map(([, hid]) => hid);
      const higherConns = higherFunctions.filter(hf => higherIds.includes(hf.id));

      for (const cause of group.causes.filter(c => c.selected)) {
        const rated = cause.occurrence_answer && cause.detection_answer
          ? computeRating(cause.occurrence_answer, cause.detection_answer, 5)
          : { occurrence: undefined, detection: undefined, rpn: undefined, action_priority: "" };

        for (const hf of higherConns) {
          draft.push({
            id:                 uid("row"),
            focus_element:      focusElement.name,
            focus_function:     ff.name,
            failure_mode:       group.failure_mode,
            lower_element:      group.lower_element,
            lower_function:     group.lower_function,
            noise_factor:       `${cause.noise_category}: ${cause.noise_factor}`,
            failure_cause:      cause.cause,
            higher_element:     hf.elementName,
            higher_function:    hf.name,
            failure_effect:     "",
            severity:           undefined,
            prevention_methods: cause.prevention_methods,
            detection_methods:  cause.detection_methods,
            occurrence:         rated.occurrence,
            detection:          rated.detection,
            rpn:                rated.rpn,
            action_priority:    rated.action_priority ?? "",
            occurrence_answer:  cause.occurrence_answer,
            detection_answer:   cause.detection_answer,
          });
        }
      }
    }

    if (draft.length) {
      try {
        const r    = await fetch(`${apiBase}/api/dfmea/failure-effects/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: draft.map(row => ({
              row_id: row.id, focus_element: row.focus_element,
              focus_function: row.focus_function, failure_mode: row.failure_mode,
              higher_element: row.higher_element, higher_function: row.higher_function,
            })),
          }),
        });
        const data = await r.json();
        const effectMap: Record<string, string> = {};
        for (const res of data.results || []) effectMap[res.row_id] = res.failure_effect;
        draft.forEach(row => { if (effectMap[row.id]) row.failure_effect = effectMap[row.id]; });
      } catch (e) { console.error("Effects fetch failed:", e); }
    }

    if (draft.length) {
      try {
        const r = await fetch(`${apiBase}/api/dfmea/severity-rate/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: draft.map(row => ({
              row_id: row.id, higher_function: row.higher_function, failure_effect: row.failure_effect,
            })),
          }),
        });
        const data = await r.json();
        const severityMap: Record<string, number> = {};
        for (const res of (data.results ?? [])) severityMap[res.row_id] = res.severity_rank;
        draft.forEach(row => {
          const s = severityMap[row.id];
          if (s) {
            row.severity = s;
            if (row.occurrence_answer && row.detection_answer) {
              const { occurrence, detection, rpn, action_priority } =
                computeRating(row.occurrence_answer, row.detection_answer, s);
              row.occurrence = occurrence; row.detection = detection;
              row.rpn = rpn; row.action_priority = action_priority;
            }
          }
        });
      } catch (e) { console.error("Severity fetch failed:", e); }
    }

    setRows(draft);
    setRowsLoading(false);
    setStep(9);
  };

  // ── Export CSV ───────────────────────────────────────────────────────────

  const exportCsv = () => {
    const headers = [
      "Focus Element", "Focus Function", "Failure Mode",
      "Lower Element", "Lower Function", "Noise Factor", "Failure Cause",
      "Higher Element", "Higher Function", "Failure Effect",
      "Severity (S)", "Occurrence (O)", "Detection (D)", "RPN", "Action Priority",
      "Prevention Methods", "Detection Methods",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [headers.map(esc).join(",")]
      .concat(rows.map(r => [
        r.focus_element, r.focus_function, r.failure_mode,
        r.lower_element, r.lower_function, r.noise_factor, r.failure_cause,
        r.higher_element, r.higher_function, r.failure_effect,
        r.severity ?? "", r.occurrence ?? "", r.detection ?? "", r.rpn ?? "", r.action_priority,
        r.prevention_methods, r.detection_methods,
      ].map(esc).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "dfmea.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportTemplateXlsx = async () => {
    if (!rows.length) return;
    const payload = {
      rows: rows.map(r => ({
        focus_element: r.focus_element, focus_function: r.focus_function,
        failure_mode: r.failure_mode, failure_effect: r.failure_effect,
        severity: r.severity ?? null, failure_cause: r.failure_cause,
        prevention_methods: r.prevention_methods, detection_methods: r.detection_methods,
        detection: r.detection ?? null, rpn: r.rpn ?? null,
      })),
    };
    const res = await fetch(`${apiBase}/api/dfmea/export/template`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!res.ok) { console.error("Template export failed", await res.text()); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "DFMEA_filled.xlsx"; a.click();
    URL.revokeObjectURL(url);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP RENDERERS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Step 0 ── Elements ────────────────────────────────────────────────────
  const StepElements = (
    <Section title="Elements" subtitle="Define lower-level, focus, and higher-level elements.">
      {/* Case 2 / 3 import banner */}
      {mode !== "new_design" && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-3 ${
          mode === "new_use_case"
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-green-50  border-green-200  text-green-800"
        }`}>
          <div className="mt-0.5 shrink-0 text-base">{mode === "new_use_case" ? "🔄" : "🔧"}</div>
          <div>
            <div className="font-semibold">
              {mode === "new_use_case"
                ? "New use case — elements imported from existing DFMEA"
                : "Design change — elements imported from existing DFMEA"}
            </div>
            <div className="text-xs mt-0.5 opacity-80">
              {mode === "new_use_case"
                ? "Element names and functions are pre-filled. You will enter new noise factors in the P-Diagram step."
                : "Element names and functions are pre-filled. Noise factors are retained. Re-draw B-Diagram connections and regenerate causes."}
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <Label className="font-semibold">Lower-level elements</Label>
          {lowerElements.map((el, i) => (
            <div key={el.id} className="flex gap-2">
              <Input placeholder={`Lower element ${i + 1}`} value={el.name}
                onChange={e => setLowerElements(p => p.map(x => x.id === el.id ? { ...x, name: e.target.value } : x))} />
              <Button variant="ghost" size="icon" onClick={() => setLowerElements(p => p.filter(x => x.id !== el.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addLowerElement}>
            <Plus className="h-4 w-4 mr-1" />Add lower element
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="font-semibold">Focus element</Label>
          {!focusElement ? (
            <Button variant="secondary" size="sm"
              onClick={() => setFocusElement({ id: uid("el"), name: "", level: "focus" })}>
              Set focus element
            </Button>
          ) : (
            <div className="flex gap-2">
              <Input placeholder="Focus element" value={focusElement.name}
                onChange={e => setFocusElement({ ...focusElement, name: e.target.value })} />
              <Button variant="ghost" size="icon" onClick={() => setFocusElement(null)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="font-semibold">Higher-level elements</Label>
          {higherElements.map((el, i) => (
            <div key={el.id} className="flex gap-2">
              <Input placeholder={`Higher element ${i + 1}`} value={el.name}
                onChange={e => setHigherElements(p => p.map(x => x.id === el.id ? { ...x, name: e.target.value } : x))} />
              <Button variant="ghost" size="icon" onClick={() => setHigherElements(p => p.filter(x => x.id !== el.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addHigherElement}>
            <Plus className="h-4 w-4 mr-1" />Add higher element
          </Button>
        </div>
      </div>
    </Section>
  );

  // ── Step 1 ── B-Diagram ───────────────────────────────────────────────────
  const StepBDiagram = (
    <Section
      title="B-Diagram (Boundary Diagram)"
      subtitle="Click any two boxes to draw a connection. Choose the type first: P = Physical, E = Energy, I = Information, M = Material. Hover a connection and click × to remove it. Download as SVG or PNG."
    >
      {/* Case 3: explain boxes are imported, connections are empty */}
      {mode === "design_change" && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3 text-sm text-green-800 mb-2">
          <span className="mt-0.5 shrink-0">🔧</span>
          <div>
            <div className="font-semibold">Element boxes imported — connections are empty</div>
            <div className="text-xs opacity-80 mt-0.5">Re-draw connections to reflect the new design. Switch to "Draw connections" mode and connect boxes.</div>
          </div>
        </div>
      )}
      {!focusElement?.name && !lowerElements.length && !higherElements.length ? (
        <p className="text-sm text-muted-foreground">
          Go back to Step 1 and define your elements first.
        </p>
      ) : (
        <BDiagramSVG
          focusName={focusElement?.name ?? "Focus System"}
          lowerNames={lowerElements.map(e => e.name).filter(Boolean)}
          higherNames={higherElements.map(e => e.name).filter(Boolean)}
          conns={bConns}
          setConns={setBConns}
        />
      )}
    </Section>
  );

  // ── Step 2 ── IFMEA ─────────────────────────────────────────────────────────
  const StepIFMEA = (
    <Section title="IFMEA — Interface Failure Mode & Effects Analysis"
      subtitle="Each connection drawn in the B-Diagram is one interface to analyse. Describe what it transfers, generate interface failure modes, then generate and rate causes.">

      {bConns.length === 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          No connections drawn yet. Go back to the B-Diagram step and draw at least one connection.
        </div>
      )}

      {bConns.length > 0 && (
        <>
          {/* Phase tabs */}
          <div className="flex rounded-lg border overflow-hidden w-fit">
            {([["matrix","0. Interface Matrix"],["modes","1. Failure Modes"],["causes","2. Causes"],["rate","3. Rate & Build"]] as const).map(([ph, label]) => (
              <button key={ph} type="button" onClick={() => setIfmeaPhase(ph)}
                className={`px-4 py-1.5 text-xs font-semibold transition-colors ${ifmeaPhase === ph ? "bg-primary text-primary-foreground" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Phase 0: Interface Matrix ── */}
          {ifmeaPhase === "matrix" && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Rate the interaction between every pair of elements using the four interface types.</p>
                <p className="font-medium">Rating scale: <span className="text-green-700">+2</span> = necessary for function &nbsp; <span className="text-green-600">+1</span> = beneficial &nbsp; <span className="text-gray-500">0</span> = no effect &nbsp; <span className="text-orange-600">−1</span> = negative but not preventing &nbsp; <span className="text-red-600">−2</span> = must be prevented</p>
                <p className="text-gray-400">Diagonal cells are greyed out (element cannot interface with itself). Leave blank if not applicable.</p>
              </div>

              {allElementNames.length < 2 ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  Define at least two elements in Step 1 to build the matrix.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                  <table className="border-collapse text-[11px] w-full">
                    <thead>
                      {/* Connection type legend row */}
                      <tr>
                        <th className="border border-gray-200 bg-gray-50 p-2 text-left min-w-[140px]">
                          <div className="grid grid-cols-2 gap-0.5 text-[9px]">
                            {(["P","E","I","M"] as ConnType[]).map(t => (
                              <span key={t} className="flex items-center gap-0.5 font-bold" style={{ color: CONN_META[t].color }}>
                                <span className="w-3 h-3 rounded-sm flex items-center justify-center text-white text-[8px]" style={{ background: CONN_META[t].color }}>{t}</span>
                                {CONN_META[t].label}
                              </span>
                            ))}
                          </div>
                        </th>
                        {allElementNames.map(col => (
                          <th key={col} className="border border-gray-200 bg-gray-100 p-1.5 font-semibold text-gray-700 text-center min-w-[88px]">
                            <div className="text-[10px] leading-tight">{col}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allElementNames.map((rowEl, ri) => (
                        <tr key={rowEl} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                          <td className="border border-gray-200 bg-gray-100 p-1.5 font-semibold text-gray-700 min-w-[140px]">
                            <div className="text-[10px] leading-tight">{rowEl}</div>
                          </td>
                          {allElementNames.map((colEl, ci) => {
                            const isDiag = rowEl === colEl;
                            const k = matrixKey(rowEl, colEl);
                            const cell = ifmeaMatrix[k] ?? emptyCell();

                            if (isDiag) {
                              return (
                                <td key={colEl} className="border border-gray-200 bg-gray-200/60 p-0" />
                              );
                            }

                            return (
                              <td key={colEl} className="border border-gray-200 p-1 align-top">
                                {/* 2×2 mini-grid: P top-left, E top-right, I bottom-left, M bottom-right */}
                                <div className="grid grid-cols-2 gap-0.5">
                                  {(["P","E","I","M"] as ConnType[]).map(t => (
                                    <div key={t} className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] font-bold leading-none" style={{ color: CONN_META[t].color }}>{t}</span>
                                      <select
                                        value={cell[t] === null ? "" : String(cell[t])}
                                        onChange={e => setMatrixCell(rowEl, colEl, t, e.target.value === "" ? null : parseInt(e.target.value))}
                                        className="w-9 h-6 text-[10px] text-center border rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                                        style={{
                                          background: cell[t] === null ? "#f9f9f9"
                                            : cell[t]! >= 2  ? "#dcfce7"
                                            : cell[t]! === 1 ? "#f0fdf4"
                                            : cell[t]! === 0 ? "#f9fafb"
                                            : cell[t]! === -1 ? "#fff7ed"
                                            : "#fef2f2",
                                          color: cell[t] === null ? "#9ca3af"
                                            : cell[t]! >= 2  ? "#15803d"
                                            : cell[t]! === 1 ? "#166534"
                                            : cell[t]! === 0 ? "#6b7280"
                                            : cell[t]! === -1 ? "#c2410c"
                                            : "#b91c1c",
                                          fontWeight: cell[t] !== null && cell[t] !== 0 ? "700" : "400",
                                        }}
                                      >
                                        <option value="">–</option>
                                        <option value="2">+2</option>
                                        <option value="1">+1</option>
                                        <option value="0">0</option>
                                        <option value="-1">−1</option>
                                        <option value="-2">−2</option>
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Critical interfaces summary: any cell with -2 */}
              {(() => {
                const critical: { from: string; to: string; types: ConnType[] }[] = [];
                for (const [k, cell] of Object.entries(ifmeaMatrix)) {
                  const [from, to] = k.split("::");
                  const critTypes = (["P","E","I","M"] as ConnType[]).filter(t => cell[t] === -2);
                  if (critTypes.length) critical.push({ from, to, types: critTypes });
                }
                if (!critical.length) return null;
                return (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Critical interfaces (−2: must be prevented) — these should be priority IFMEA subjects
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {critical.map(({ from, to, types }) => (
                        <div key={`${from}::${to}`} className="flex items-center gap-1 px-2 py-1 bg-white rounded border border-red-200 text-xs">
                          <span className="font-medium text-gray-700">{from}</span>
                          <span className="text-gray-400">→</span>
                          <span className="font-medium text-gray-700">{to}</span>
                          <span className="text-red-600 font-bold ml-1">({types.join(", ")})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-between items-center pt-2">
                <Button variant="outline" size="sm" onClick={() => setIfmeaMatrix({})}>
                  Reset matrix
                </Button>
                <Button onClick={() => setIfmeaPhase("modes")}>
                  Next: Failure Modes <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase 1: Describe + generate failure modes ── */}
          {ifmeaPhase === "modes" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                For each interface, describe what is nominally transferred, then generate interface failure modes.
              </p>
              {ifmeaInterfaces.map(iface => {
                const meta = CONN_META[iface.connType];
                const selectedCount = iface.modes.filter(m => m.selected).length;
                return (
                  <Card key={iface.id} className="border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-xs font-bold text-white" style={{ background: meta.color }}>{iface.connType}</span>
                        <span className="font-semibold text-sm">{iface.fromElement}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{iface.toElement}</span>
                        <span className="text-xs text-muted-foreground">({meta.label})</span>
                        {selectedCount > 0 && <Badge variant="default" className="ml-auto">{selectedCount} modes selected</Badge>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold">What is nominally transferred through this interface?</Label>
                        <Input className="text-sm"
                          placeholder={
                            iface.connType === "P" ? "e.g. Axial load 0–50 kN via spline coupling"
                            : iface.connType === "E" ? "e.g. Drive torque 0–2000 Nm at 0–3000 rpm"
                            : iface.connType === "I" ? "e.g. CAN brake command, 10ms cycle, 0–4096 Nm range"
                            : "e.g. Hydraulic fluid 0–200 bar, 2 L/min flow"
                          }
                          value={iface.nominalTransfer}
                          onChange={e => updateIfmeaTransfer(iface.id, e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">Interface failure modes</Label>
                          <Button size="sm" variant="secondary"
                            disabled={iface.modesLoading || !iface.nominalTransfer.trim()}
                            onClick={() => fetchIfmeaModes(iface)}>
                            {iface.modesLoading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</> : "Generate modes"}
                          </Button>
                        </div>
                        {!iface.modesGenerated && !iface.modesLoading && (
                          <p className="text-xs text-muted-foreground italic">Fill in nominal transfer above, then click Generate modes.</p>
                        )}
                        {iface.modes.length > 0 && (
                          <div className="space-y-1.5">
                            {iface.modes.map(m => (
                              <label key={m.id} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer text-sm transition-all ${m.selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                                <Checkbox className="mt-0.5 shrink-0" checked={m.selected} onCheckedChange={() => toggleIfmeaMode(iface.id, m.id)} />
                                <span className="leading-snug">{m.mode}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              <div className="flex justify-end">
                <Button onClick={() => setIfmeaPhase("causes")}>
                  Next: Generate Causes <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase 2: Generate + select causes ── */}
          {ifmeaPhase === "causes" && (
            <div className="space-y-4">
              {!ifmeaCausesGenerated ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Causes are generated for each selected interface failure mode × noise factor combination.
                    Causes must originate in the interface mechanism itself — not inside either connected element.
                  </p>
                  <Button onClick={generateIfmeaCauses} disabled={ifmeaCausesLoading}>
                    {ifmeaCausesLoading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                      : <><Zap className="h-4 w-4 mr-2" />Generate all interface causes</>}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{ifmeaTotalSelected} selected</Badge>
                      <span className="text-muted-foreground">across {ifmeaCauseGroups.length} groups</span>
                    </div>
                    <Button size="sm" variant="outline" disabled={ifmeaCausesLoading} onClick={generateIfmeaCauses}>
                      {ifmeaCausesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate"}
                    </Button>
                  </div>
                  {ifmeaCauseGroups.map((group, gi) => {
                    const sel = group.causes.filter(c => c.selected).length;
                    return (
                      <Collapsible key={gi}
                        title={`${group.fromElement} → ${group.toElement}  |  ${group.failureMode}`}
                        badge={`${sel} / ${group.causes.length}`}
                        badgeVariant={sel > 0 ? "default" : "secondary"}>
                        {!group.causes.length
                          ? <p className="text-sm text-muted-foreground">No causes generated.</p>
                          : (
                            <div className="space-y-2">
                              {group.causes.map(cause => (
                                <label key={cause.id} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${cause.selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                                  <Checkbox className="mt-0.5 shrink-0" checked={cause.selected} onCheckedChange={() => toggleIfmeaCause(gi, cause.id)} />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium leading-snug">{cause.cause}</p>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">{cause.noise_factor}</span>
                                      <span className="text-[10px] text-muted-foreground">{cause.noise_category}</span>
                                    </div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                      </Collapsible>
                    );
                  })}
                  {ifmeaTotalSelected > 0 && (
                    <div className="flex justify-end pt-1">
                      <Button onClick={() => setIfmeaPhase("rate")}>Next: Rate Causes <ArrowRight className="h-4 w-4 ml-2" /></Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Phase 3: Rate causes + build rows ── */}
          {ifmeaPhase === "rate" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all"
                    style={{ width: ifmeaTotalSelected ? `${(ifmeaTotalRated / ifmeaTotalSelected) * 100}%` : "0%" }} />
                </div>
                <span className="text-sm font-medium shrink-0">{ifmeaTotalRated} / {ifmeaTotalSelected} rated</span>
                {ifmeaTotalRated < ifmeaTotalSelected && (
                  <span className="flex items-center gap-1 text-amber-600 text-xs shrink-0">
                    <AlertTriangle className="h-3 w-3" />Incomplete
                  </span>
                )}
              </div>
              {ifmeaCauseGroups.map((group, gi) => {
                const selected = group.causes.filter(c => c.selected);
                if (!selected.length) return null;
                const ratedCount = selected.filter(c => c.occurrence_answer && c.detection_answer).length;
                return (
                  <Collapsible key={gi} defaultOpen={gi === 0}
                    title={`${group.fromElement} → ${group.toElement}  |  ${group.failureMode}`}
                    badge={`${ratedCount} / ${selected.length}`}
                    badgeVariant={ratedCount === selected.length ? "default" : "secondary"}>
                    <div className="space-y-6">
                      {selected.map(cause => {
                        const rating = cause.occurrence_answer && cause.detection_answer
                          ? computeRating(cause.occurrence_answer, cause.detection_answer, 5) : null;
                        return (
                          <div key={cause.id} className="border rounded-lg p-4 space-y-4">
                            <div>
                              <p className="font-medium text-sm">{cause.cause}</p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">{cause.noise_factor}</span>
                                <span className="text-[10px] text-muted-foreground">{cause.noise_category}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-sm font-semibold">Prevention Methods</Label>
                                <Textarea rows={2} className="text-sm resize-none"
                                  placeholder="e.g. IP67 connector, conformal coating, CRC validation…"
                                  value={cause.prevention_methods}
                                  onChange={e => updateIfmeaCauseField(gi, cause.id, "prevention_methods", e.target.value)} />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-semibold">Detection Methods</Label>
                                <Textarea rows={2} className="text-sm resize-none"
                                  placeholder="e.g. Signal plausibility check, continuity test, EMC test…"
                                  value={cause.detection_methods}
                                  onChange={e => updateIfmeaCauseField(gi, cause.id, "detection_methods", e.target.value)} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-semibold">How likely will this interface cause occur?</Label>
                              <OptionPills options={OCCURRENCE_OPTIONS} value={cause.occurrence_answer}
                                onChange={v => updateIfmeaCauseField(gi, cause.id, "occurrence_answer", v)} />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-semibold">How likely will this be detected before affecting the receiving element?</Label>
                              <OptionPills options={DETECTION_OPTIONS} value={cause.detection_answer}
                                onChange={v => updateIfmeaCauseField(gi, cause.id, "detection_answer", v)} />
                            </div>
                            {rating && (
                              <div className="flex flex-wrap gap-2 pt-1 border-t items-center">
                                <Badge variant="outline">O = {rating.occurrence}</Badge>
                                <Badge variant="outline">D = {rating.detection}</Badge>
                                <RpnBadge rpn={rating.rpn!} />
                                <ApBadge ap={rating.action_priority} />
                                <span className="text-xs text-muted-foreground ml-1">(S=5 default — update in Review)</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Collapsible>
                );
              })}
              <div className="flex justify-end pt-2">
                <Button onClick={buildIfmeaRows} disabled={ifmeaRowsLoading}>
                  {ifmeaRowsLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Building IFMEA rows…</>
                    : <>Build IFMEA rows <ArrowRight className="h-4 w-4 ml-2" /></>}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );

  // ── Step 2 ── Functions ───────────────────────────────────────────────────
  const StepFunctions = (
    <Section title="Functions" subtitle="Add one or more functions for each element.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        <div>
          <Label className="font-semibold mb-3 block">Lower elements & functions</Label>
          {!lowerElements.length && <p className="text-sm text-muted-foreground">Add lower elements first.</p>}
          {lowerElements.map(el => (
            <Card key={el.id} className="mb-3">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{el.name || "(unnamed)"}</span>
                  <Button size="sm" variant="secondary" onClick={() => addFunction(el.name, "lower")}>
                    <Plus className="h-3 w-3 mr-1" />Add
                  </Button>
                </div>
                {functions.filter(f => f.elementName === el.name && f.level === "lower").map(fn => (
                  <div key={fn.id} className="flex gap-2">
                    <Input className="text-sm" placeholder="Function name" value={fn.name}
                      onChange={e => updateFunction(fn.id, e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => removeFunction(fn.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <Label className="font-semibold mb-3 block">Focus element & functions</Label>
          {!focusElement
            ? <p className="text-sm text-muted-foreground">Set the focus element first.</p>
            : (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{focusElement.name || "(unnamed)"}</span>
                    <Button size="sm" variant="secondary" onClick={() => addFunction(focusElement.name, "focus")}>
                      <Plus className="h-3 w-3 mr-1" />Add
                    </Button>
                  </div>
                  {functions.filter(f => f.elementName === focusElement.name && f.level === "focus").map(fn => (
                    <div key={fn.id} className="flex gap-2">
                      <Input className="text-sm" placeholder="Function name" value={fn.name}
                        onChange={e => updateFunction(fn.id, e.target.value)} />
                      <Button variant="ghost" size="icon" onClick={() => removeFunction(fn.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
        </div>

        <div>
          <Label className="font-semibold mb-3 block">Higher elements & functions</Label>
          {!higherElements.length && <p className="text-sm text-muted-foreground">Add higher elements first.</p>}
          {higherElements.map(el => (
            <Card key={el.id} className="mb-3">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{el.name || "(unnamed)"}</span>
                  <Button size="sm" variant="secondary" onClick={() => addFunction(el.name, "higher")}>
                    <Plus className="h-3 w-3 mr-1" />Add
                  </Button>
                </div>
                {functions.filter(f => f.elementName === el.name && f.level === "higher").map(fn => (
                  <div key={fn.id} className="flex gap-2">
                    <Input className="text-sm" placeholder="Function name" value={fn.name}
                      onChange={e => updateFunction(fn.id, e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => removeFunction(fn.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

      </div>
    </Section>
  );

  // ── Step 3 ── P-Diagram ───────────────────────────────────────────────────
  const StepPDiagram = (
    <Section
      title="P-Diagram (Parameter Diagram)"
      subtitle="Fill in the P-diagram. Functions and Outputs are pre-populated from Step 3. Noise factors here will drive the Failure Causes step."
    >
      {/* Case 2: show old noise factors user is replacing */}
      {mode === "new_use_case" && (initialState?.oldNoiseFactors?.flat?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🔄</span>
            <div className="font-semibold text-sm text-amber-900">Old noise factors — replace with your new operating conditions</div>
          </div>
          <p className="text-xs text-amber-700">
            These drove failure causes in the original DFMEA. Clear them below and add your new environment.
            Causes will be re-generated only for new noise factors you enter.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(initialState?.oldNoiseFactors?.flat ?? []).map((nf, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 line-through opacity-60">{nf}</span>
            ))}
          </div>
        </div>
      )}
      {/* Case 3: confirm noise retained */}
      {mode === "design_change" && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3 text-sm text-green-800 mb-2">
          <span className="mt-0.5 shrink-0">🔧</span>
          <div>
            <div className="font-semibold">Noise factors retained from original DFMEA</div>
            <div className="text-xs opacity-80 mt-0.5">The operating environment is unchanged. Edit if needed, then re-generate causes for modified components.</div>
          </div>
        </div>
      )}
      <PDiagramView
        pDiagram={pDiagram}
        focusName={focusElement?.name ?? ""}
        setPDiagram={setPDiagram}
      />
      {/* Noise summary preview */}
      {Object.keys(noiseFromPDiagram).length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <p className="text-xs font-semibold text-blue-700 mb-1">
            Noise factors that will be used in cause generation:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(noiseFromPDiagram).flatMap(([cat, items]) =>
              items.map(item => (
                <Badge key={`${cat}:${item}`} variant="secondary" className="text-xs">
                  {cat}: {item}
                </Badge>
              ))
            )}
          </div>
        </div>
      )}
    </Section>
  );

  // ── Step 4 ── Connections ─────────────────────────────────────────────────
  const StepConnections = (
    <Section title="Connections" subtitle="Link lower functions → focus function → higher functions.">
      {suggestLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Auto-suggesting connections…
        </div>
      )}
      {!focusFunctions.length
        ? <p className="text-sm text-muted-foreground">Add at least one focus function first.</p>
        : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={suggestLoading} onClick={fetchAndApplySuggestions}>
                {suggestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                Re-suggest connections
              </Button>
            </div>
            {focusFunctions.map(ff => (
              <Card key={ff.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Link2 className="h-4 w-4 text-primary" />
                    Focus: {ff.name || "(unnamed)"}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">
                        Lower → Focus
                      </Label>
                      <div className="space-y-2">
                        {lowerFunctions.map(lf => (
                          <label key={lf.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={connections.lower_to_focus.some(([l, f]) => l === lf.id && f === ff.id)}
                              onCheckedChange={() => toggleLowerToFocus(lf.id, ff.id)}
                            />
                            <span className="truncate">{lf.elementName} · {lf.name || "(unnamed)"}</span>
                          </label>
                        ))}
                        {!lowerFunctions.length && <p className="text-xs text-muted-foreground">No lower functions.</p>}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">
                        Focus → Higher
                      </Label>
                      <div className="space-y-2">
                        {higherFunctions.map(hf => (
                          <label key={hf.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={connections.focus_to_higher.some(([f, h]) => f === ff.id && h === hf.id)}
                              onCheckedChange={() => toggleFocusToHigher(ff.id, hf.id)}
                            />
                            <span className="truncate">{hf.elementName} · {hf.name || "(unnamed)"}</span>
                          </label>
                        ))}
                        {!higherFunctions.length && <p className="text-xs text-muted-foreground">No higher functions.</p>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </Section>
  );

  // ── Step 5 ── Failure modes ───────────────────────────────────────────────
  const StepModes = (
    <Section title="Failure Modes" subtitle="Generate and select failure modes per focus function.">

      {/* Case 2: old failure modes with noise context */}
      {mode === "new_use_case" && (initialState?.failureModes?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 mb-2">
          <div className="flex items-center gap-2">
            <span>🔄</span>
            <div className="font-semibold text-sm text-amber-900">Old failure modes from imported DFMEA ({initialState!.failureModes!.length})</div>
          </div>
          <p className="text-xs text-amber-700">These existed for the old conditions. Generate fresh below — AI adapts to your new noise factors.</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {initialState!.failureModes!.map((m, i) => (
              <div key={i} className="bg-white rounded-lg border border-amber-100 px-3 py-2 text-xs">
                <div className="font-medium text-gray-700">{m.failure_mode}</div>
                <div className="text-gray-400 mt-0.5 text-[10px]">{m.focus_fn}</div>
                {(m.old_noise_factors?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.old_noise_factors!.map((nf, j) => (
                      <span key={j} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[9px] line-through opacity-60">{nf}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Case 3: reference panel with old modes + S/O/D */}
      {mode === "design_change" && (initialState?.failureModes?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3 mb-2">
          <div className="flex items-center gap-2">
            <span>🔧</span>
            <div className="font-semibold text-sm text-green-900">Reference: original failure modes ({initialState!.failureModes!.length})</div>
          </div>
          <p className="text-xs text-green-700">These existed in the old design. Generate modes for the new design and compare in Review.</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {initialState!.failureModes!.map((m, i) => {
              const sod = initialState?.sodReference?.[m.lower_elements?.[0] ?? ""];
              return (
                <div key={i} className="bg-white rounded-lg border border-green-100 px-3 py-2 text-xs flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-700">{m.failure_mode}</div>
                    <div className="text-gray-400 text-[10px] mt-0.5">{m.failure_effect}</div>
                  </div>
                  {sod && (
                    <div className="shrink-0 flex gap-1 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-100 text-red-600 font-medium">S={sod.max_severity}</span>
                      <span className="px-1.5 py-0.5 rounded bg-orange-50 border border-orange-100 text-orange-600 font-medium">O≈{sod.avg_occurrence}</span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-600 font-medium">D≈{sod.avg_detection}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!focusFunctions.length
        ? <p className="text-sm text-muted-foreground">Add focus functions first.</p>
        : (
          <div className="space-y-4">
            {focusFunctions.map(ff => {
              const rec = modesByFocus[ff.id];
              return (
                <Card key={ff.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-medium text-sm">Focus: {ff.name || "(unnamed)"}</span>
                      <Button size="sm" variant="secondary" disabled={rec?.loading} onClick={() => fetchModes(ff)}>
                        {rec?.loading
                          ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</>
                          : "Generate modes"}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">Generated</Label>
                        {!rec || !rec.options.length
                          ? <p className="text-sm text-muted-foreground">Click "Generate modes".</p>
                          : (
                            <div className="space-y-2">
                              {rec.options.map(m => (
                                <label key={m} className="flex items-start gap-2 text-sm cursor-pointer">
                                  <Checkbox className="mt-0.5" checked={rec.selected.has(m)}
                                    onCheckedChange={() => toggleMode(ff.id, m)} />
                                  <span>{m}</span>
                                </label>
                              ))}
                            </div>
                          )}
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground mb-2 block">Add custom</Label>
                        <div className="flex gap-2">
                          <Input className="text-sm" placeholder="Type a failure mode" id={`cm_${ff.id}`}
                            onKeyDown={e => {
                              if (e.key === "Enter") { addCustomMode(ff, e.currentTarget.value); e.currentTarget.value = ""; }
                            }} />
                          <Button size="sm" onClick={() => {
                            const inp = document.getElementById(`cm_${ff.id}`) as HTMLInputElement;
                            if (inp) { addCustomMode(ff, inp.value); inp.value = ""; }
                          }}>Add</Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <div className="flex justify-end pt-1">
              <Button onClick={next}>
                Next: Generate Causes <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
    </Section>
  );

  // ── Step 6 ── Failure causes ──────────────────────────────────────────────
  const StepCauses = (
    <Section title="Failure Causes"
      subtitle="Generate all causes for selected failure modes, then select which to include.">
      {!causesGenerated ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Causes are generated for every selected failure mode × connected lower function × noise factor.
          </p>
          <Button onClick={generateAllCauses} disabled={causesLoading}>
            {causesLoading
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating causes…</>
              : <><Zap className="h-4 w-4 mr-2" />Generate all causes</>}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{totalSelected} selected</Badge>
              <span className="text-muted-foreground">across {causeGroups.length} groups</span>
            </div>
            <Button size="sm" variant="outline" disabled={causesLoading} onClick={generateAllCauses}>
              {causesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate"}
            </Button>
          </div>

          {causeGroups.map((group, gi) => {
            const selCount = group.causes.filter(c => c.selected).length;
            return (
              <Collapsible
                key={gi}
                title={`${group.failure_mode}  ←  ${group.lower_function} (${group.lower_element})`}
                badge={`${selCount} / ${group.causes.length}`}
                badgeVariant={selCount > 0 ? "default" : "secondary"}
              >
                {!group.causes.length
                  ? <p className="text-sm text-muted-foreground">No causes generated.</p>
                  : (
                    <div className="space-y-2">
                      {group.causes.map(cause => (
                        <label
                          key={cause.id}
                          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                            cause.selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                          }`}
                        >
                          <Checkbox className="mt-0.5 shrink-0" checked={cause.selected}
                            onCheckedChange={() => toggleCause(gi, cause.id)} />
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium leading-snug">{cause.cause}</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">
                                {cause.noise_factor}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{cause.noise_category}</span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
              </Collapsible>
            );
          })}

          {totalSelected > 0 && (
            <div className="flex justify-end pt-1">
              <Button onClick={next}>
                Next: Rate Causes <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );

  // ── Step 7 ── Risk rating ─────────────────────────────────────────────────
  const StepRating = (
    <Section title="Risk Rating"
      subtitle="For each selected cause: describe current controls, then answer the two rating questions.">

      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: totalSelected ? `${(totalRated / totalSelected) * 100}%` : "0%" }}
          />
        </div>
        <span className="text-sm font-medium shrink-0">{totalRated} / {totalSelected} rated</span>
        {totalRated < totalSelected && (
          <span className="flex items-center gap-1 text-amber-600 text-xs shrink-0">
            <AlertTriangle className="h-3 w-3" />Incomplete
          </span>
        )}
      </div>

      <div className="space-y-3">
        {causeGroups.map((group, gi) => {
          const selected = group.causes.filter(c => c.selected);
          if (!selected.length) return null;
          const ratedCount = selected.filter(c => c.occurrence_answer && c.detection_answer).length;
          return (
            <Collapsible
              key={gi}
              defaultOpen={gi === 0}
              title={`${group.failure_mode}  ←  ${group.lower_function}`}
              badge={`${ratedCount} / ${selected.length}`}
              badgeVariant={ratedCount === selected.length ? "default" : "secondary"}
            >
              <div className="space-y-6">
                {selected.map(cause => {
                  const rating = cause.occurrence_answer && cause.detection_answer
                    ? computeRating(cause.occurrence_answer, cause.detection_answer, 5)
                    : null;
                  return (
                    <div key={cause.id} className="border rounded-lg p-4 space-y-5">
                      <div>
                        <p className="font-medium text-sm">{cause.cause}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">{cause.noise_factor}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">{cause.noise_category}</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-semibold">Current Prevention Methods</Label>
                          <Textarea rows={2} className="text-sm resize-none"
                            placeholder="e.g. FEM simulation, Cpk study…"
                            value={cause.prevention_methods}
                            onChange={e => updateCauseField(gi, cause.id, "prevention_methods", e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-semibold">Current Detection Methods</Label>
                          <Textarea rows={2} className="text-sm resize-none"
                            placeholder="e.g. HIL test, EOL functional test, CISPR 25…"
                            value={cause.detection_methods}
                            onChange={e => updateCauseField(gi, cause.id, "detection_methods", e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">How likely will this failure cause occur?</Label>
                        <OptionPills options={OCCURRENCE_OPTIONS} value={cause.occurrence_answer}
                          onChange={v => updateCauseField(gi, cause.id, "occurrence_answer", v)} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">
                          How likely will this failure be detected before reaching the customer?
                        </Label>
                        <OptionPills options={DETECTION_OPTIONS} value={cause.detection_answer}
                          onChange={v => updateCauseField(gi, cause.id, "detection_answer", v)} />
                      </div>
                      {rating && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t items-center">
                          <Badge variant="outline">O = {rating.occurrence}</Badge>
                          <Badge variant="outline">D = {rating.detection}</Badge>
                          <RpnBadge rpn={rating.rpn!} />
                          <ApBadge ap={rating.action_priority} />
                          <span className="text-xs text-muted-foreground ml-1">
                            (S=5 default — update Severity in Review to recalculate)
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          );
        })}
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={buildFinalRows} disabled={rowsLoading}>
          {rowsLoading
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Building DFMEA…</>
            : <>Build DFMEA &amp; fetch effects <ArrowRight className="h-4 w-4 ml-2" /></>}
        </Button>
      </div>
    </Section>
  );

  // ── Step 9 ── Review & Export ─────────────────────────────────────────────
  const StepReview = (
    <Section title="Review & Export"
      subtitle="Edit cells inline. Set Severity — RPN auto-recalculates. Export DFMEA and IFMEA separately.">

      {/* Tab switcher */}
      <div className="flex rounded-lg border overflow-hidden w-fit mb-4">
        {([["dfmea","DFMEA"],["ifmea","IFMEA"]] as const).map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setReviewTab(tab)}
            className={`px-5 py-1.5 text-sm font-semibold transition-colors ${reviewTab === tab ? "bg-primary text-primary-foreground" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            {label}
            <Badge variant={reviewTab === tab ? "secondary" : "outline"} className="ml-2 text-xs">
              {tab === "dfmea" ? rows.length : ifmeaRows.length}
            </Badge>
          </button>
        ))}
      </div>

      {/* ── DFMEA tab ── */}
      {reviewTab === "dfmea" && (
        !rows.length
          ? <p className="text-sm text-muted-foreground">No DFMEA rows yet. Complete the Risk Rating step first.</p>
          : (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <Badge variant="outline">{rows.length} rows</Badge>
                <Badge variant={rows.filter(r => (r.rpn ?? 0) >= 200).length > 0 ? "destructive" : "outline"}>
                  {rows.filter(r => (r.rpn ?? 0) >= 200).length} high-risk (RPN ≥ 200)
                </Badge>
                <Badge variant="secondary">
                  {rows.filter(r => (r.rpn ?? 0) >= 100 && (r.rpn ?? 0) < 200).length} medium-risk
                </Badge>
                <Button size="sm" onClick={exportCsv}><CheckCircle2 className="h-4 w-4 mr-2" />Export DFMEA CSV</Button>
                <Button size="sm" variant="outline" onClick={exportTemplateXlsx}><Download className="h-4 w-4 mr-2" />Export XLSX</Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="min-w-[150px]">Focus Function</TableHead>
                      <TableHead className="min-w-[170px]">Failure Mode</TableHead>
                      <TableHead className="min-w-[190px]">Failure Cause</TableHead>
                      <TableHead className="min-w-[190px]">Failure Effect</TableHead>
                      <TableHead className="min-w-[70px] text-center">S</TableHead>
                      <TableHead className="min-w-[60px] text-center">O</TableHead>
                      <TableHead className="min-w-[60px] text-center">D</TableHead>
                      <TableHead className="min-w-[80px] text-center">RPN</TableHead>
                      <TableHead className="min-w-[60px] text-center">AP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={r.id} className={(r.rpn ?? 0) >= 200 ? "bg-red-50/50" : (r.rpn ?? 0) >= 100 ? "bg-amber-50/50" : ""}>
                        <TableCell className="text-xs align-top py-2">{r.focus_function}</TableCell>
                        <TableCell className="text-xs align-top py-2">{r.failure_mode}</TableCell>
                        <TableCell className="py-2">
                          <Input className="text-xs min-w-[170px]" value={r.failure_cause}
                            onChange={e => setRows(p => p.map((row, idx) => idx === i ? { ...row, failure_cause: e.target.value } : row))} />
                        </TableCell>
                        <TableCell className="py-2">
                          <Input className="text-xs min-w-[170px]" value={r.failure_effect}
                            onChange={e => setRows(p => p.map((row, idx) => idx === i ? { ...row, failure_effect: e.target.value } : row))} />
                        </TableCell>
                        <TableCell className="text-center py-2">
                          <Input type="number" min={1} max={10} className="w-14 text-xs text-center"
                            placeholder="1–10" value={r.severity ?? ""}
                            onChange={e => {
                              const s = e.target.value === "" ? undefined : Math.max(1, Math.min(10, Number(e.target.value)));
                              setRows(p => p.map((row, idx) => {
                                if (idx !== i) return row;
                                if (!s || !row.occurrence_answer || !row.detection_answer) return { ...row, severity: s };
                                const { occurrence, detection, rpn, action_priority } = computeRating(row.occurrence_answer, row.detection_answer, s);
                                return { ...row, severity: s, occurrence, detection, rpn, action_priority };
                              }));
                            }} />
                        </TableCell>
                        <TableCell className="text-center py-2"><Badge variant="outline" className="text-xs">{r.occurrence ?? "–"}</Badge></TableCell>
                        <TableCell className="text-center py-2"><Badge variant="outline" className="text-xs">{r.detection ?? "–"}</Badge></TableCell>
                        <TableCell className="text-center py-2">{r.rpn != null ? <RpnBadge rpn={r.rpn} /> : <span className="text-muted-foreground text-xs">–</span>}</TableCell>
                        <TableCell className="text-center py-2">{r.action_priority ? <ApBadge ap={r.action_priority} /> : <span className="text-muted-foreground text-xs">–</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )
      )}

      {/* ── IFMEA tab ── */}
      {reviewTab === "ifmea" && (
        !ifmeaRows.length
          ? <p className="text-sm text-muted-foreground">No IFMEA rows yet. Complete the IFMEA step (Step 3) first.</p>
          : (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <Badge variant="outline">{ifmeaRows.length} rows</Badge>
                <Badge variant={ifmeaRows.filter(r => (r.rpn ?? 0) >= 200).length > 0 ? "destructive" : "outline"}>
                  {ifmeaRows.filter(r => (r.rpn ?? 0) >= 200).length} high-risk (RPN ≥ 200)
                </Badge>
                <Button size="sm" onClick={exportIfmeaCsv}><CheckCircle2 className="h-4 w-4 mr-2" />Export IFMEA CSV</Button>
                <Button size="sm" variant="outline" onClick={exportMatrixCsv}><Download className="h-4 w-4 mr-2" />Export Matrix CSV</Button>
                <Button size="sm" variant="ghost" onClick={() => { setReviewTab("ifmea"); setStep(2); setIfmeaPhase("matrix"); }}>
                  View Matrix
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="min-w-[120px]">Interface</TableHead>
                      <TableHead className="min-w-[50px] text-center">Type</TableHead>
                      <TableHead className="min-w-[160px]">Failure Mode</TableHead>
                      <TableHead className="min-w-[180px]">Failure Cause</TableHead>
                      <TableHead className="min-w-[220px]">Failure Effect on Higher Function</TableHead>
                      <TableHead className="min-w-[70px] text-center">S</TableHead>
                      <TableHead className="min-w-[60px] text-center">O</TableHead>
                      <TableHead className="min-w-[60px] text-center">D</TableHead>
                      <TableHead className="min-w-[80px] text-center">RPN</TableHead>
                      <TableHead className="min-w-[60px] text-center">AP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ifmeaRows.map((r, i) => {
                      const meta = CONN_META[r.conn_type as ConnType] ?? CONN_META.P;
                      return (
                        <TableRow key={r.id} className={(r.rpn ?? 0) >= 200 ? "bg-red-50/50" : (r.rpn ?? 0) >= 100 ? "bg-amber-50/50" : ""}>
                          <TableCell className="text-xs py-2">
                            <div className="font-medium">{r.from_element}</div>
                            <div className="text-muted-foreground">→ {r.to_element}</div>
                          </TableCell>
                          <TableCell className="text-center py-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: meta.color }}>{r.conn_type}</span>
                          </TableCell>
                          <TableCell className="text-xs py-2">{r.failure_mode}</TableCell>
                          <TableCell className="py-2">
                            <Input className="text-xs min-w-[160px]" value={r.failure_cause}
                              onChange={e => setIfmeaRows(p => p.map((row, idx) => idx === i ? { ...row, failure_cause: e.target.value } : row))} />
                          </TableCell>
                          <TableCell className="py-2">
                            <Input className="text-xs min-w-[200px]" value={r.failure_effect}
                              onChange={e => setIfmeaRows(p => p.map((row, idx) => idx === i ? { ...row, failure_effect: e.target.value } : row))} />
                          </TableCell>
                          <TableCell className="text-center py-2">
                            <Input type="number" min={1} max={10} className="w-14 text-xs text-center"
                              placeholder="1–10" value={r.severity ?? ""}
                              onChange={e => {
                                const s = e.target.value === "" ? undefined : Math.max(1, Math.min(10, Number(e.target.value)));
                                setIfmeaRows(p => p.map((row, idx) => {
                                  if (idx !== i) return row;
                                  if (!s || !row.occurrence_answer || !row.detection_answer) return { ...row, severity: s };
                                  const { occurrence, detection, rpn, action_priority } = computeRating(row.occurrence_answer, row.detection_answer, s);
                                  return { ...row, severity: s, occurrence, detection, rpn, action_priority };
                                }));
                              }} />
                          </TableCell>
                          <TableCell className="text-center py-2"><Badge variant="outline" className="text-xs">{r.occurrence ?? "–"}</Badge></TableCell>
                          <TableCell className="text-center py-2"><Badge variant="outline" className="text-xs">{r.detection ?? "–"}</Badge></TableCell>
                          <TableCell className="text-center py-2">{r.rpn != null ? <RpnBadge rpn={r.rpn} /> : <span className="text-muted-foreground text-xs">–</span>}</TableCell>
                          <TableCell className="text-center py-2">{r.action_priority ? <ApBadge ap={r.action_priority} /> : <span className="text-muted-foreground text-xs">–</span>}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )
      )}
    </Section>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">DFMEA Builder</h1>
          {mode === "new_use_case" && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-800 font-semibold">🔄 New Use Case</span>
          )}
          {mode === "design_change" && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 border border-green-300 text-green-800 font-semibold">🔧 Design Change</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={step === 0} onClick={prev}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          {/* Hide auto-Next on steps with their own forward button */}
          {step < STEPS.length - 1 && step !== 2 && step !== 6 && step !== 7 && step !== 8 && (
            <Button size="sm" onClick={next}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* Step pills */}
      <div className="flex gap-1.5 flex-wrap">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              i === step
                ? "bg-primary text-primary-foreground shadow"
                : i < step
                  ? "bg-primary/15 text-primary hover:bg-primary/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {step === 0 && StepElements}
          {step === 1 && StepBDiagram}
          {step === 2 && StepIFMEA}
          {step === 3 && StepFunctions}
          {step === 4 && StepPDiagram}
          {step === 5 && StepConnections}
          {step === 6 && StepModes}
          {step === 7 && StepCauses}
          {step === 8 && StepRating}
          {step === 9 && StepReview}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default DFMEAWizard;
