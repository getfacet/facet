> **Superseded** by markup-component-greenfield-hard-cut.

이 문서는 초기 실험 방향을 남긴 기록이며 현재 구현 권한이 아닙니다. 현재 권한은
저장소 루트의 contributor contract와 `docs/ARCHITECTURE.md`,
`docs/PACKAGE-BOUNDARIES.md`, `docs/AGENT-TOOL-RESULT-CONTRACT.md`입니다.

## Superseded decisions

아래 초기 아이디어는 shipped contract가 아닙니다.

- `Overlay` as a general authored overlap primitive
- `local:` browser action routing
- markup-template components as an authoring surface
- catalog-in-AssetsStore as the catalog source of truth
- Lab-first evidence as the public hard gate

The current contract is the component-markup model:

1. Agents emit declarative markup data only.
2. The host-owned catalog and trusted React registry are matched exactly before
   a session renders.
3. Component props are declared and validated by catalog metadata.
4. Only `data:`, `nav:`, and `agent:` references are admitted by the grammar.
5. Runtime and browser apply the same authorized RFC 6902 patch fold.
6. Domain work stays with host/agent tools; Facet owns UI-out and UI-in only.
7. Overlap is available only through the dedicated trusted Modal contract.

Keep this file as historical context only. Do not cite it to preserve retired
surface area, compatibility adapters, aliases, or old evidence paths.
