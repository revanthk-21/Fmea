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

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SIMILARITY_DEFAULTS = { TOP_K_LOWER: 3, TOP_K_HIGHER: 2, THRESHOLD: 0.55 };

const STEPS = [
  "Elements",
  "B-Diagram",
  "Functions",
  "P-Diagram",
  "Connections",
  "Failure Modes",
  "Failure Causes",
  "Risk Rating",
  "Review & Export",
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

function boxY(count: number, spacing: number, i: number): number {
  const startY = BY + (BH - (count - 1) * spacing - BOX_H) / 2;
  return startY + i * spacing;
}

function spacing(count: number, maxH: number): number {
  return count > 1 ? Math.min(58, (maxH - BOX_H) / (count - 1)) : 0;
}

// Centre-point of each box
function boxCentre(key: string, lowerNames: string[], higherNames: string[]) {
  const lSp = spacing(lowerNames.length, BH - 60);
  const hSp = spacing(higherNames.length, BH - 60);

  if (key === "focus") {
    return { x: FOCUS_CX, y: FOCUS_CY };
  }
  if (key.startsWith("lower-")) {
    const i = parseInt(key.split("-")[1]);
    const by = boxY(lowerNames.length, lSp, i);
    return { x: L_X + BOX_W / 2, y: by + BOX_H / 2 };
  }
  if (key.startsWith("higher-")) {
    const i = parseInt(key.split("-")[1]);
    const by = boxY(higherNames.length, hSp, i);
    return { x: H_X + BOX_W / 2, y: by + BOX_H / 2 };
  }
  return { x: 0, y: 0 };
}

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

function BDiagramSVG({
  focusName, lowerNames, higherNames,
}: { focusName: string; lowerNames: string[]; higherNames: string[] }) {
  const [conns, setConns]           = useState<BConn[]>([]);
  const [pendingFrom, setPending]   = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ConnType>("P");
  const [hoveredBox, setHovered]    = useState<string | null>(null);
  const [hoveredConn, setHovConn]   = useState<string | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const lSp = spacing(lowerNames.length, BH - 60);
  const hSp = spacing(higherNames.length, BH - 60);

  // All clickable box keys
  const allKeys = [
    ...lowerNames.map((_, i) => `lower-${i}`),
    "focus",
    ...higherNames.map((_, i) => `higher-${i}`),
  ];

  const handleBoxClick = (key: string) => {
    if (!pendingFrom) {
      setPending(key);
    } else {
      if (pendingFrom === key) { setPending(null); return; }
      // Avoid duplicate
      const exists = conns.some(
        c => (c.fromKey === pendingFrom && c.toKey === key) ||
             (c.fromKey === key && c.toKey === pendingFrom)
      );
      if (!exists) {
        setConns(p => [...p, { id: uid("bc"), fromKey: pendingFrom, toKey: key, type: activeType }]);
      }
      setPending(null);
    }
  };

  const removeConn = (id: string) => setConns(p => p.filter(c => c.id !== id));

  const changeConnType = (id: string, t: ConnType) =>
    setConns(p => p.map(c => c.id === id ? { ...c, type: t } : c));

  // Download SVG (serialise with inline styles so foreignObject text renders)
  const downloadSVG = () => {
    if (!svgRef.current) return;
    // Clone and strip foreignObject (not supported in all SVG viewers) → use <text> instead
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("foreignObject").forEach(fo => {
      const text = fo.querySelector("div")?.textContent ?? "";
      const txt  = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute("x", String(parseFloat(fo.getAttribute("x") ?? "0") + parseFloat(fo.getAttribute("width") ?? "100") / 2));
      txt.setAttribute("y", String(parseFloat(fo.getAttribute("y") ?? "0") + parseFloat(fo.getAttribute("height") ?? "20") / 2 + 4));
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("font-size", "10");
      txt.setAttribute("fill", "#333");
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
    const xml   = new XMLSerializer().serializeToString(svgRef.current);
    const img   = new Image();
    const scale = 2;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = W * scale; canvas.height = H * scale;
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

  const isSelecting = pendingFrom !== null;

  return (
    <div className="space-y-3">

      {/* ── Toolbar ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">

        {/* Connection type selector */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Connection type to draw
          </p>
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][]).map(([t, meta]) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveType(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                  activeType === t
                    ? "text-white shadow-sm"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
                style={activeType === t ? { background: meta.color, borderColor: meta.color } : {}}
              >
                <span
                  className="inline-block w-5 h-0.5"
                  style={{
                    background: meta.color,
                    borderTop: meta.dash ? `2px dashed ${activeType === t ? "white" : meta.color}` : undefined,
                    height: meta.dash ? 0 : undefined,
                  }}
                />
                {t} — {meta.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status + download */}
        <div className="flex items-center gap-2 flex-wrap">
          {isSelecting ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
              <span className="animate-pulse w-2 h-2 rounded-full bg-amber-500 inline-block" />
              Click a second box to draw a {CONN_META[activeType].label} connection, or click the same box to cancel
            </div>
          ) : (
            <div className="text-xs text-muted-foreground px-2">
              Click any box to start a connection
            </div>
          )}
          <Button variant="outline" size="sm" onClick={downloadSVG}>
            <Download className="h-3.5 w-3.5 mr-1.5" />SVG
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPNG}>
            <Download className="h-3.5 w-3.5 mr-1.5" />PNG
          </Button>
          {conns.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-700"
              onClick={() => setConns([])}>
              Clear all connections
            </Button>
          )}
        </div>
      </div>

      {/* ── SVG canvas ── */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm" style={{ cursor: isSelecting ? "crosshair" : "default" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ minWidth: 700, width: "100%", fontFamily: "Arial, sans-serif" }}
        >
          <defs>
            {(Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][]).map(([t, meta]) => (
              <marker key={t} id={`arrow-${t}`} markerWidth="8" markerHeight="8"
                refX="6" refY="4" orient="auto">
                <path d="M0,0 L0,8 L8,4 Z" fill={meta.color} />
              </marker>
            ))}
          </defs>

          {/* ── Boundary ── */}
          <rect x={BX} y={BY} width={BW} height={BH} rx={16}
            fill="#EAF3FB" stroke="#3B82F6" strokeWidth={2} strokeDasharray="10,5" />
          <text x={BX + BW / 2} y={BY - 12} textAnchor="middle"
            fontSize={10} fontWeight="700" fill="#3B82F6" letterSpacing="0.8">
            {(focusName || "FOCUS SYSTEM").toUpperCase()} — BOUNDARY
          </text>

          {/* ── Connections ── */}
          {conns.map(conn => {
            const from = boxCentre(conn.fromKey, lowerNames, higherNames);
            const to   = boxCentre(conn.toKey,   lowerNames, higherNames);
            const [x1, y1, x2, y2] = shortenLine(from.x, from.y, to.x, to.y, 22);
            const mid  = midpoint(x1, y1, x2, y2);
            const meta = CONN_META[conn.type];
            const isHov = hoveredConn === conn.id;

            return (
              <g key={conn.id}
                onMouseEnter={() => setHovConn(conn.id)}
                onMouseLeave={() => setHovConn(null)}
                style={{ cursor: "pointer" }}
                onClick={() => removeConn(conn.id)}
              >
                {/* Fat invisible hit area */}
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="transparent" strokeWidth={14} />
                {/* Visible line */}
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={meta.color}
                  strokeWidth={isHov ? 2.5 : 1.8}
                  strokeDasharray={meta.dash}
                  markerEnd={`url(#arrow-${conn.type})`}
                  opacity={isHov ? 1 : 0.85}
                />
                {/* Type label badge */}
                <rect x={mid.x - 14} y={mid.y - 8} width={28} height={16} rx={4}
                  fill={isHov ? meta.color : "white"}
                  stroke={meta.color} strokeWidth={1}
                  opacity={0.95} />
                <text x={mid.x} y={mid.y + 4} textAnchor="middle"
                  fontSize={9} fontWeight="700"
                  fill={isHov ? "white" : meta.color}>
                  {conn.type}
                </text>
                {/* × on hover */}
                {isHov && (
                  <text x={mid.x + 18} y={mid.y + 4} fontSize={11}
                    fill="#ef4444" fontWeight="700" cursor="pointer">×</text>
                )}
              </g>
            );
          })}

          {/* ── Focus system box ── */}
          {(() => {
            const key = "focus";
            const isPending = pendingFrom === key;
            const isHov = hoveredBox === key;
            return (
              <g key="focus"
                onClick={() => handleBoxClick(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}>
                <rect
                  x={FOCUS_CX - FOCUS_W / 2} y={FOCUS_CY - FOCUS_H / 2}
                  width={FOCUS_W} height={FOCUS_H} rx={8}
                  fill={isPending ? "#BFDBFE" : "#DBEAFE"}
                  stroke={isPending ? "#1d4ed8" : isHov ? "#3B82F6" : "#60a5fa"}
                  strokeWidth={isPending ? 2.5 : 1.8}
                />
                <text x={FOCUS_CX} y={FOCUS_CY + 5} textAnchor="middle"
                  fontSize={11} fontWeight="700" fill="#1e3a5f">
                  {focusName || "Focus System"}
                </text>
                {isPending && (
                  <text x={FOCUS_CX} y={FOCUS_CY + FOCUS_H / 2 + 13}
                    textAnchor="middle" fontSize={8} fill="#1d4ed8" fontStyle="italic">
                    selected — click another box
                  </text>
                )}
              </g>
            );
          })()}

          {/* ── Lower element boxes ── */}
          {lowerNames.map((name, i) => {
            const key = `lower-${i}`;
            const by  = boxY(lowerNames.length, lSp, i);
            const isPending = pendingFrom === key;
            const isHov     = hoveredBox === key;
            return (
              <g key={key}
                onClick={() => handleBoxClick(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}>
                <rect x={L_X} y={by} width={BOX_W} height={BOX_H} rx={6}
                  fill={isPending ? "#E9D5FF" : "#F3E8FF"}
                  stroke={isPending ? "#7e22ce" : isHov ? "#9333EA" : "#c084fc"}
                  strokeWidth={isPending ? 2.5 : 1.5} />
                <foreignObject x={L_X + 4} y={by + 2} width={BOX_W - 8} height={BOX_H - 4}>
                  <div xmlns="http://www.w3.org/1999/xhtml"
                    style={{ fontSize: 10, color: "#4B0082", textAlign: "center",
                             lineHeight: 1.25, padding: "4px 2px", userSelect: "none" }}>
                    {name}
                  </div>
                </foreignObject>
                {isPending && (
                  <text x={L_X + BOX_W / 2} y={by + BOX_H + 12}
                    textAnchor="middle" fontSize={8} fill="#7e22ce" fontStyle="italic">
                    selected
                  </text>
                )}
              </g>
            );
          })}

          {/* Lower label */}
          {lowerNames.length > 0 && (
            <text x={L_X + BOX_W / 2}
              y={boxY(lowerNames.length, lSp, lowerNames.length - 1) + BOX_H + (pendingFrom?.startsWith("lower") ? 22 : 18)}
              textAnchor="middle" fontSize={8} fill="#9333EA" fontStyle="italic">
              Lower-level elements
            </text>
          )}

          {/* ── Higher element boxes ── */}
          {higherNames.map((name, i) => {
            const key = `higher-${i}`;
            const by  = boxY(higherNames.length, hSp, i);
            const isPending = pendingFrom === key;
            const isHov     = hoveredBox === key;
            return (
              <g key={key}
                onClick={() => handleBoxClick(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}>
                <rect x={H_X} y={by} width={BOX_W} height={BOX_H} rx={6}
                  fill={isPending ? "#D1FAE5" : "#ECFDF5"}
                  stroke={isPending ? "#065f46" : isHov ? "#059669" : "#6ee7b7"}
                  strokeWidth={isPending ? 2.5 : 1.5} />
                <foreignObject x={H_X + 4} y={by + 2} width={BOX_W - 8} height={BOX_H - 4}>
                  <div xmlns="http://www.w3.org/1999/xhtml"
                    style={{ fontSize: 10, color: "#064E3B", textAlign: "center",
                             lineHeight: 1.25, padding: "4px 2px", userSelect: "none" }}>
                    {name}
                  </div>
                </foreignObject>
                {isPending && (
                  <text x={H_X + BOX_W / 2} y={by + BOX_H + 12}
                    textAnchor="middle" fontSize={8} fill="#065f46" fontStyle="italic">
                    selected
                  </text>
                )}
              </g>
            );
          })}

          {/* Higher label */}
          {higherNames.length > 0 && (
            <text x={H_X + BOX_W / 2}
              y={boxY(higherNames.length, hSp, higherNames.length - 1) + BOX_H + (pendingFrom?.startsWith("higher") ? 22 : 18)}
              textAnchor="middle" fontSize={8} fill="#059669" fontStyle="italic">
              Higher-level elements
            </text>
          )}

          {/* ── Legend ── */}
          {(() => {
            const LY = BY + BH + 36;
            const entries = Object.entries(CONN_META) as [ConnType, typeof CONN_META[ConnType]][];
            const gap = (W - 60) / entries.length;
            return (
              <g>
                <rect x={30} y={LY - 10} width={W - 60} height={40} rx={8}
                  fill="#F9FAFB" stroke="#E5E7EB" strokeWidth={1} />
                {entries.map(([t, meta], idx) => {
                  const lx = 55 + idx * gap;
                  return (
                    <g key={t}>
                      <line x1={lx} y1={LY + 10} x2={lx + 24} y2={LY + 10}
                        stroke={meta.color} strokeWidth={2} strokeDasharray={meta.dash} />
                      <path d={arrowHead(lx + 24, LY + 10, lx, LY + 10, 6)} fill={meta.color} />
                      <text x={lx + 30} y={LY + 14} fontSize={9} fill="#374151" fontWeight="600">
                        {t}
                      </text>
                      <text x={lx + 42} y={LY + 14} fontSize={9} fill="#6B7280">
                        — {meta.label}
                      </text>
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
              Connections ({conns.length}) — click a connection on the diagram or the × below to remove
            </p>
          </div>
          <div className="divide-y">
            {conns.map(conn => {
              const meta = CONN_META[conn.type];
              const fromLabel = conn.fromKey === "focus" ? focusName
                : conn.fromKey.startsWith("lower-") ? lowerNames[parseInt(conn.fromKey.split("-")[1])]
                : higherNames[parseInt(conn.fromKey.split("-")[1])];
              const toLabel = conn.toKey === "focus" ? focusName
                : conn.toKey.startsWith("lower-") ? lowerNames[parseInt(conn.toKey.split("-")[1])]
                : higherNames[parseInt(conn.toKey.split("-")[1])];

              return (
                <div key={conn.id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3 text-sm min-w-0">
                    <span
                      className="shrink-0 px-2 py-0.5 rounded text-xs font-bold text-white"
                      style={{ background: meta.color }}>
                      {conn.type}
                    </span>
                    <span className="truncate text-gray-700 font-medium">{fromLabel}</span>
                    <span className="text-gray-400 shrink-0">↔</span>
                    <span className="truncate text-gray-700 font-medium">{toLabel}</span>
                    <span className="text-xs text-muted-foreground shrink-0">({meta.label})</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {/* Change type buttons */}
                    {(Object.keys(CONN_META) as ConnType[]).filter(t => t !== conn.type).map(t => (
                      <button key={t}
                        type="button"
                        title={`Change to ${CONN_META[t].label}`}
                        onClick={() => changeConnType(conn.id, t)}
                        className="w-5 h-5 rounded text-[9px] font-bold text-white flex items-center justify-center"
                        style={{ background: CONN_META[t].color }}>
                        {t}
                      </button>
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

function DFMEAWizard() {
  const [step, setStep] = useState(0);

  // ── Step 0 ── Elements
  const [lowerElements,  setLowerElements]  = useState<Element[]>([]);
  const [focusElement,   setFocusElement]   = useState<Element | null>(null);
  const [higherElements, setHigherElements] = useState<Element[]>([]);

  // ── Step 2 ── Functions
  const [functions, setFunctions] = useState<Func[]>([]);
  const focusFunctions  = useMemo(() => functions.filter(f => f.level === "focus"),  [functions]);
  const lowerFunctions  = useMemo(() => functions.filter(f => f.level === "lower"),  [functions]);
  const higherFunctions = useMemo(() => functions.filter(f => f.level === "higher"), [functions]);

  // ── Step 3 ── P-Diagram (also drives noise for step 4+)
  const [pDiagram, setPDiagram] = useState<PDiagramState>({
    noiseCategories: {
      pieceTopiece: [], changeOverTime: [], customerUsage: [],
      externalEnvironment: [], systemInteractions: [],
    },
    inputs: [], outputs: [],
    functions: [], functionalRequirements: [], controlFactors: [],
    nonFunctionalRequirements: [], unintendedOutputs: [],
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

  // ── Step 4 ── Connections
  const [connections, setConnections] = useState<Connections>({ lower_to_focus: [], focus_to_higher: [] });
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestApplied, setSuggestApplied] = useState(false);

  // ── Step 5 ── Failure modes
  const [modesByFocus, setModesByFocus] = useState<
    Record<string, { options: string[]; selected: Set<string>; loading: boolean }>
  >({});

  // ── Step 6 ── Cause groups
  const [causeGroups,     setCauseGroups]     = useState<CauseGroup[]>([]);
  const [causesLoading,   setCausesLoading]   = useState(false);
  const [causesGenerated, setCausesGenerated] = useState(false);

  // ── Step 8 ── Final rows
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
    if (step === 4 && !suggestApplied && (lowerFunctions.length || higherFunctions.length)) {
      fetchAndApplySuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
    setStep(8);
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
      {!focusElement?.name && !lowerElements.length && !higherElements.length ? (
        <p className="text-sm text-muted-foreground">
          Go back to Step 1 and define your elements first.
        </p>
      ) : (
        <BDiagramSVG
          focusName={focusElement?.name ?? "Focus System"}
          lowerNames={lowerElements.map(e => e.name).filter(Boolean)}
          higherNames={higherElements.map(e => e.name).filter(Boolean)}
        />
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
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug">{cause.cause}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {cause.noise_category} · {cause.noise_factor}
                            </p>
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
                          {cause.noise_category} · {cause.noise_factor}
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

  // ── Step 8 ── Review & Export ─────────────────────────────────────────────
  const StepReview = (
    <Section title="Review & Export"
      subtitle="Edit cells inline. Set Severity (S) — RPN auto-recalculates. Then export.">
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">No rows yet. Complete the Risk Rating step first.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <Badge variant="outline">{rows.length} rows</Badge>
            <Badge variant={rows.filter(r => (r.rpn ?? 0) >= 200).length > 0 ? "destructive" : "outline"}>
              {rows.filter(r => (r.rpn ?? 0) >= 200).length} high-risk (RPN ≥ 200)
            </Badge>
            <Badge variant="secondary">
              {rows.filter(r => (r.rpn ?? 0) >= 100 && (r.rpn ?? 0) < 200).length} medium-risk
            </Badge>
            <Button size="sm" onClick={exportCsv}>
              <CheckCircle2 className="h-4 w-4 mr-2" />Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportTemplateXlsx}>
              <Download className="h-4 w-4 mr-2" />Export XLSX
            </Button>
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
                  <TableRow key={r.id}
                    className={
                      (r.rpn ?? 0) >= 200 ? "bg-red-50/50"
                      : (r.rpn ?? 0) >= 100 ? "bg-amber-50/50" : ""
                    }>
                    <TableCell className="text-xs align-top py-2">{r.focus_function}</TableCell>
                    <TableCell className="text-xs align-top py-2">{r.failure_mode}</TableCell>
                    <TableCell className="py-2">
                      <Input className="text-xs min-w-[170px]" value={r.failure_cause}
                        onChange={e => setRows(p => p.map((row, idx) =>
                          idx === i ? { ...row, failure_cause: e.target.value } : row))} />
                    </TableCell>
                    <TableCell className="py-2">
                      <Input className="text-xs min-w-[170px]" value={r.failure_effect}
                        onChange={e => setRows(p => p.map((row, idx) =>
                          idx === i ? { ...row, failure_effect: e.target.value } : row))} />
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Input type="number" min={1} max={10} className="w-14 text-xs text-center"
                        placeholder="1–10" value={r.severity ?? ""}
                        onChange={e => {
                          const raw = e.target.value;
                          const s   = raw === "" ? undefined : Math.max(1, Math.min(10, Number(raw)));
                          setRows(p => p.map((row, idx) => {
                            if (idx !== i) return row;
                            if (!s || !row.occurrence_answer || !row.detection_answer) return { ...row, severity: s };
                            const { occurrence, detection, rpn, action_priority } =
                              computeRating(row.occurrence_answer, row.detection_answer, s);
                            return { ...row, severity: s, occurrence, detection, rpn, action_priority };
                          }));
                        }} />
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Badge variant="outline" className="text-xs">{r.occurrence ?? "–"}</Badge>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Badge variant="outline" className="text-xs">{r.detection ?? "–"}</Badge>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      {r.rpn != null ? <RpnBadge rpn={r.rpn} />
                        : <span className="text-muted-foreground text-xs">–</span>}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      {r.action_priority ? <ApBadge ap={r.action_priority} />
                        : <span className="text-muted-foreground text-xs">–</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
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
        <h1 className="text-2xl font-bold">DFMEA Builder</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={step === 0} onClick={prev}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          {/* Hide auto-Next on steps with their own forward button */}
          {step < STEPS.length - 1 && step !== 5 && step !== 6 && step !== 7 && (
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
          {step === 2 && StepFunctions}
          {step === 3 && StepPDiagram}
          {step === 4 && StepConnections}
          {step === 5 && StepModes}
          {step === 6 && StepCauses}
          {step === 7 && StepRating}
          {step === 8 && StepReview}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default DFMEAWizard;
