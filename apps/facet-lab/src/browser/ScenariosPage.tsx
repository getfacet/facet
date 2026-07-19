import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { FacetTheme } from "@facet/core";

import { OFFICIAL_SCENARIOS, type OfficialScenario } from "../scenarios/scenarios.js";
import type { BrowserCreatedRun, LabApiClient } from "./api-client.js";
import { GeneratePage } from "./GeneratePage.js";
import type { LabCapabilities } from "./run-config.js";

export interface ScenariosPageProps {
  readonly client?: LabApiClient;
  readonly capabilities?: LabCapabilities;
  readonly scenarios?: readonly OfficialScenario[];
  readonly theme?: FacetTheme;
  readonly assetSettingsBusy?: boolean;
  readonly onRunStarted?: (run: BrowserCreatedRun) => void;
  readonly onStartingChange?: (starting: boolean) => void;
}

interface ConstraintOption {
  readonly value: string;
  readonly label: string;
}

function constraintOptions(scenario: OfficialScenario): readonly ConstraintOption[] {
  return [
    ...scenario.expectedAssets.bricks.map((brick) => ({
      value: `brick:${brick}`,
      label: `${brick} Brick`,
    })),
    ...scenario.expectedAssets.presets.map(({ brick, name }) => ({
      value: `preset:${brick}:${name}`,
      label: `${name} ${brick} Preset`,
    })),
    ...scenario.expectedAssets.patterns.map((name) => ({
      value: `pattern:${name}`,
      label: `${name} Pattern`,
    })),
  ];
}

export function ScenariosPage({
  client,
  capabilities,
  scenarios = OFFICIAL_SCENARIOS,
  theme,
  assetSettingsBusy = false,
  onRunStarted,
  onStartingChange,
}: ScenariosPageProps = {}): ReactNode {
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id ?? "");
  const [constraint, setConstraint] = useState<string | null>(null);
  const selected = scenarios.find(({ id }) => id === selectedId) ?? scenarios[0];
  const options = useMemo(
    () => (selected === undefined ? [] : constraintOptions(selected)),
    [selected],
  );

  if (selected === undefined) {
    return (
      <section aria-labelledby="scenarios-title">
        <h1 id="scenarios-title">Official scenarios</h1>
        <p role="status">No official scenarios are available.</p>
      </section>
    );
  }

  const chooseScenario = (scenario: OfficialScenario): void => {
    setSelectedId(scenario.id);
    setConstraint(null);
  };

  return (
    <section aria-labelledby="scenarios-title">
      <h1 id="scenarios-title">Official scenarios</h1>
      <p>Browse the supported capabilities, then configure an autonomous or constrained run.</p>
      <ul aria-label="Official scenario catalog">
        {scenarios.map((scenario) => (
          <li key={scenario.id}>
            <article aria-labelledby={`scenario-${scenario.id}`}>
              <h2 id={`scenario-${scenario.id}`}>{scenario.name}</h2>
              <p>{scenario.prompt}</p>
              <dl>
                <dt>Capability</dt>
                <dd>{scenario.capability}</dd>
                <dt>Expected stage mutations</dt>
                <dd>{scenario.expectedOutcomes.stageMutations}</dd>
                <dt>Bricks</dt>
                <dd>{scenario.expectedAssets.bricks.join(", ")}</dd>
                <dt>Patterns</dt>
                <dd>{scenario.expectedAssets.patterns.join(", ") || "None"}</dd>
              </dl>
              <button
                type="button"
                aria-pressed={selected.id === scenario.id}
                onClick={() => chooseScenario(scenario)}
              >
                Configure {scenario.name}
              </button>
            </article>
          </li>
        ))}
      </ul>

      <section aria-labelledby="scenario-run-title">
        <h2 id="scenario-run-title">Run {selected.name}</h2>
        <label htmlFor="scenario-constraint">Starting asset constraint</label>
        <select
          id="scenario-constraint"
          value={constraint ?? ""}
          onChange={(event) => setConstraint(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">Agent autonomous</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <GeneratePage
          {...(client === undefined ? {} : { client })}
          {...(capabilities === undefined ? {} : { capabilities })}
          scenarios={scenarios}
          initialScenarioId={selected.id}
          initialConstraint={constraint}
          {...(theme === undefined ? {} : { theme })}
          assetSettingsBusy={assetSettingsBusy}
          {...(onRunStarted === undefined ? {} : { onRunStarted })}
          {...(onStartingChange === undefined ? {} : { onStartingChange })}
        />
      </section>
    </section>
  );
}
