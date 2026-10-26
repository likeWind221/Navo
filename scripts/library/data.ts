export const goal = "Compare Atlas and Boreal using the project library and deliver a recommendation under a budget of 45. Preserve conflicting scores and identify missing deployment costs. Do not use the internet.";

export const documents = [
  { name: "measurements.md", body: "# Atlas measurements\nAtlas score: 82. Boreal score: 78.\nMeasured on synthetic fixture v1.\n" },
  { name: "constraints.md", body: "# Atlas constraints\nAtlas price: 40. Boreal price: 35. Budget: 45.\nBoth licenses allow the intended use. Deployment cost is not supplied.\n" },
  { name: "conflict.md", body: "# Atlas conflict\nA second undated record reports Atlas score: 88.\nNo evidence resolves the disagreement with score 82.\n" },
] as const;

export const criteria = [
  "Deliver a comparison of Atlas and Boreal with exact scores, prices and budget, supported by at least two actually fetched source Resources; the submitted answer itself is a valid deliverable.",
  "Report the unresolved Atlas 82 versus 88 conflict and unknown deployment cost without inventing a resolution or value.",
] as const;

export const comparison = "Atlas: score 82 or 88 (unresolved conflict), price 40. Boreal: score 78, price 35. Budget 45; both fit. Deployment cost: unknown. Sources: measurements.md, constraints.md, conflict.md.";

export const feedback = "REVIEW_GAP: preserve both Atlas scores 82 and 88 and explicitly mark deployment cost unknown.";
