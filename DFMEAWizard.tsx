"use client";
import React, { useMemo, useState, useCallback } from "react";
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
  Loader2, ChevronDown, ChevronRight, AlertTriangle, Zap,
} from "lucide-react";

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

type CauseItem = {
  id:                 string;
  cause:              string;
  noise_category:     string;
  noise_factor:       string;
  // Step 6 – user selection
  selected:           boolean;
  // Step 7 – controls & rating
  prevention_methods: string;
  detection_methods:  string;
  occurrence_answer:  string;   // very_high|high|moderate|low|very_low|unlikely
  detection_answer:   string;   // unlikely|low|moderate|high|certain
  // Computed (after both answers given)
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
  // keep rating answers so re-compute on severity change
  occurrence_answer:  string;
  detection_answer:   string;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const apiBase = process.env.NEXT_PUBLIC_DFMEA_API || "http://localhost:8000";

const STEPS = [
  "Elements",
  "Functions",
  "Noise Factors",
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

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
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

/** Pill-style radio for O/D qualitative answers */
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function DFMEAWizard() {
  const [step, setStep] = useState(0);

  // ── Step 0 ── Elements
  const [lowerElements,  setLowerElements]  = useState<Element[]>([]);
  const [focusElement,   setFocusElement]   = useState<Element | null>(null);
  const [higherElements, setHigherElements] = useState<Element[]>([]);

  // ── Step 1 ── Functions
  const [functions, setFunctions] = useState<Func[]>([]);
  const focusFunctions  = useMemo(() => functions.filter(f => f.level === "focus"),  [functions]);
  const lowerFunctions  = useMemo(() => functions.filter(f => f.level === "lower"),  [functions]);
  const higherFunctions = useMemo(() => functions.filter(f => f.level === "higher"), [functions]);

  // ── Step 2 ── Noise
  const [noise, setNoise] = useState<Noise>({});

  // ── Step 3 ── Connections
  const [connections, setConnections] = useState<Connections>({ lower_to_focus: [], focus_to_higher: [] });

  // ── Step 4 ── Failure modes
  const [modesByFocus, setModesByFocus] = useState<
    Record<string, { options: string[]; selected: Set<string>; loading: boolean }>
  >({});

  // ── Step 5 ── Cause groups
  const [causeGroups,     setCauseGroups]     = useState<CauseGroup[]>([]);
  const [causesLoading,   setCausesLoading]   = useState(false);
  const [causesGenerated, setCausesGenerated] = useState(false);

  // ── Step 7 ── Final rows
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

  // ── Noise helpers ────────────────────────────────────────────────────────

  const addNoiseCategory = () => {
    const key = `Category ${Object.keys(noise).length + 1}`;
    setNoise(p => ({ ...p, [key]: [""] }));
  };
  const renameNoiseCategory = (old: string, raw: string) => {
    const n = raw.trim(); if (!n || n === old) return;
    setNoise(p => {
      const merged = Array.from(new Set([...(p[n] || []), ...(p[old] || [])]));
      const { [old]: _, ...rest } = p;
      return { ...rest, [n]: merged };
    });
  };
  const deleteNoiseCategory = (cat: string) =>
    setNoise(p => { const { [cat]: _, ...rest } = p; return rest; });
  const updateNoiseFactor = (cat: string, idx: number, val: string) =>
    setNoise(p => ({ ...p, [cat]: p[cat].map((v, i) => i === idx ? val : v) }));
  const addNoiseFactor    = (cat: string) => setNoise(p => ({ ...p, [cat]: [...p[cat], ""] }));
  const removeNoiseFactor = (cat: string, idx: number) =>
    setNoise(p => ({ ...p, [cat]: p[cat].filter((_, i) => i !== idx) }));

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

  // ── Failure mode helpers ─────────────────────────────────────────────────

  const fetchModes = async (ff: Func) => {
    if (!focusElement) return;
    setModesByFocus(p => ({
      ...p,
      [ff.id]: { options: p[ff.id]?.options ?? [], selected: p[ff.id]?.selected ?? new Set(), loading: true },
    }));
    try {
      const r    = await fetch(`${apiBase}/api/dfmea/failure-modes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus_function_name: ff.name, focus_element_name: focusElement.name }),
      });
      const data = await r.json();
      const opts: string[] = data.failure_modes || [];
      setModesByFocus(p => ({
        ...p,
        [ff.id]: { options: opts, selected: p[ff.id]?.selected ?? new Set(), loading: false },
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
      Object.entries(noise).map(([k, arr]) => [k, arr.filter(Boolean)])
    );

    for (const ff of focusFunctions) {
      const modes = Array.from(modesByFocus[ff.id]?.selected || []);
      if (!modes.length) continue;

      const lowerIds  = connections.lower_to_focus.filter(([, fid]) => fid === ff.id).map(([lid]) => lid);
      const lowerConns = lowerFunctions
        .filter(lf => lowerIds.includes(lf.id))
        .map(lf => ({ lower_element: lf.elementName, lower_function: lf.name }));
      if (!lowerConns.length) continue;

      try {
        const r    = await fetch(`${apiBase}/api/dfmea/failure-causes/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

      const higherIds  = connections.focus_to_higher.filter(([fid]) => fid === ff.id).map(([, hid]) => hid);
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

    // Fetch failure effects in bulk
    if (draft.length) {
      try {
        const r    = await fetch(`${apiBase}/api/dfmea/failure-effects/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: draft.map(row => ({
              row_id:          row.id,
              focus_element:   row.focus_element,
              focus_function:  row.focus_function,
              failure_mode:    row.failure_mode,
              higher_element:  row.higher_element,
              higher_function: row.higher_function,
            })),
          }),
        });
        const data = await r.json();
        const effectMap: Record<string, string> = {};
        for (const res of data.results || []) effectMap[res.row_id] = res.failure_effect;
        draft.forEach(row => { if (effectMap[row.id]) row.failure_effect = effectMap[row.id]; });
      } catch (e) { console.error("Effects fetch failed:", e); }
    }

    setRows(draft);
    setRowsLoading(false);
    setStep(7);
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
              <Input
                placeholder={`Lower element ${i + 1}`} value={el.name}
                onChange={e => setLowerElements(p => p.map(x => x.id === el.id ? { ...x, name: e.target.value } : x))}
              />
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
              <Input
                placeholder={`Higher element ${i + 1}`} value={el.name}
                onChange={e => setHigherElements(p => p.map(x => x.id === el.id ? { ...x, name: e.target.value } : x))}
              />
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

  // ── Step 1 ── Functions ───────────────────────────────────────────────────
  const StepFunctions = (
    <Section title="Functions" subtitle="Add one or more functions for each element.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Lower */}
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

        {/* Focus */}
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

        {/* Higher */}
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

  // ── Step 2 ── Noise factors ───────────────────────────────────────────────
  const StepNoise = (
    <Section title="Noise Factors" subtitle="Add categories and factors — these drive cause generation.">
      <div className="space-y-4">
        {Object.entries(noise).map(([cat, arr]) => (
          <Card key={cat}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  className="w-52 text-sm font-medium"
                  defaultValue={cat}
                  placeholder="Category name"
                  onBlur={e => renameNoiseCategory(cat, e.target.value)}
                />
                <Button size="sm" variant="secondary" onClick={() => addNoiseFactor(cat)}>
                  <Plus className="h-3 w-3 mr-1" />Add factor
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteNoiseCategory(cat)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              <div className="space-y-2 pl-1">
                {arr.map((v, i) => (
                  <div key={`${cat}_${i}`} className="flex gap-2">
                    <Input className="text-sm" placeholder="Noise factor" value={v}
                      onChange={e => updateNoiseFactor(cat, i, e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => removeNoiseFactor(cat, i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        <Button variant="secondary" onClick={addNoiseCategory}>
          <Plus className="h-4 w-4 mr-2" />Add category
        </Button>
      </div>
    </Section>
  );

  // ── Step 3 ── Connections ─────────────────────────────────────────────────
  const StepConnections = (
    <Section title="Connections" subtitle="Link lower functions → focus function → higher functions.">
      {!focusFunctions.length
        ? <p className="text-sm text-muted-foreground">Add at least one focus function first.</p>
        : (
          <div className="space-y-4">
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

  // ── Step 4 ── Failure modes ───────────────────────────────────────────────
  const StepModes = (
    <Section title="Failure Modes" subtitle="Generate and select failure modes per focus function, then proceed to generate causes.">
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
                              if (e.key === "Enter") {
                                addCustomMode(ff, e.currentTarget.value);
                                e.currentTarget.value = "";
                              }
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

  // ── Step 5 ── Failure causes ──────────────────────────────────────────────
  const StepCauses = (
    <Section title="Failure Causes"
      subtitle="Generate all causes for selected failure modes, then select which to include in the DFMEA.">
      {!causesGenerated ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Causes are generated for every selected failure mode × connected lower function × noise factor.
            This may take a moment.
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
                          <Checkbox
                            className="mt-0.5 shrink-0"
                            checked={cause.selected}
                            onCheckedChange={() => toggleCause(gi, cause.id)}
                          />
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

  // ── Step 6 ── Risk rating ─────────────────────────────────────────────────
  const StepRating = (
    <Section title="Risk Rating"
      subtitle="For each selected cause: describe current controls, then answer the two rating questions.">

      {/* Progress */}
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

                      {/* Cause header */}
                      <div>
                        <p className="font-medium text-sm">{cause.cause}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {cause.noise_category} · {cause.noise_factor}
                        </p>
                      </div>

                      {/* Controls */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-semibold">Current Prevention Methods</Label>
                          <Textarea
                            rows={2} className="text-sm resize-none"
                            placeholder="e.g. FEM simulation, Cpk study, conformal coating spec…"
                            value={cause.prevention_methods}
                            onChange={e => updateCauseField(gi, cause.id, "prevention_methods", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-semibold">Current Detection Methods</Label>
                          <Textarea
                            rows={2} className="text-sm resize-none"
                            placeholder="e.g. HIL test at -40°C/+85°C, EOL functional test, CISPR 25…"
                            value={cause.detection_methods}
                            onChange={e => updateCauseField(gi, cause.id, "detection_methods", e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Occurrence question */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">
                          How likely will this failure cause occur?
                        </Label>
                        <OptionPills
                          options={OCCURRENCE_OPTIONS}
                          value={cause.occurrence_answer}
                          onChange={v => updateCauseField(gi, cause.id, "occurrence_answer", v)}
                        />
                      </div>

                      {/* Detection question */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">
                          How likely will this failure be detected before reaching the customer?
                        </Label>
                        <OptionPills
                          options={DETECTION_OPTIONS}
                          value={cause.detection_answer}
                          onChange={v => updateCauseField(gi, cause.id, "detection_answer", v)}
                        />
                      </div>

                      {/* Live computed ratings */}
                      {rating && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t items-center">
                          <Badge variant="outline">O = {rating.occurrence}</Badge>
                          <Badge variant="outline">D = {rating.detection}</Badge>
                          <RpnBadge rpn={rating.rpn!} />
                          <ApBadge ap={rating.action_priority} />
                          <span className="text-xs text-muted-foreground ml-1">
                            (S=5 default — update Severity in Review step to recalculate RPN)
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

  // ── Step 7 ── Review & Export ─────────────────────────────────────────────
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
                    {/* Severity — recalculates RPN on change */}
                    <TableCell className="text-center py-2">
                      <Input
                        type="number" min={1} max={10}
                        className="w-14 text-xs text-center"
                        placeholder="1–10"
                        value={r.severity ?? ""}
                        onChange={e => {
                          const raw = e.target.value;
                          const s   = raw === "" ? undefined : Math.max(1, Math.min(10, Number(raw)));
                          setRows(p => p.map((row, idx) => {
                            if (idx !== i) return row;
                            if (!s || !row.occurrence_answer || !row.detection_answer) {
                              return { ...row, severity: s };
                            }
                            const { occurrence, detection, rpn, action_priority } =
                              computeRating(row.occurrence_answer, row.detection_answer, s);
                            return { ...row, severity: s, occurrence, detection, rpn, action_priority };
                          }));
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Badge variant="outline" className="text-xs">{r.occurrence ?? "–"}</Badge>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Badge variant="outline" className="text-xs">{r.detection ?? "–"}</Badge>
                    </TableCell>
                    <TableCell className="text-center py-2">
                      {r.rpn != null
                        ? <RpnBadge rpn={r.rpn} />
                        : <span className="text-muted-foreground text-xs">–</span>}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      {r.action_priority
                        ? <ApBadge ap={r.action_priority} />
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
          {/* Show auto-Next only on steps that don't manage their own forward button */}
          {step < STEPS.length - 1 && step !== 4 && step !== 5 && step !== 6 && (
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
          {step === 1 && StepFunctions}
          {step === 2 && StepNoise}
          {step === 3 && StepConnections}
          {step === 4 && StepModes}
          {step === 5 && StepCauses}
          {step === 6 && StepRating}
          {step === 7 && StepReview}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
