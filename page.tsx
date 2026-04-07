"use client";

// app/page.tsx  (or pages/index.tsx for pages router)
// ─────────────────────────────────────────────────────────────────────────────
// Root entry point.
// Shows DFMEALauncher first. When user clicks Start, transitions to DFMEAWizard
// with the initialState returned by the launcher (which may include parsed data
// from an uploaded DFMEA for Cases 2 and 3).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DFMEALauncher, { type WizardInitialState } from "@/components/DFMEALauncher";
import DFMEAWizard from "@/components/DFMEAWizard";

export default function HomePage() {
  const [initialState, setInitialState] = useState<WizardInitialState | null>(null);

  const handleStart = (state: WizardInitialState) => {
    setInitialState(state);
  };

  const handleReset = () => {
    setInitialState(null);
  };

  return (
    <AnimatePresence mode="wait">
      {!initialState ? (
        <motion.div
          key="launcher"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          <DFMEALauncher onStart={handleStart} />
        </motion.div>
      ) : (
        <motion.div
          key="wizard"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Small "← New session" link so user can restart */}
          <div className="max-w-6xl mx-auto px-4 pt-4">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              ← New session
            </button>
          </div>
          <DFMEAWizard initialState={initialState} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
