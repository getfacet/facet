/**
 * `@facet/assets/react` — the trusted React implementations of the default
 * service-surface components, as one registry.
 *
 * One symbol, and it is the whole surface. The six modules behind it are
 * private: `react/style.ts` holds the shared token and prop readers, and the
 * five `react/*.tsx` groups hold the implementations themselves. None of them
 * is a package entry point, and this barrel names every symbol it publishes
 * explicitly rather than re-exporting a module wholesale, so what this subpath
 * ships is decided here and cannot widen by accident (D-12: no `export *`,
 * anywhere).
 *
 * This is the **browser half** of the package, and the split from the root
 * entry is deliberate. `@facet/assets` itself is plain Node-safe data — a theme
 * and component specs — so a server that only needs the catalog never pulls a
 * renderer in behind it; React appears in this file's graph and nowhere else,
 * which is why `react` is an *optional* peer dependency. The edge also runs one
 * way: these implementations are written against `ComponentMountProps` and
 * `MountedComponent` from `@facet/core`, never against `@facet/react`. Were the
 * mount contract declared in the renderer, assets would depend on it to be
 * written and it would depend on assets to have something to mount — a cycle
 * (D-09). `react.test.tsx` walks the module graph from this file and pins both
 * halves of that boundary.
 *
 * The registry is the second half of Facet's trust boundary; the catalog is the
 * first. Bootstrap demands the two carry the **same tag set exactly**, so a tag
 * added to `DEFAULT_COMPONENT_SPECS` without a trusted implementation here — or
 * an implementation here without a spec — fails at the boundary rather than at
 * first render. That equality is the obligation of these two modules together,
 * and it is pinned as a set: which order the catalog lists its members in is not
 * part of the contract.
 */

import type { MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import {
  Avatar,
  Badge,
  Chart,
  Icon,
  Image,
  List,
  Metric,
  MetricGroup,
  Progress,
  Table,
  Text,
  Timeline,
} from "./react/content.js";
import { ActionBar, ActionGroup, Button, Navigation, NavigationItem } from "./react/expression.js";
import {
  Accordion,
  AccordionItem,
  ChoiceGroup,
  Field,
  Form,
  MessageThread,
  Select,
  Toggle,
} from "./react/interactive.js";
import {
  AppShell,
  Card,
  Divider,
  Grid,
  Modal,
  Row,
  Screen,
  Section,
  Split,
  Stack,
} from "./react/layout.js";
import {
  Alert,
  Board,
  BoardColumn,
  Calendar,
  Collection,
  Detail,
  Empty,
  Header,
  ItemCard,
  Property,
  PropertyList,
  Result,
} from "./react/surface.js";

/**
 * The default registry: every tag in `DEFAULT_CATALOG` mapped to the trusted
 * React component that renders it.
 *
 * Grouped in the catalog's structure, navigation, content, task-surface, and
 * input/disclosure order. The explicit roster is intentional: retired private
 * exports cannot enter the public trust boundary by accident.
 *
 * Each value is an ordinary React component that already satisfies
 * `MountedComponent<ReactNode, ReactNode>` as written, so nothing is wrapped or
 * cast on the way in: what the host registers is exactly the component the group
 * module declared, and a mismatch is a type error here rather than a surprise at
 * mount time.
 *
 * Frozen, because a host hands this object to bootstrap to build its half of the
 * trust boundary: a registry a consumer could add a key to would let the two
 * halves drift apart *after* the tag-set check that compared them.
 */
export const DEFAULT_REGISTRY: Readonly<Record<string, MountedComponent<ReactNode, ReactNode>>> =
  Object.freeze({
    Screen,
    Stack,
    Row,
    Grid,
    Split,
    AppShell,
    Section,
    Card,
    Modal,
    Divider,
    Navigation,
    NavigationItem,
    Button,
    ActionGroup,
    ActionBar,
    Text,
    Avatar,
    Icon,
    Image,
    Badge,
    Metric,
    MetricGroup,
    Table,
    Chart,
    Progress,
    Timeline,
    List,
    Header,
    Collection,
    ItemCard,
    Detail,
    PropertyList,
    Property,
    Board,
    BoardColumn,
    Calendar,
    Result,
    Empty,
    Alert,
    Form,
    Field,
    Select,
    ChoiceGroup,
    Toggle,
    MessageThread,
    Accordion,
    AccordionItem,
  });
