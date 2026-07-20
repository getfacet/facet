import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { createLabApiClient, type LabApiClient } from "./api-client.js";
import {
  projectSettings,
  type SafeSettingsMetadata,
  type SettingsProjection,
} from "./sandbox-presenter.js";
import type { LabCapabilities } from "./run-config.js";

export interface SettingsPageProps {
  readonly client?: LabApiClient;
  readonly capabilities?: LabCapabilities;
  readonly metadata?: SafeSettingsMetadata;
}

function displayNumber(value: { readonly status: string; readonly value: number | null }): string {
  return value.status === "available" && value.value !== null ? String(value.value) : "Unavailable";
}

export function SettingsPage({
  client: providedClient,
  capabilities: providedCapabilities,
  metadata,
}: SettingsPageProps = {}): ReactNode {
  const client = useMemo(() => providedClient ?? createLabApiClient(), [providedClient]);
  const [settings, setSettings] = useState<SettingsProjection | null>(() =>
    providedCapabilities === undefined
      ? null
      : projectSettings(providedCapabilities, metadata ?? providedCapabilities),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedCapabilities !== undefined) {
      setSettings(projectSettings(providedCapabilities, metadata ?? providedCapabilities));
      setError(null);
      return;
    }
    let current = true;
    void client
      .getCapabilities()
      .then((capabilities) => {
        if (current) setSettings(projectSettings(capabilities, metadata ?? capabilities));
      })
      .catch(() => {
        if (current) setError("Facet Lab settings could not be loaded.");
      });
    return () => {
      current = false;
    };
  }, [client, metadata, providedCapabilities]);

  return (
    <section className="lab-page lab-settings-page" aria-labelledby="settings-title">
      <header className="lab-page-header">
        <h1 id="settings-title">Settings</h1>
        <p>Read-only server capabilities. Provider credentials are never sent to this page.</p>
      </header>
      {error === null ? null : <p role="alert">{error}</p>}
      {settings === null ? (
        <p role="status">Loading secret-free settings…</p>
      ) : (
        <div className="lab-settings-grid">
          <section aria-labelledby="settings-providers-title">
            <h2 id="settings-providers-title">Provider capabilities</h2>
            <dl>
              {settings.providers.map((provider) => (
                <div key={provider.provider}>
                  <dt>{provider.provider}</dt>
                  <dd>
                    {provider.available ? "Available" : "Unavailable"}; models:{" "}
                    {provider.models.join(", ")}; default: {provider.defaultModel}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="settings-storage-title">
            <h2 id="settings-storage-title">Evidence storage</h2>
            <dl>
              <dt>Data directory</dt>
              <dd>{settings.dataDirectory.label}</dd>
              <dt>Retained runs</dt>
              <dd>{displayNumber(settings.retention)}</dd>
            </dl>
          </section>

          <section aria-labelledby="settings-bounds-title">
            <h2 id="settings-bounds-title">Operational bounds</h2>
            <dl>
              {settings.bounds.map((bound) => (
                <div key={bound.id}>
                  <dt>{bound.label}</dt>
                  <dd>{displayNumber(bound)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </section>
  );
}
