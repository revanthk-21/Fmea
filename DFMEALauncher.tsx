"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, Sparkles, Wrench, RefreshCw, ArrowRight, X } from "lucide-react";

const apiBase = process.env.NEXT_PUBLIC_DFMEA_API ?? "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type DFMEAMode = "new_design" | "new_use_case" | "design_change";

export type WizardInitialState = {
  mode: DFMEAMode;
  // Element names
  focusElement?:    string;
  lowerElements?:   string[];
  higherElements?:  string[];
  // Functions per element
  focusFunctions?:  string[];
  lowerFunctions?:  Record<string, string[]>;   // { elementName: [fn, fn] }
  higherFunctions?: Record<string, string[]>;
  // Noise factors (for Case 3 pre-fill, or old noise for Case 2 display)
  noiseFactors?: {
    pieceTopiece?:        string[];
    changeOverTime?:      string[];
    customerUsage?:       string[];
    externalEnvironment?: string[];
    systemInteractions?:  string[];
  };
  // Case 2 only — old noise factors to show as "being replaced"
  oldNoiseFactors?: {
    flat:        string[];
    by_category: Record<string, string[]>;
  };
  // Failure modes (Case 2: shown with old noise; Case 3: reference panel)
  failureModes?: Array<{
    focus_fn:        string;
    failure_mode:    string;
    failure_effect:  string;
    severity:        number | null;
    lower_elements:  string[];
    old_noise_factors?: string[];  // Case 2
  }>;
  // Case 3 only — S/O/D reference from old DFMEA
  sodReference?: Record<string, {
    max_severity: number | null;
    avg_occurrence: number | null;
    avg_detection: number | null;
    max_rpn: number | null;
  }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// MODE CARDS
// ─────────────────────────────────────────────────────────────────────────────

const MODES: Array<{
  id:       DFMEAMode;
  icon:     React.ReactNode;
  title:    string;
  subtitle: string;
  tags:     string[];
  color:    string;
  upload:   boolean;
}> = [
  {
    id:       "new_design",
    icon:     <Sparkles className="h-7 w-7" />,
    title:    "New Design",
    subtitle: "Generate a DFMEA from scratch for a completely new system or component.",
    tags:     ["Full wizard", "No import needed", "AI-assisted"],
    color:    "border-blue-200 bg-blue-50/50 hover:bg-blue-50",
    upload:   false,
  },
  {
    id:       "new_use_case",
    icon:     <RefreshCw className="h-7 w-7" />,
    title:    "New Use Case / Environment",
    subtitle:
      "Same design, different operating conditions. Import an existing DFMEA to reuse element names and functions, then generate causes for your new noise factors.",
    tags:     ["Import old DFMEA", "Reuse functions", "Replace noise factors"],
    color:    "border-amber-200 bg-amber-50/50 hover:bg-amber-50",
    upload:   true,
  },
  {
    id:       "design_change",
    icon:     <Wrench className="h-7 w-7" />,
    title:    "Design Change",
    subtitle:
      "Modified component, same operating environment. Import the old DFMEA to keep element names, functions and noise factors — then re-draw connections and regenerate causes for the changed design.",
    tags:     ["Import old DFMEA", "Retain noise factors", "Re-generate causes"],
    color:    "border-green-200 bg-green-50/50 hover:bg-green-50",
    upload:   true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface DFMEALauncherProps {
  onStart: (initialState: WizardInitialState) => void;
}

export default function DFMEALauncher({ onStart }: DFMEALauncherProps) {
  const [selected,  setSelected]  = useState<DFMEAMode | null>(null);
  const [file,      setFile]      = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
  };

  const handleStart = async () => {
    if (!selected) return;

    // Case 1 — no upload needed, start immediately
    if (selected === "new_design") {
      onStart({ mode: "new_design" });
      return;
    }

    // Cases 2 & 3 — upload and parse
    if (!file) {
      setError("Please select a DFMEA xlsx file to upload.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("case", selected);   // "new_use_case" | "design_change"

      const res = await fetch(`${apiBase}/api/dfmea/import/parse`, {
        method: "POST",
        body:   form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "Parse failed");
      }

      const payload = await res.json();

      // Map API response → WizardInitialState
      const initialState: WizardInitialState = {
        mode:            selected,
        focusElement:    payload.elements?.focus,
        lowerElements:   payload.elements?.lower  ?? [],
        higherElements:  payload.elements?.higher ?? [],
        focusFunctions:  payload.focus_functions  ?? [],
        lowerFunctions:  payload.lower_functions  ?? {},
        higherFunctions: payload.higher_functions ?? {},
      };

      if (selected === "new_use_case") {
        initialState.oldNoiseFactors = payload.old_noise_factors;
        initialState.failureModes    = payload.failure_modes;
        // Do NOT pre-fill noise — user enters new ones
      }

      if (selected === "design_change") {
        // Pre-fill noise factors from old DFMEA
        const nf = payload.noise_factors ?? {};
        initialState.noiseFactors = {
          pieceTopiece:        nf.pieceTopiece        ?? [],
          changeOverTime:      nf.changeOverTime       ?? [],
          customerUsage:       nf.customerUsage        ?? [],
          externalEnvironment: nf.externalEnvironment  ?? [],
          systemInteractions:  nf.systemInteractions   ?? [],
        };
        initialState.failureModes = payload.reference_modes;
        initialState.sodReference  = payload.sod_reference;
      }

      onStart(initialState);
    } catch (e: any) {
      setError(e.message ?? "An unexpected error occurred.");
    } finally {
      setUploading(false);
    }
  };

  const needsUpload = selected === "new_use_case" || selected === "design_change";
  const canStart    = selected === "new_design" || (needsUpload && !!file);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl space-y-8">

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">DFMEA Builder</h1>
          <p className="text-gray-500 text-sm max-w-xl mx-auto">
            Select how you want to use this tool. Your choice determines what gets pre-filled
            and what you need to generate fresh.
          </p>
        </div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODES.map(mode => (
            <button
              key={mode.id}
              type="button"
              onClick={() => { setSelected(mode.id); setFile(null); setError(null); }}
              className={`text-left rounded-2xl border-2 p-5 transition-all duration-200 space-y-3 ${mode.color} ${
                selected === mode.id
                  ? "ring-2 ring-primary ring-offset-2 border-primary"
                  : "border-gray-200"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                selected === mode.id ? "bg-primary text-white" : "bg-white text-gray-600 border border-gray-200"
              }`}>
                {mode.icon}
              </div>
              <div>
                <div className="font-semibold text-gray-900">{mode.title}</div>
                <div className="text-xs text-gray-500 mt-1 leading-relaxed">{mode.subtitle}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {mode.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* File upload + comparison panel */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key={selected}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {needsUpload ? (
                <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Upload className="h-5 w-5 text-gray-400" />
                    <div>
                      <div className="font-medium text-sm text-gray-800">
                        Upload existing DFMEA
                      </div>
                      <div className="text-xs text-gray-400">
                        Accepts .xlsx in AIAG-VDA 2019 or legacy Ford/GM format
                      </div>
                    </div>
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {!file ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full rounded-xl border-2 border-dashed border-gray-200 hover:border-primary/50 hover:bg-primary/5 transition-colors p-8 text-center text-sm text-gray-400 hover:text-primary"
                    >
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      Click to select DFMEA file
                    </button>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                      <div className="flex items-center gap-3 text-sm">
                        <FileText className="h-4 w-4 text-green-600 shrink-0" />
                        <div>
                          <div className="font-medium text-green-800">{file.name}</div>
                          <div className="text-xs text-green-600">{(file.size / 1024).toFixed(0)} KB</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* What gets pre-filled vs what user does */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 space-y-1">
                      <div className="text-xs font-semibold text-blue-700">Pre-filled from import</div>
                      {selected === "new_use_case" && (
                        <ul className="text-xs text-blue-600 space-y-0.5">
                          <li>✓ Element names (lower / focus / higher)</li>
                          <li>✓ All functions per element</li>
                          <li>✓ Old noise factors (shown for reference)</li>
                          <li>✓ Failure modes (with old noise context)</li>
                        </ul>
                      )}
                      {selected === "design_change" && (
                        <ul className="text-xs text-blue-600 space-y-0.5">
                          <li>✓ Element names (lower / focus / higher)</li>
                          <li>✓ All functions per element</li>
                          <li>✓ Noise factors (environment unchanged)</li>
                          <li>✓ B-Diagram boxes (no connections)</li>
                        </ul>
                      )}
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 space-y-1">
                      <div className="text-xs font-semibold text-amber-700">You will do</div>
                      {selected === "new_use_case" && (
                        <ul className="text-xs text-amber-600 space-y-0.5">
                          <li>→ Enter new noise factors in P-Diagram</li>
                          <li>→ Draw B-Diagram connections</li>
                          <li>→ Re-generate causes for new conditions</li>
                          <li>→ Rate Occurrence &amp; Detection</li>
                        </ul>
                      )}
                      {selected === "design_change" && (
                        <ul className="text-xs text-amber-600 space-y-0.5">
                          <li>→ Re-draw connections in B-Diagram</li>
                          <li>→ Set function connections</li>
                          <li>→ Re-generate failure modes &amp; causes</li>
                          <li>→ Rate everything fresh</li>
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Case 1 — new design, no upload */
                <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 flex items-start gap-4">
                  <Sparkles className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                  <div className="text-sm text-blue-700 space-y-1">
                    <div className="font-semibold">Full wizard — start from scratch</div>
                    <div className="text-xs text-blue-500 leading-relaxed">
                      You will define elements, draw the B-Diagram, add functions, fill the P-Diagram
                      with noise factors, and the AI will generate failure modes, causes, effects and
                      severity ratings step by step.
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  size="lg"
                  disabled={!canStart || uploading}
                  onClick={handleStart}
                  className="px-8"
                >
                  {uploading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Parsing DFMEA…</>
                  ) : (
                    <>Start <ArrowRight className="h-4 w-4 ml-2" /></>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
