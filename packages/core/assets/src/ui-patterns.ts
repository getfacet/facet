import type { UiPattern, UiPatternSet } from "@facet/core";

function freezePattern(pattern: UiPattern): UiPattern {
  return Object.freeze({
    ...pattern,
    avoidWhen: Object.freeze([...pattern.avoidWhen]),
    informationOrder: Object.freeze([...pattern.informationOrder]),
    regions: Object.freeze(pattern.regions.map((region) => Object.freeze({ ...region }))),
    componentChoices: Object.freeze(
      pattern.componentChoices.map((choice) =>
        Object.freeze({ ...choice, tags: Object.freeze([...choice.tags]) }),
      ),
    ),
    variants: Object.freeze(pattern.variants.map((variant) => Object.freeze({ ...variant }))),
    avoid: Object.freeze([...pattern.avoid]),
  });
}

const BROWSE = freezePattern({
  id: "browse",
  title: "Browse and narrow a collection",
  whenToUse:
    "Use when the visitor must scan several subjects, narrow the set, and choose one to inspect or use.",
  avoidWhen: [
    "Avoid when only one subject matters or the visitor already knows the exact target.",
    "Avoid when shared-criterion comparison is the primary task.",
  ],
  informationOrder: [
    "Current scope and useful narrowing controls",
    "Consistent recognition cues for each result",
    "Selection state and the next local action",
  ],
  regions: [
    {
      id: "controls",
      purpose: "Let the visitor narrow or change how the collection is viewed.",
      relationship: "Keep controls adjacent to the results they change.",
    },
    {
      id: "results",
      purpose: "Present repeatable subjects with only recognition and selection information.",
      relationship: "Give this region the most space and keep item structure consistent.",
    },
    {
      id: "selection",
      purpose: "Preserve the selected subject and its next useful action.",
      relationship: "Use a supporting region only when selection context must remain visible.",
    },
  ],
  componentChoices: [
    {
      whenToUse: "Use when imagery or category recognition drives selection.",
      tags: ["Grid", "MediaCard", "Badge", "Button"],
      rationale:
        "A visual collection supports quick recognition without repeating long descriptions.",
    },
    {
      whenToUse: "Use when results are factual, dense, or numerous.",
      tags: ["Stack", "Row", "Card", "Table", "Text"],
      rationale: "Aligned repeated facts scan faster than decorative cards with prose.",
    },
    {
      whenToUse: "Use when the chosen subject must remain visible beside the collection.",
      tags: ["Split", "Stack", "Card", "Button"],
      rationale: "Master-detail continuity avoids navigating away before the visitor commits.",
    },
  ],
  variants: [
    {
      id: "visual-grid",
      whenToUse:
        "Use for a modest collection whose visual category and short metadata aid recognition.",
      composition: "A compact scope row leads directly into a responsive visual result grid.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="wide"><Stack gap="lg"><Row justify="between"><Text value="Available options" variant="title" /><Badge label="12 results" /></Row><Grid columns="3" gap="md"><MediaCard title="Option A" eyebrow="Category" meta="Available"><Button label="Inspect" action="agent:inspect" arg="a" tone="quiet" /></MediaCard><MediaCard title="Option B" eyebrow="Category" meta="Available"><Button label="Inspect" action="agent:inspect" arg="b" tone="quiet" /></MediaCard><MediaCard title="Option C" eyebrow="Category" meta="Available"><Button label="Inspect" action="agent:inspect" arg="c" tone="quiet" /></MediaCard></Grid></Stack></Screen></Facet>',
    },
    {
      id: "master-detail",
      whenToUse:
        "Use when visitors need to scan a short list while keeping one selected subject in context.",
      composition:
        "A denser result stack occupies the primary column and one selected detail stays beside it.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="full"><Split ratio="60:40" gap="lg"><Stack gap="sm"><Text value="Results" variant="heading" /><Card title="Option A"><Row justify="between"><Badge label="Selected" tone="positive" /><Button label="Choose" action="agent:choose" arg="a" tone="quiet" /></Row></Card><Card title="Option B"><Row justify="between"><Text value="Secondary details" tone="muted" /><Button label="Inspect" action="agent:inspect" arg="b" tone="quiet" /></Row></Card></Stack><Card title="Option A details" tone="accent"><Stack gap="md"><Text value="The decisive facts for the selected option." /><Button label="Continue with Option A" action="agent:continue" arg="a" tone="primary" /></Stack></Card></Split></Screen></Facet>',
    },
  ],
  avoid: [
    "Do not place a marketing introduction before the collection.",
    "Do not repeat the same description inside every result.",
    "Do not add filters that cannot materially narrow the set.",
  ],
});

const COMPARE = freezePattern({
  id: "compare",
  title: "Compare alternatives and decide",
  whenToUse:
    "Use when the visitor must evaluate multiple alternatives against shared criteria before choosing.",
  avoidWhen: [
    "Avoid when the visitor only needs to browse without shared criteria.",
    "Avoid when one verified option is already the only viable result.",
  ],
  informationOrder: [
    "Decision context and decisive criteria",
    "Aligned differences across viable alternatives",
    "Current selection, tradeoff, and confirmation action",
  ],
  regions: [
    {
      id: "criteria",
      purpose: "Keep the criteria and constraints used for this decision visible.",
      relationship: "Criteria must align with every alternative and not become a separate essay.",
    },
    {
      id: "alternatives",
      purpose: "Show like-for-like facts and highlight only meaningful differences.",
      relationship: "This is the primary region; preserve alignment while the visitor scans.",
    },
    {
      id: "decision",
      purpose: "Summarize the current tradeoff and provide one clear selection action.",
      relationship: "Place it after or beside comparison without hiding the compared facts.",
    },
  ],
  componentChoices: [
    {
      whenToUse: "Use when two or three rich alternatives need direct side-by-side inspection.",
      tags: ["Grid", "Card", "Stack", "Badge", "Button"],
      rationale: "Equal-height grouped alternatives keep criterion order and actions comparable.",
    },
    {
      whenToUse: "Use when many criteria or alternatives must stay aligned.",
      tags: ["Table", "Section", "Badge", "Button"],
      rationale: "A matrix carries more comparable facts with less repeated prose.",
    },
    {
      whenToUse: "Use when one alternative clearly fits but the tradeoff still needs proof.",
      tags: ["Split", "Card", "FeatureList", "CTA"],
      rationale:
        "A focused recommendation can retain evidence without displaying every option equally.",
    },
  ],
  variants: [
    {
      id: "side-by-side",
      whenToUse: "Use for two or three alternatives with a small shared criterion set.",
      composition:
        "A brief decision context leads to equal comparison columns with local selection actions.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="wide"><Stack gap="lg"><Section title="Choose the best fit" description="Compare the differences that affect this decision." padding="none"><Row gap="sm"><Badge label="Speed" /><Badge label="Control" /><Badge label="Effort" /></Row></Section><Grid columns="3" gap="md"><Card title="Guided" tone="accent"><Stack gap="md" justify="between" grow="true"><Text value="Fastest start with more guidance." /><Button label="Choose Guided" action="agent:choose" arg="guided" tone="primary" /></Stack></Card><Card title="Balanced"><Stack gap="md" justify="between" grow="true"><Text value="Shared control and moderate setup." /><Button label="Choose Balanced" action="agent:choose" arg="balanced" /></Stack></Card><Card title="Flexible"><Stack gap="md" justify="between" grow="true"><Text value="Most control with more setup." /><Button label="Choose Flexible" action="agent:choose" arg="flexible" /></Stack></Card></Grid></Stack></Screen></Facet>',
    },
    {
      id: "focused-recommendation",
      whenToUse:
        "Use when one alternative fits the known constraints and the visitor needs concise evidence.",
      composition:
        "The recommended option leads; a quieter evidence region keeps the rejected tradeoffs inspectable.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="wide"><Split ratio="60:40" gap="lg"><Card title="Recommended: Balanced" tone="accent"><Stack gap="md"><Badge label="Best fit" tone="positive" /><FeatureList columns="1"><Text value="Matches the current priority." /><Text value="Keeps setup within the available effort." /><Text value="Leaves room to change later." /></FeatureList><Button label="Continue with Balanced" action="agent:choose" arg="balanced" tone="primary" /></Stack></Card><Stack gap="sm"><Text value="Tradeoffs" variant="heading" /><Card title="Guided"><Text value="Faster, but less control." /></Card><Card title="Flexible"><Text value="More control, but more setup." /></Card></Stack></Split></Screen></Facet>',
    },
  ],
  avoid: [
    "Do not compare alternatives using different levels of detail.",
    "Do not repeat generic claims that do not affect the decision.",
    "Do not separate the selection action from the evidence it relies on.",
  ],
});

const DIAGNOSE = freezePattern({
  id: "diagnose",
  title: "Diagnose a changing or failed state",
  whenToUse:
    "Use when the visitor must understand an exception, inspect evidence, and take a recovery action.",
  avoidWhen: [
    "Avoid for a healthy overview with no actionable exception.",
    "Avoid when the visitor only needs a static subject description.",
  ],
  informationOrder: [
    "Current severity, affected subject, and freshness",
    "Prioritized evidence and the most likely failing condition",
    "Safe investigation or recovery action and its result",
  ],
  regions: [
    {
      id: "status",
      purpose: "State what is wrong, where, and how current the evidence is.",
      relationship:
        "Lead the screen and visually separate actionable exceptions from healthy context.",
    },
    {
      id: "evidence",
      purpose: "Show the checks or events that support the diagnosis.",
      relationship: "Keep evidence ordered and subordinate to the actionable condition.",
    },
    {
      id: "recovery",
      purpose: "Offer the next safe diagnostic or recovery action with expected consequence.",
      relationship: "Attach actions directly to the condition they affect.",
    },
  ],
  componentChoices: [
    {
      whenToUse: "Use for one active incident with ordered evidence.",
      tags: ["Alert", "Timeline", "Card", "Button"],
      rationale: "Severity, evidence, and recovery stay in one diagnostic reading path.",
    },
    {
      whenToUse: "Use when one exception must be separated from surrounding healthy signals.",
      tags: ["Split", "Metric", "Badge", "Stack", "Card"],
      rationale: "An asymmetric frame gives the exception priority without hiding context.",
    },
    {
      whenToUse:
        "Use when persistent navigation or several diagnostic areas must remain available.",
      tags: ["AppShell", "Nav", "Stack", "Section"],
      rationale:
        "A stable work surface helps repeated investigation without turning every signal into a card.",
    },
  ],
  variants: [
    {
      id: "focused-incident",
      whenToUse: "Use when one incident has a clear severity and an ordered investigation trail.",
      composition:
        "A prominent incident state is followed by evidence and one bounded recovery action.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="wide"><Stack gap="lg"><Alert title="Delivery is blocked" description="The latest attempt did not reach its destination." tone="danger"><Row gap="sm"><Badge label="Critical" tone="danger" /><Badge label="Updated now" /></Row></Alert><Timeline title="Evidence"><Card title="Request accepted"><Text value="The request entered the processing queue." /></Card><Card title="Destination rejected"><Text value="The destination refused the final handoff." /></Card></Timeline><Card title="Next recovery step" tone="warning"><Row justify="between"><Text value="Verify the destination configuration before retrying." /><Button label="Run verification" action="agent:verify" tone="primary" /></Row></Card></Stack></Screen></Facet>',
    },
    {
      id: "exception-with-context",
      whenToUse: "Use when one failing area must be judged against several healthy signals.",
      composition:
        "The exception and recovery occupy the primary column; compact healthy context remains secondary.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="full"><AppShell gap="lg"><Stack gap="sm"><Text value="System areas" variant="heading" /><Badge label="Payments healthy" tone="positive" /><Badge label="Search healthy" tone="positive" /><Badge label="Delivery issue" tone="danger" /></Stack><Split ratio="60:40" gap="lg"><Card title="Delivery issue" tone="danger"><Stack gap="md"><Text value="The destination is rejecting handoff attempts." /><Button label="Inspect destination" action="agent:inspect" arg="destination" tone="primary" /></Stack></Card><Stack gap="sm"><Metric label="Failed attempts" value="3" /><Card title="Last known good"><Text value="The previous successful handoff completed earlier today." /></Card></Stack></Split></AppShell></Screen></Facet>',
    },
  ],
  avoid: [
    "Do not give every signal equal visual weight.",
    "Do not present stale evidence as current.",
    "Do not offer recovery actions without the condition and consequence they affect.",
  ],
});

const PROGRESS = freezePattern({
  id: "progress",
  title: "Progress through a multi-step task",
  whenToUse:
    "Use when several dependent stages, completion state, and recovery points matter to the visitor.",
  avoidWhen: [
    "Avoid when one direct action completes the task.",
    "Avoid when the stages have no meaningful order or persisted decisions.",
  ],
  informationOrder: [
    "Current stage and completed decisions needed now",
    "The work required in the current stage",
    "Valid next, back, review, or recovery action",
  ],
  regions: [
    {
      id: "orientation",
      purpose: "Show bounded progress and the current stage without dominating the task.",
      relationship: "Keep this persistent but secondary to current work.",
    },
    {
      id: "current-work",
      purpose: "Present only the information and controls required for the active stage.",
      relationship: "This is the primary region and may change at each stage.",
    },
    {
      id: "navigation",
      purpose: "Provide only valid next, back, review, or recovery transitions.",
      relationship: "Place transitions with the current work and preserve consequential choices.",
    },
  ],
  componentChoices: [
    {
      whenToUse: "Use for a short linear task with a clear completion percentage.",
      tags: ["Progress", "Stack", "Card", "Row", "Button"],
      rationale: "Progress stays visible while the current task receives the primary space.",
    },
    {
      whenToUse: "Use when completed and blocked stages need an auditable sequence.",
      tags: ["Timeline", "Alert", "Badge", "Button"],
      rationale: "An ordered history makes recovery and prior decisions easy to locate.",
    },
    {
      whenToUse: "Use when persistent step navigation supports a substantial workspace.",
      tags: ["AppShell", "Stack", "Section", "Card"],
      rationale: "A stable rail preserves orientation while the active work changes.",
    },
  ],
  variants: [
    {
      id: "focused-step",
      whenToUse: "Use for a short dependent flow where only the current step needs full detail.",
      composition: "Compact progress and prior decisions lead into one dominant current-work card.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="wide"><Stack gap="lg"><Progress label="Setup progress" value="50" /><Row gap="sm"><Badge label="Account complete" tone="positive" /><Badge label="Preferences current" /><Badge label="Review next" /></Row><Card title="Set preferences" tone="accent"><Stack gap="md"><Text value="Choose the values needed for the next result." /><Row justify="between"><Button label="Back" action="agent:back" tone="quiet" /><Button label="Continue to review" action="agent:continue" tone="primary" /></Row></Stack></Card></Stack></Screen></Facet>',
    },
    {
      id: "workspace-steps",
      whenToUse: "Use when step orientation must persist beside a larger active workspace.",
      composition:
        "A quiet step rail remains stable while the primary workspace presents current work and recovery.",
      exampleMarkup:
        '<Facet entry="main"><Screen name="main" maxWidth="full"><AppShell gap="lg"><Stack gap="sm"><Text value="Steps" variant="heading" /><Badge label="1 Complete" tone="positive" /><Badge label="2 In progress" /><Badge label="3 Not started" /></Stack><Stack gap="lg"><Progress label="Onboarding" value="40" /><Section title="Connect the service" description="Complete the current requirement before continuing."><Card title="Connection details"><Stack gap="md"><Text value="The service is ready for one final verification." /><Row justify="between"><Button label="Review previous" action="agent:back" tone="quiet" /><Button label="Verify and continue" action="agent:verify" tone="primary" /></Row></Stack></Card></Section></Stack></AppShell></Screen></Facet>',
    },
  ],
  avoid: [
    "Do not expose future-stage detail before it is actionable.",
    "Do not disguise optional work as a required step.",
    "Do not repeat completed content unless it affects the current decision.",
  ],
});

export const DEFAULT_UI_PATTERN_SET: UiPatternSet = Object.freeze({
  version: "facet-default-ui-patterns-v1",
  patterns: Object.freeze([BROWSE, COMPARE, DIAGNOSE, PROGRESS]),
});
