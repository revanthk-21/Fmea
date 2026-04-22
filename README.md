Let me read the current rating step and types first.
Now I have everything. Here's the backend router, then precisely what to add in the frontend.
Register the router in main.py
from routers import auto_rating
app.include_router(auto_rating.router, prefix="/api/dfmea")
Frontend — what to add
1. State (inside DFMEAWizard, with the other state declarations)
const [autoRatingLoading, setAutoRatingLoading] = useState(false);
2. Handler function (after updateCauseField)
const autoAssignRatings = async () => {
  setAutoRatingLoading(true);

  // Collect all selected causes across all groups
  const payload = causeGroups.flatMap((group, gi) =>
    group.causes
      .filter(c => c.selected)
      .map(cause => ({
        cause_id:           cause.id,
        cause:              cause.cause,
        noise_factor:       cause.noise_factor,
        noise_category:     cause.noise_category,
        failure_mode:       group.failure_mode,
        focus_function:     group.focus_function,
        focus_element:      focusElement?.name ?? "",
        lower_element:      group.lower_element,
        lower_function:     group.lower_function,
        prevention_methods: cause.prevention_methods,
        detection_methods:  cause.detection_methods,
      }))
  );

  try {
    const res = await fetch(`${apiBase}/api/dfmea/auto-rating/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ causes: payload }),
    });
    const data = await res.json();

    // Map results back onto causeGroups by cause_id
    const resultMap: Record<string, { occurrence_answer: string; detection_answer: string }> = {};
    for (const r of data.results ?? []) {
      resultMap[r.cause_id] = r;
    }

    setCauseGroups(prev =>
      prev.map(group => ({
        ...group,
        causes: group.causes.map(cause => {
          const r = resultMap[cause.id];
          if (!r) return cause;
          return { ...cause, occurrence_answer: r.occurrence_answer, detection_answer: r.detection_answer };
        }),
      }))
    );
  } catch (e) {
    console.error("Auto-rating failed:", e);
  } finally {
    setAutoRatingLoading(false);
  }
};
3. Button in StepRating (add next to the progress bar, before the cause groups)
Replace the progress bar div block with:
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
  <Button
    size="sm"
    variant="outline"
    disabled={autoRatingLoading || totalSelected === 0}
    onClick={autoAssignRatings}
  >
    {autoRatingLoading
      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Auto-assigning…</>
      : <><Zap className="h-3.5 w-3.5 mr-1.5" />Auto-assign risk rating</>}
  </Button>
</div>
That's all. The button sits in the progress bar row so it's always visible, Zap is already imported, and after the handler runs the OptionPills automatically reflect the new values since they read from cause.occurrence_answer / cause.detection_answer. The user can still override any pill manually after auto-assign.
