"use client";
import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2, Download, Zap } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type BDiagramData = {
  focusElement: string;
  lowerElements: Array<{ name: string; interactionTypes: string[] }>;   // P, E, I, M
  higherElements: Array<{ name: string; interactionTypes: string[] }>;
  requirements: string[];       // top bar: LEGAL, SAFETY, PRODUCT SPEC…
  noiseFactors: string[];       // bottom bar
  systemImage?: string;         // optional base64 image
};

export type PDiagramData = {
  systemName: string;
  // Top noise section
  noiseCategories: {
    pieceTopiece:        string[];
    changeOverTime:      string[];
    customerUsage:       string[];
    externalEnvironment: string[];
    systemInteractions:  string[];
  };
  // Middle I/O
  inputs:  string[];
  outputs: string[];
  // Bottom analysis
  functions:               string[];
  functionalRequirements:  string[];
  controlFactors:          string[];
  nonFunctionalRequirements: string[];
  unintendedOutputs:       string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG ARROW helper (used inside B-Diagram SVG)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// B-DIAGRAM RENDERER
// ─────────────────────────────────────────────────────────────────────────────

const INTERACTION_COLORS: Record<string, string> = {
  P: "#1a56db",   // blue — Physical
  E: "#057a55",   // green — Energy
  I: "#e3a008",   // amber — Information
  M: "#e02424",   // red — Material
};

function InteractionLabel({ types }: { types: string[] }) {
  return (
    <span className="text-[9px] font-bold">
      {types.map((t, i) => (
        <span key={t} style={{ color: INTERACTION_COLORS[t] }}>
          {t}{i < types.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

export function BDiagramRenderer({ data }: { data: BDiagramData }) {
  // Layout constants (SVG viewBox 900 × 560)
  const W = 900; const H = 560;
  const FOCUS_X = 340; const FOCUS_Y = 160; const FOCUS_W = 280; const FOCUS_H = 220;
  const BOX_W = 110; const BOX_H = 36;

  // Lower elements — stacked left of focus box
  const lowerCount = data.lowerElements.length;
  const lowerSpacing = Math.min(70, (FOCUS_H - 20) / Math.max(lowerCount, 1));
  const lowerStartY = FOCUS_Y + (FOCUS_H - lowerSpacing * (lowerCount - 1)) / 2;

  // Higher elements — stacked right of focus box
  const higherCount = data.higherElements.length;
  const higherSpacing = Math.min(70, (FOCUS_H - 20) / Math.max(higherCount, 1));
  const higherStartY = FOCUS_Y + (FOCUS_H - higherSpacing * (higherCount - 1)) / 2;

  const LOWER_X = 80;
  const HIGHER_X = 720;

  // Requirements bar items
  const reqItems = data.requirements.length ? data.requirements : ["LEGAL", "SAFETY", "PRODUCT SPEC", "STANDARDS", "VEHICLE OPERATIONS", "SERVICE"];

  // Noise factors
  const noiseItems = data.noiseFactors.length ? data.noiseFactors : [];

  const arrowMarker = (id: string, color: string) => (
    <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill={color} />
    </marker>
  );

  const typeToColor = (types: string[]) =>
    types.length === 1 ? (INTERACTION_COLORS[types[0]] || "#555") : "#555";

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full border rounded-xl bg-white"
        style={{ minWidth: 700, fontFamily: "Arial, sans-serif" }}
      >
        <defs>
          {["P","E","I","M"].map(t => arrowMarker(`arrow-${t}`, INTERACTION_COLORS[t]))}
          {arrowMarker("arrow-gray", "#888")}
        </defs>

        {/* ── Outer layers ── */}
        {/* Requirements layer */}
        <rect x={10} y={10} width={W-20} height={H-20} rx={18}
          fill="#c8d6e6" stroke="#8fa8bf" strokeWidth={1.5}/>
        <text x={W/2} y={28} textAnchor="middle" fontSize={10} fontWeight="600" fill="#444">REQUIREMENTS</text>

        {/* Environment */}
        <rect x={20} y={38} width={W-40} height={H-90} rx={14}
          fill="#d9e8d5" stroke="#88bb80" strokeWidth={1.2}/>
        <text x={W/2} y={54} textAnchor="middle" fontSize={9} fill="#555">ENVIRONMENT</text>

        {/* Physical Environment */}
        <rect x={30} y={62} width={W-60} height={H-160} rx={10}
          fill="#fff8dc" stroke="#c8a830" strokeWidth={1}/>
        <text x={W/2} y={78} textAnchor="middle" fontSize={9} fill="#888">PHYSICAL ENVIRONMENT</text>

        {/* ── Requirements bar (top boxes) ── */}
        {reqItems.map((req, i) => {
          const bw = Math.min(90, (W - 80) / reqItems.length - 8);
          const bx = 50 + i * ((W - 100) / reqItems.length);
          return (
            <g key={req}>
              <rect x={bx} y={40} width={bw} height={26} rx={3}
                fill="#607d8b" stroke="#455a64" strokeWidth={1}/>
              <text x={bx + bw/2} y={57} textAnchor="middle" fontSize={8} fontWeight="600" fill="white">
                {req}
              </text>
            </g>
          );
        })}

        {/* ── Focus element boundary (dashed) ── */}
        <rect x={FOCUS_X} y={FOCUS_Y} width={FOCUS_W} height={FOCUS_H} rx={8}
          fill="rgba(173,216,230,0.15)" stroke="#1a56db" strokeWidth={1.5}
          strokeDasharray="7,4"/>
        <text x={FOCUS_X + FOCUS_W/2} y={FOCUS_Y - 6} textAnchor="middle"
          fontSize={8} fill="#1a56db" fontWeight="600">
          {data.focusElement.toUpperCase()} BOUNDARY — FOCUS ELEMENT
        </text>

        {/* Focus element label box center */}
        <rect x={FOCUS_X + FOCUS_W/2 - 55} y={FOCUS_Y + FOCUS_H/2 - 16}
          width={110} height={32} rx={4} fill="#bbd2ee" stroke="#5a88c8" strokeWidth={1}/>
        <text x={FOCUS_X + FOCUS_W/2} y={FOCUS_Y + FOCUS_H/2 + 5}
          textAnchor="middle" fontSize={9} fontWeight="600" fill="#1a3860">
          {data.focusElement}
        </text>

        {/* ── Lower elements (left) + arrows ── */}
        {data.lowerElements.map((el, i) => {
          const by = lowerStartY + i * lowerSpacing - BOX_H / 2;
          const arrowColor = typeToColor(el.interactionTypes);
          const markerId = `arrow-${el.interactionTypes[0] || "gray"}`;
          return (
            <g key={el.name + i}>
              {/* Arrow lower → focus */}
              <line
                x1={LOWER_X + BOX_W} y1={by + BOX_H/2}
                x2={FOCUS_X - 2}     y2={by + BOX_H/2}
                stroke={arrowColor} strokeWidth={1.2}
                markerEnd={`url(#${markerId})`}/>
              {/* Interaction label */}
              <text
                x={LOWER_X + BOX_W + (FOCUS_X - LOWER_X - BOX_W)/2}
                y={by + BOX_H/2 - 4}
                textAnchor="middle" fontSize={8} fill={arrowColor} fontWeight="600">
                {el.interactionTypes.join(", ")}
              </text>
              {/* Box */}
              <rect x={LOWER_X} y={by} width={BOX_W} height={BOX_H} rx={3}
                fill="#e8e4f4" stroke="#9b89d0" strokeWidth={1}/>
              <foreignObject x={LOWER_X+2} y={by+2} width={BOX_W-4} height={BOX_H-4}>
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style={{ fontSize: 8, textAlign: "center", padding: 2, lineHeight: 1.2, color: "#333" }}>
                  {el.name}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* ── Higher elements (right) + arrows ── */}
        {data.higherElements.map((el, i) => {
          const by = higherStartY + i * higherSpacing - BOX_H / 2;
          const arrowColor = typeToColor(el.interactionTypes);
          const markerId = `arrow-${el.interactionTypes[0] || "gray"}`;
          return (
            <g key={el.name + i}>
              {/* Arrow focus → higher */}
              <line
                x1={FOCUS_X + FOCUS_W + 2} y1={by + BOX_H/2}
                x2={HIGHER_X - 2}           y2={by + BOX_H/2}
                stroke={arrowColor} strokeWidth={1.2}
                markerEnd={`url(#${markerId})`}/>
              <text
                x={FOCUS_X + FOCUS_W + (HIGHER_X - FOCUS_X - FOCUS_W)/2}
                y={by + BOX_H/2 - 4}
                textAnchor="middle" fontSize={8} fill={arrowColor} fontWeight="600">
                {el.interactionTypes.join(", ")}
              </text>
              <rect x={HIGHER_X} y={by} width={BOX_W} height={BOX_H} rx={3}
                fill="#e8e4f4" stroke="#9b89d0" strokeWidth={1}/>
              <foreignObject x={HIGHER_X+2} y={by+2} width={BOX_W-4} height={BOX_H-4}>
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style={{ fontSize: 8, textAlign: "center", padding: 2, lineHeight: 1.2, color: "#333" }}>
                  {el.name}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* ── Noise factors bar (bottom) ── */}
        {noiseItems.length > 0 && (() => {
          const BAR_Y = H - 80;
          const nw = Math.min(100, (W - 80) / noiseItems.length - 8);
          return (
            <g>
              <rect x={20} y={BAR_Y - 6} width={W-40} height={52} rx={6}
                fill="rgba(100,100,120,0.08)" stroke="#aaa" strokeWidth={1} strokeDasharray="4,3"/>
              {noiseItems.map((nf, i) => {
                const nx = 50 + i * ((W - 100) / noiseItems.length);
                return (
                  <g key={nf}>
                    <rect x={nx} y={BAR_Y} width={nw} height={32} rx={3}
                      fill="#607d8b" stroke="#455a64" strokeWidth={0.8}/>
                    <foreignObject x={nx+2} y={BAR_Y+2} width={nw-4} height={28}>
                      <div xmlns="http://www.w3.org/1999/xhtml"
                        style={{ fontSize: 7, color: "white", textAlign: "center",
                                 fontWeight: 600, lineHeight: 1.2, padding: 2 }}>
                        {nf}
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* ── Legend ── */}
        {["P","E","I","M"].map((t, i) => {
          const labels: Record<string,string> = {
            P: "Physical (welded, bolted, clamped, fits, clearances)",
            E: "Energy (torque, heat, current, vibration)",
            I: "Information (CAN signals, sensor signals, RF signals)",
            M: "Material (cooling fluid, exhaust gases, brake fluid)",
          };
          return (
            <g key={t}>
              <text x={650} y={FOCUS_Y + 16 + i*16} fontSize={7.5} fill={INTERACTION_COLORS[t]} fontWeight="700">{t}</text>
              <text x={662} y={FOCUS_Y + 16 + i*16} fontSize={7} fill="#555"> – {labels[t]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P-DIAGRAM RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function PCol({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div
        className="text-center text-[10px] font-bold py-1 px-2 rounded-sm"
        style={{ background: color, color: "#222" }}>
        {title}
      </div>
      {items.map((item, i) => (
        <div key={i}
          className="text-[10px] leading-tight px-2 py-1 rounded-sm bg-white border border-gray-200 text-gray-700">
          {item}
        </div>
      ))}
    </div>
  );
}

export function PDiagramRenderer({ data }: { data: PDiagramData }) {
  const nc = data.noiseCategories;
  const allNoiseCols = [
    { title: "Piece to Piece Variation", items: nc.pieceTopiece,        color: "#C0C0C0" },
    { title: "Change Over Time",          items: nc.changeOverTime,      color: "#C0C0C0" },
    { title: "Customer Usage",            items: nc.customerUsage,       color: "#A5A5A5" },
    { title: "External Environment",      items: nc.externalEnvironment, color: "#C0C0C0" },
    { title: "System Interactions",       items: nc.systemInteractions,  color: "#C0C0C0" },
  ];

  const bottomCols = [
    { title: "Functions",                  items: data.functions,                color: "#C0C0C0" },
    { title: "Functional Requirements",    items: data.functionalRequirements,   color: "#C0C0C0" },
    { title: "Control Factors",            items: data.controlFactors,           color: "#C0C0C0" },
    { title: "Non-Functional Requirements",items: data.nonFunctionalRequirements,color: "#C0C0C0" },
    { title: "Unintended Outputs / Error States", items: data.unintendedOutputs, color: "#C0C0C0" },
  ];

  return (
    <div className="w-full space-y-3 p-1">
      {/* ── Top noise categories ── */}
      <div
        className="rounded-lg border border-gray-300 p-3"
        style={{ background: "#f5f5f5" }}>
        <p className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-wide">Noise Factors</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {allNoiseCols.map(col => (
            <PCol key={col.title} title={col.title} items={col.items} color={col.color} />
          ))}
        </div>
      </div>

      {/* ── Middle I/O section ── */}
      <div className="flex items-stretch gap-2 rounded-lg border border-gray-300 p-3"
        style={{ background: "#fafafa", minHeight: 140 }}>

        {/* Inputs */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-center py-1 px-2 rounded-sm mb-1"
            style={{ background: "#C0C0C0" }}>Inputs</div>
          <div className="space-y-1">
            {data.inputs.map((inp, i) => (
              <div key={i}
                className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 rounded-sm text-gray-700">
                {inp}
              </div>
            ))}
          </div>
        </div>

        {/* Arrow → */}
        <div className="flex items-center px-1 text-gray-400 text-lg font-light select-none">→</div>

        {/* System box */}
        <div className="flex items-center justify-center px-4 py-3 rounded border-2 border-gray-400"
          style={{ background: "#BFBFBF", minWidth: 160, textAlign: "center" }}>
          <span className="text-[11px] font-bold text-gray-800 leading-snug">{data.systemName}</span>
        </div>

        {/* Arrow → */}
        <div className="flex items-center px-1 text-gray-400 text-lg font-light select-none">→</div>

        {/* Outputs */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-center py-1 px-2 rounded-sm mb-1"
            style={{ background: "#C0C0C0" }}>Outputs</div>
          <div className="space-y-1">
            {data.outputs.map((out, i) => (
              <div key={i}
                className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 rounded-sm text-gray-700">
                {out}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom analysis columns ── */}
      <div
        className="rounded-lg border border-gray-300 p-3"
        style={{ background: "#f5f5f5" }}>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {bottomCols.map(col => (
            <PCol key={col.title} title={col.title} items={col.items} color={col.color} />
          ))}
        </div>
      </div>

      {/* ── Interaction type legend ── */}
      <div className="text-[9px] text-gray-500 italic px-1 leading-relaxed">
        <span className="font-bold text-blue-600">P – Physical</span>: welded, bolted, clamped, fits, clearances.{" "}
        <span className="font-bold text-amber-600">I – Information</span>: CAN signals, sensor signals, RF.{" "}
        <span className="font-bold text-green-600">E – Energy</span>: torque, heat, current, vibration.{" "}
        <span className="font-bold text-red-500">M – Material</span>: cooling fluid, exhaust gases, brake fluid.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITABLE LIST COMPONENT (shared between B and P diagram forms)
// ─────────────────────────────────────────────────────────────────────────────

function EditableList({ label, items, onChange, placeholder }: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const update = (i: number, val: string) => {
    const next = [...items]; next[i] = val; onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add    = () => onChange([...items, ""]);

  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      {items.map((item, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            className="text-xs h-7"
            value={item}
            placeholder={placeholder}
            onChange={e => update(i, e.target.value)}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />Add
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTION TYPE SELECTOR (for B-diagram element boxes)
// ─────────────────────────────────────────────────────────────────────────────

const INTERACTION_TYPES = ["P", "E", "I", "M"];
const INTERACTION_LABELS: Record<string, string> = {
  P: "Physical", E: "Energy", I: "Information", M: "Material",
};

function InteractionPicker({ selected, onChange }: {
  selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (t: string) => {
    const next = selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t];
    onChange(next);
  };
  return (
    <div className="flex gap-1 flex-wrap">
      {INTERACTION_TYPES.map(t => (
        <button
          key={t} type="button"
          onClick={() => toggle(t)}
          title={INTERACTION_LABELS[t]}
          className={`w-6 h-6 rounded text-[10px] font-bold border transition-all ${
            selected.includes(t)
              ? "text-white border-transparent"
              : "bg-white text-gray-400 border-gray-300 hover:border-gray-400"
          }`}
          style={selected.includes(t) ? { background: INTERACTION_COLORS[t] } : {}}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// B-DIAGRAM FORM
// ─────────────────────────────────────────────────────────────────────────────

function BDiagramForm({ data, onChange }: { data: BDiagramData; onChange: (d: BDiagramData) => void }) {
  const set = <K extends keyof BDiagramData>(k: K, v: BDiagramData[K]) => onChange({ ...data, [k]: v });

  const updateElement = (
    side: "lowerElements" | "higherElements",
    i: number,
    field: "name" | "interactionTypes",
    val: string | string[]
  ) => {
    const arr = [...data[side]];
    arr[i] = { ...arr[i], [field]: val };
    set(side, arr);
  };

  const addElement = (side: "lowerElements" | "higherElements") =>
    set(side, [...data[side], { name: "", interactionTypes: ["P"] }]);
  const removeElement = (side: "lowerElements" | "higherElements", i: number) =>
    set(side, data[side].filter((_, idx) => idx !== i));

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs font-semibold">Focus Element Name</Label>
        <Input className="text-sm mt-1" value={data.focusElement}
          onChange={e => set("focusElement", e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Lower elements */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Lower-level elements (left side)</Label>
          {data.lowerElements.map((el, i) => (
            <div key={i} className="border rounded-lg p-2 space-y-1.5 bg-purple-50/40">
              <div className="flex gap-1.5">
                <Input className="text-xs h-7 flex-1" placeholder="Element name" value={el.name}
                  onChange={e => updateElement("lowerElements", i, "name", e.target.value)} />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => removeElement("lowerElements", i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Interaction:</span>
                <InteractionPicker selected={el.interactionTypes}
                  onChange={v => updateElement("lowerElements", i, "interactionTypes", v)} />
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" className="h-7 text-xs"
            onClick={() => addElement("lowerElements")}>
            <Plus className="h-3 w-3 mr-1" />Add lower element
          </Button>
        </div>

        {/* Higher elements */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Higher-level elements (right side)</Label>
          {data.higherElements.map((el, i) => (
            <div key={i} className="border rounded-lg p-2 space-y-1.5 bg-purple-50/40">
              <div className="flex gap-1.5">
                <Input className="text-xs h-7 flex-1" placeholder="Element name" value={el.name}
                  onChange={e => updateElement("higherElements", i, "name", e.target.value)} />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => removeElement("higherElements", i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Interaction:</span>
                <InteractionPicker selected={el.interactionTypes}
                  onChange={v => updateElement("higherElements", i, "interactionTypes", v)} />
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" className="h-7 text-xs"
            onClick={() => addElement("higherElements")}>
            <Plus className="h-3 w-3 mr-1" />Add higher element
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <EditableList
          label="Requirements (top bar)"
          items={data.requirements}
          onChange={v => set("requirements", v)}
          placeholder="e.g. SAFETY"
        />
        <EditableList
          label="Noise Factors (bottom bar)"
          items={data.noiseFactors}
          onChange={v => set("noiseFactors", v)}
          placeholder="e.g. ROAD INPUTS"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P-DIAGRAM FORM
// ─────────────────────────────────────────────────────────────────────────────

function PDiagramForm({ data, onChange }: { data: PDiagramData; onChange: (d: PDiagramData) => void }) {
  const set = <K extends keyof PDiagramData>(k: K, v: PDiagramData[K]) => onChange({ ...data, [k]: v });
  const setNoise = <K extends keyof PDiagramData["noiseCategories"]>(k: K, v: string[]) =>
    onChange({ ...data, noiseCategories: { ...data.noiseCategories, [k]: v } });

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs font-semibold">System Name (center box)</Label>
        <Input className="text-sm mt-1" value={data.systemName}
          onChange={e => set("systemName", e.target.value)} />
      </div>

      {/* Noise categories */}
      <div>
        <p className="text-xs font-semibold mb-2">Noise Factor Categories</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <EditableList label="Piece to Piece Variation" items={data.noiseCategories.pieceTopiece}
            onChange={v => setNoise("pieceTopiece", v)} />
          <EditableList label="Change Over Time"         items={data.noiseCategories.changeOverTime}
            onChange={v => setNoise("changeOverTime", v)} />
          <EditableList label="Customer Usage"           items={data.noiseCategories.customerUsage}
            onChange={v => setNoise("customerUsage", v)} />
          <EditableList label="External Environment"     items={data.noiseCategories.externalEnvironment}
            onChange={v => setNoise("externalEnvironment", v)} />
          <EditableList label="System Interactions"      items={data.noiseCategories.systemInteractions}
            onChange={v => setNoise("systemInteractions", v)} />
        </div>
      </div>

      {/* Inputs / Outputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <EditableList label="Inputs"  items={data.inputs}  onChange={v => set("inputs",  v)} />
        <EditableList label="Outputs" items={data.outputs} onChange={v => set("outputs", v)} />
      </div>

      {/* Bottom 5 columns */}
      <div>
        <p className="text-xs font-semibold mb-2">Analysis Columns</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <EditableList label="Functions"
            items={data.functions} onChange={v => set("functions", v)} />
          <EditableList label="Functional Requirements"
            items={data.functionalRequirements} onChange={v => set("functionalRequirements", v)} />
          <EditableList label="Control Factors"
            items={data.controlFactors} onChange={v => set("controlFactors", v)} />
          <EditableList label="Non-Functional Requirements"
            items={data.nonFunctionalRequirements} onChange={v => set("nonFunctionalRequirements", v)} />
          <EditableList label="Unintended Outputs / Error States"
            items={data.unintendedOutputs} onChange={v => set("unintendedOutputs", v)} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI GENERATION
// ─────────────────────────────────────────────────────────────────────────────

const apiBase = process.env.NEXT_PUBLIC_DFMEA_API || "http://localhost:8000";

async function generateDiagramsFromAPI(
  focusElement: string,
  lowerElements: string[],
  higherElements: string[],
  noise: Record<string, string[]>
): Promise<{ bDiagram: BDiagramData; pDiagram: PDiagramData }> {
  const r = await fetch(`${apiBase}/api/dfmea/generate-diagrams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ focus_element: focusElement, lower_elements: lowerElements, higher_elements: higherElements, noise_factors: noise }),
  });
  return await r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function emptyBDiagram(focusElement = "", lowerEls: string[] = [], higherEls: string[] = []): BDiagramData {
  return {
    focusElement,
    lowerElements:  lowerEls.map(name => ({ name, interactionTypes: ["P", "E"] })),
    higherElements: higherEls.map(name => ({ name, interactionTypes: ["P", "E"] })),
    requirements:   ["LEGAL", "SAFETY", "PRODUCT SPEC", "STANDARDS", "VEHICLE OPERATIONS", "SERVICE"],
    noiseFactors:   [],
  };
}

function emptyPDiagram(focusElement = "", noise: Record<string, string[]> = {}): PDiagramData {
  return {
    systemName: focusElement,
    noiseCategories: {
      pieceTopiece:        noise["Piece to Piece Variation"] || [],
      changeOverTime:      noise["Change Over Time"]         || [],
      customerUsage:       noise["Customer Usage"]           || [],
      externalEnvironment: noise["External Environment"]     || [],
      systemInteractions:  noise["System Interactions"]      || [],
    },
    inputs:  [],
    outputs: [],
    functions:               [],
    functionalRequirements:  [],
    controlFactors:          [],
    nonFunctionalRequirements: [],
    unintendedOutputs:       [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT TO SVG / PNG
// ─────────────────────────────────────────────────────────────────────────────

function downloadSvg(svgEl: SVGSVGElement | null, filename: string) {
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORTED COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface DiagramPanelProps {
  /** Pre-fill from wizard state */
  focusElement?:  string;
  lowerElements?: string[];
  higherElements?: string[];
  noiseFactors?:  Record<string, string[]>;
}

export default function DiagramPanel({
  focusElement  = "",
  lowerElements  = [],
  higherElements = [],
  noiseFactors   = {},
}: DiagramPanelProps) {
  const [activeTab,  setActiveTab]  = useState<"b" | "p">("b");
  const [activeView, setActiveView] = useState<"preview" | "edit">("preview");
  const [generating, setGenerating] = useState(false);

  const [bData, setBData] = useState<BDiagramData>(() =>
    emptyBDiagram(focusElement, lowerElements, higherElements)
  );
  const [pData, setPData] = useState<PDiagramData>(() =>
    emptyPDiagram(focusElement, noiseFactors)
  );

  const [generated, setGenerated] = useState(false);

  const bSvgRef = React.useRef<SVGSVGElement>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateDiagramsFromAPI(
        focusElement, lowerElements, higherElements, noiseFactors
      );
      setBData(result.bDiagram);
      setPData(result.pDiagram);
      setGenerated(true);
      setActiveView("preview");
    } catch (e) {
      console.error("Diagram generation failed:", e);
      // Fallback: pre-fill with wizard data
      setBData(emptyBDiagram(focusElement, lowerElements, higherElements));
      setPData(emptyPDiagram(focusElement, noiseFactors));
      setGenerated(true);
      setActiveView("edit");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Tab switcher */}
        <div className="flex rounded-lg border overflow-hidden">
          {(["b","p"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}>
              {tab === "b" ? "B-Diagram" : "P-Diagram"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Preview / Edit toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(["preview","edit"] as const).map(v => (
              <button key={v} type="button" onClick={() => setActiveView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                  activeView === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted text-muted-foreground"
                }`}>
                {v}
              </button>
            ))}
          </div>

          {/* Generate button */}
          <Button size="sm" onClick={handleGenerate} disabled={generating || !focusElement}>
            {generating
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
              : <><Zap className="h-3.5 w-3.5 mr-1.5" />Auto-Generate</>}
          </Button>

          {/* Export */}
          {activeTab === "b" && (
            <Button size="sm" variant="outline"
              onClick={() => downloadSvg(bSvgRef.current, `${focusElement || "dfmea"}_b-diagram.svg`)}>
              <Download className="h-3.5 w-3.5 mr-1.5" />SVG
            </Button>
          )}
        </div>
      </div>

      {!generated && !generating && (
        <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
          <p className="font-medium">No diagram data yet.</p>
          <p className="mt-1 text-xs">
            Click <strong>Auto-Generate</strong> to create diagrams from your wizard inputs,
            or switch to <strong>Edit</strong> to fill in manually.
          </p>
        </div>
      )}

      {(generated || activeView === "edit") && (
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            {activeTab === "b" ? (
              activeView === "preview" ? (
                <div ref={r => { if (r) { const svg = r.querySelector("svg"); if (svg) (bSvgRef as React.MutableRefObject<SVGSVGElement>).current = svg as SVGSVGElement; } }}>
                  <BDiagramRenderer data={bData} />
                </div>
              ) : (
                <BDiagramForm data={bData} onChange={setBData} />
              )
            ) : (
              activeView === "preview" ? (
                <PDiagramRenderer data={pData} />
              ) : (
                <PDiagramForm data={pData} onChange={setPData} />
              )
            )}
          </CardContent>
        </Card>
      )}

      {/* Interaction type legend for B-diagram */}
      {activeTab === "b" && generated && activeView === "preview" && (
        <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1">
          {Object.entries(INTERACTION_LABELS).map(([k, v]) => (
            <span key={k}>
              <span className="font-bold" style={{ color: INTERACTION_COLORS[k] }}>{k}</span>
              {" — "}{v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
