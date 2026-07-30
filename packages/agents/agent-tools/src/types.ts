import type { ComponentSpec } from "@facet/core";
export type { FacetToolSession } from "@facet/core";

export interface RenderPageInput {
  readonly markup: string;
}

export interface InsertSubtreeInput {
  readonly targetId: string;
  readonly markup: string;
}

export interface ReplaceSubtreeInput {
  readonly targetId: string;
  readonly markup: string;
}

export interface UpdateNodeInput {
  readonly targetId: string;
  readonly markup: string;
}

export interface RemoveSubtreeInput {
  readonly targetId: string;
}

export interface ReadComponentSpecInput {
  readonly tag: string;
}

export interface ReadScreenInput {
  readonly screen: string;
}

export interface ReadDataInput {
  readonly path: string;
}

export interface PublishDataInput {
  readonly path: string;
  readonly value: unknown;
}

export interface CatalogIndexEntry {
  readonly tag: string;
  readonly whenToUse: string;
}

export type CatalogIndex = readonly CatalogIndexEntry[];

export interface CurrentScreenObservation {
  readonly name: string;
  readonly markup: string;
  readonly issues: readonly string[];
}

export interface DataSummaryEntry {
  readonly path: string;
  readonly shape: "null" | "string" | "number" | "boolean" | "array" | "object";
  readonly fields: readonly string[];
  readonly count: number;
}

export interface TurnObservation {
  readonly stageRevision: number;
  readonly currentScreen: CurrentScreenObservation | null;
  readonly screens: readonly string[];
  readonly components: CatalogIndex;
  readonly data: readonly DataSummaryEntry[];
  readonly issues: readonly string[];
}

export type ComponentSpecWithIndex = ComponentSpec;
