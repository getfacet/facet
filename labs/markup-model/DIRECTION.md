# Facet 새 버전 — 마크업 모델 방향 (Direction)

> 이 문서는 **새 세션이 이어받도록** 쓴 설계 방향서입니다. 공식 `/docs`가 아니라
> 실험 구역(`labs/`)에 둡니다. 확정 전 방향 정리이며, 결정은 문서 하단
> **"열린 결정 로그"** 에서 추적합니다.

## 역할 구분 (전제)
- **Facet** = "한 방문자의 한 화면을 안전하게 그리는 것"까지. 마크업 언어/컴포넌트
  레지스트리, 검증·fail-safe·패치·렌더러, 문서 내 상태, 저작 도구 + repair 계약.
- **LiveFrame**(상용 호스팅) = 그 밖 전부. 테넌시·인증·격리·메모리/세션·영속화·
  호스팅·전달·미터링·감사, 에이전트 두뇌/모델, 백엔드 도구.
- **스윗스팟** = 개인화 agent-native 서비스(대시보드/도구/예약/상담) — 사람마다 다른
  화면, 실시간 데이터, 아무도 미리 못 만드는 곳. 정적·범용 마케팅은 스코프 밖.

## 0. 왜 바꾸나 (v1 brick의 문제, 코드로 확인)
1. **컨텍스트 비용**: 에이전트가 brick이라는 커스텀 어휘/문법을 매번 학습.
   정적 프롬프트 ~5,400토큰(STAGE_SPEC 5.1KB가 핵심), 온디맨드까지 ~7,500–14,000토큰.
2. **어휘 확장 압력**: 표현력 하나 늘릴 때마다 brick/토큰/스타일 도메인을 손으로 추가.

## 1. 핵심 전환: 마크업 모델
**에이전트가 이미 아는 마크업(JSX/HTML 모양)으로 쓰고, 우리는 실행하지 않고 파싱해서,
각 태그를 이미 React로 만들어둔 신뢰된 컴포넌트에 매핑해 렌더한다.**
- "파싱하되 실행 안 함"의 대상 = **에이전트의 마크업(데이터)**. 실제 렌더 코드는
  **개발자가 미리 짠 React**(신뢰됨)라 실행돼도 안전.
- 문법이 이미 익숙 → **STAGE_SPEC 통째로 사라짐**(학습 비용 핵심 제거).
- **표현력은 컴포넌트(리치 React)가 담당** → 닫힌 어휘를 안 늘리고 컴포넌트만 추가하면
  표현력이 늘어남. (v1의 "어휘 무한 확장" 문제 해소.)

## 1b. 핵심 불변식 (마크업 모델 기준 재서술)
1. **에이전트는 파싱되는 선언형 마크업(데이터)만 낸다 — 실행 코드 없음.** 렌더는 등록된
   신뢰 컴포넌트 + prop 허용목록으로만. (옛 "닫힌 brick 어휘" → "신뢰 컴포넌트의 닫힌
   레지스트리 + 허용목록". 근거 이동: DIRECTION §12.)
2. **패치만 이동(RFC 6902), server=client 동일 `applyPatch`, fail-safe 렌더**(무효/매달린
   노드 스킵, 절대 안 깨짐). — 옛 Facet에서 100% 보존.

## 2. 용어 (확정)
- **컴포넌트** = 실체. **이미 React로 리치하게 만들어둔 UI 조각.** 에이전트가 놓는
  **모든 것**이 컴포넌트. (별도 "brick" 종류 없음 — brick 개념 폐기.)
- **태그** = 컴포넌트를 마크업에 쓰는 **문법**. **속성** = 컴포넌트에 주는 **입력**.
- **컴포넌트 3출처**:
  1. **Facet 제공** (기본 카탈로그)
  2. **사용자 정의** (직접 만들어 등록)
  3. **호스팅 서비스 정의** (LiveFrame 등이 등록)
  세 출처 모두 똑같이 마크업에서 태그로 쓰이고 에이전트가 배치. 출처만 다름.
- **디자인 시스템** = 토큰 + 테마 (값 언어). 컴포넌트는 포함 안 함(별도 층).
- **토큰** = 이름+값. **테마** = 토큰 값 배정 한 벌(스킨).

## 3. 아키텍처 — 앞단 + 렌더-어휘 층 교체, 프로토콜/런타임 재사용
```
[신규]  에이전트 → 마크업 작성(데이터) → ①파서 → ②레지스트리+prop 허용목록 검사
                                                        → ③태그→등록 컴포넌트 매핑
                                                             ↓ = 컴포넌트 트리(JSON)
[재사용] applyPatch(트리에) → 렌더러가 등록된 React 컴포넌트를 마운트 → 화면
```
- **①파서** = 구문만(마크업 텍스트 → AST 데이터 트리). 실행 안 함. *신규.*
- **②검사** = 의미. 등록된 컴포넌트인가 / 합법 prop·값인가 / JS 표현식·핸들러 코드
  거부. **안전 불변식이 사는 자리.** *code-document(branch: codex/code-document-
  experiment)의 AST 정책 재활용.*
- **③매핑** = 태그→등록 컴포넌트, 속성→prop. 결과 = 컴포넌트 트리 JSON. *신규.*
- **전송**: 기존 mutation 툴 5개(`render_page/insert_subtree/replace_subtree/
  update_node/remove_subtree`, branch `feat/agent-authoring-surface`에 존재)의 **인자로
  마크업 문자열**. (봉투=툴콜 1번, 편지=화면 전체 마크업. tambo처럼 컴포넌트마다
  툴콜하지 않음.)

## 4. 컴포넌트 (핵심)
- **컴포넌트 = 이미 React로 리치하게 짜인 신뢰 코드.** brick 같은 렌더 IR 없음 —
  이미 React라서.
- **3출처**(§2): Facet 제공 / 사용자 정의 / 호스팅 서비스 정의. 전부 **빌드 시점에
  신뢰된 개발자가 등록**. 에이전트는 런타임에 **고르고 배치만.**
- **디자인 권한**: 컴포넌트가 룩을 담고(개발자가 한 번, 토큰 참조), 에이전트는 배치·
  내용만. (옛 Facet: 에이전트가 매번 스타일링 → 폐기.)
- **컴포넌트 정의 2길**:
  1. **진짜 React** — 개발자(신뢰)가 작성. 리치함의 원천. (= tambo와 동일)
  2. **마크업 템플릿** — 기존 컴포넌트를 조합. 파싱만(새 코드 아님). 비개발자·안전 편의용.
- **안전** (brick의 닫힌 어휘가 하던 일을 셋이 대신):
  1. **레지스트리** — 등록된 컴포넌트만 렌더(모르는 태그는 안 그림).
  2. **prop 허용목록** — 합법 prop/값만 통과(에이전트가 코드·임의값 못 주입).
  3. **React error boundary** — 컴포넌트가 던져도 그 부분만 스킵(fail-safe).
  - 에이전트 입장 안전은 그대로(마크업=데이터만 냄). 렌더 코드는 신뢰된 dev React.
  - 안전 서사 변화: "닫힌 선언형 렌더 어휘" → **"신뢰된 컴포넌트의 닫힌 레지스트리".**
    누가 등록하나 = 빌드 시점 신뢰. 멀티테넌트 격리는 LiveFrame 몫.

## 5. 레이아웃
- 마크업 **중첩 + 컨테이너 컴포넌트**로 표현. 렌더는 flex/flow, **절대위치 금지**.
- 컨테이너 컴포넌트 = `Screen/Stack/Row/Grid/Overlay` (Facet 제공). 공유 prop
  (토큰-바운드): `gap, align, justify, padding, wrap` + Grid: `columns, minItemWidth`.
  `Overlay` = 모달·드로어(flow가 못 하는 겹침 레이어).
- 스크롤 바운드 영역·split·정렬은 새 컨테이너 아님 → `maxHeight/scroll/width/align/
  justify` **prop**으로.
- 에이전트 자유도 = 이 토큰-바운드 시맨틱 속성. 임의 값 불가.

## 6. 데이터 (기존 재사용)
- `data="sales.last7d"` 참조. 실데이터는 도구/DB가 채움, **LLM은 숫자 안 씀**.
  인라인 생성 문구만 직접. = 오늘의 `data` 창고 + `from` 바인딩.

## 7. 인터랙션/이벤트 모델 (결정 4, 기존 event-layer 재사용)
**저작 관례 하나: `action="kind:name"` (+ 선택 `arg`/`collect`). 런타임이 kind로 라우팅.**
- 개발자 = 트리거에 `action` 슬롯 노출 + `useFacetAction`. 라우팅은 Facet가 한 번.
  **내재 동작(정렬·탭·아코디언·타이핑)은 평범한 React — action 불필요.**
- 에이전트 = 원할 때 `action` 값만. 이벤트 종류 사전 설계 0.

세 kind:
- `agent:name` (+`collect`) — UI 이벤트 + 수집 데이터 → 에이전트 → **패치 회신**(핵심).
  실제 백엔드 효과는 에이전트가 **미리 만든 도구** 호출.
- `local:verb` — **노드 간** view-state 배선. 닫힌 verb = `open/close/toggle/select/filter`.
- `nav:target` — 화면 전환(미리 만든 화면 or 에이전트 생성).

세 티어의 나머지:
- **내재 상호작용** = 미리 만든 컴포넌트가 자체 처리(전송 ✗).
- **신호**(scroll/dwell) = 선택적 로그(맥락용, POST /record → Sink), 턴 아님.

전부 기존 event-layer(PR #13 trigger⊇event⊇forward + /record 로그) + view-state(PR #36)
재사용. 마크업은 저작 형식만 바꿈. (A2UI가 동일 모델 = 검증됨. 수집만 A2UI=자동/
Facet=명시 `collect`.)

## 7b. 카탈로그 발견(discovery) 계약 — A2UI 대비 우위
**선주입 금지.** A2UI는 카탈로그 전체를 시스템 프롬프트에 넣어 컴포넌트 수만큼 프롬프트가
선형 증가(= brick에서 도망친 컨텍스트 문제 재현). Facet은:
- 프롬프트엔 **경계 인덱스만** (컴포넌트 이름 + 한 줄 when-to-use).
- 에이전트가 **쓸 때만** `read_component_spec`(=`read_authoring_refs` 계승)으로 그
  컴포넌트 full 스키마를 읽음.
- → **카탈로그가 커도 프롬프트 안 커짐.** (`feat/agent-authoring-surface`의 지연 read
  메커니즘 유지.)
- 메타데이터는 A2UI에서 빌림: 컴포넌트/prop마다 **when-to-use + 제약**을 설명에 담아
  에이전트를 유도.

## 8. 디자인 시스템 (3층, 확정)
```
A. 프리미티브 토큰  raw 재료           blue-600=#2563eb, space-4=16px …
      ↑ 가리킴
B. 시맨틱 토큰      역할 이름          surface→gray-0, text-strong→gray-900 …
      ↑ 값 배정
C. 테마            B에 값 채운 한 벌   라이트/다크/브랜드
──────────────────────────────────────────────
D. 컴포넌트(디자인 시스템 밖)  B만 참조 → 테마 교체 시 자동 리스킨
```
- **이름 규격(A·B) = core 고정 계약** / **값(C 테마) = assets 기본 + 사용자 교체** /
  **컴포넌트(D) = Facet/사용자/호스팅 제공**.
- **컴포넌트는 색·크기 하드코딩 없이 시맨틱 토큰 "이름"만 참조**(Tailwind config = 값) →
  값은 테마가 대입, 컴포넌트 코드 불변.
- **저작 현실**: 컴포넌트 완성도를 보려면 값(테마)이 먼저 있어야 함. 순서 = 디자인
  시스템(값) 정의 or Facet 기본 포크 → 보면서 컴포넌트 제작 → 완성 후 테마 교체 자유.
- Facet 현재 자산: A→`packages/core/core/src/tokens.ts`,
  B→`packages/core/core/src/style-value-contract.ts`(예: color 역할),
  C→`DEFAULT_THEME`(@facet/assets)+`colorMode`.

## 9. Tailwind 역할
- ❌ **에이전트 언어 아님**(컴포넌트가 디자인하므로 불필요 + 임의값이 안전·일관성 깸).
- ✅ **개발자가 컴포넌트를 만드는 도구** + ✅ **테마 값의 표현 형식**(Tailwind config =
  토큰 값). 에이전트는 안 보고 안 씀.

## 10. 재사용 vs 신규
| 재사용(그대로) | 신규/교체 |
|---|---|
| RFC6902 패치 프로토콜(트리에 적용), 세션/이벤트 루프, StageStore/Sink, 데이터 창고+바인딩, 액션/뷰상태, mutation 툴 5개, 디자인 토큰/테마 구조 | 마크업 **파서**, **레지스트리 + prop 허용목록** 검증, 태그→컴포넌트 **매핑**, **렌더 층**(brick 스위치 → 등록 React 마운트, 오히려 단순), 파스실패→**repair 계약**, 기본 **컴포넌트 카탈로그** |

## 11. tambo 대비
- tambo 코어 = UI 컴포넌트 0개(네 React 등록). **brick/프리미티브/IR 개념 없음** →
  우리의 "brick 폐기, 컴포넌트=React" 방향과 동일한 안전 모델.
- tambo-ui(별도, shadcn식 복사) = **채팅 셸**(Message/Thread/Input) + 소수 생성 부품
  (Form/Graph/Map). **범용 중간 카탈로그도, 디자인 시스템도 없음.**
- **Facet 차별점**: ①공통 디자인 시스템(정합·리테마 강제) ②범용 중간 카탈로그
  ③에이전트가 **레이아웃 트리 조합**(tambo는 레이아웃=앱 소유, 에이전트 못 짬).
  (근거: docs.tambo.co, ui.tambo.co.)

## 12. 정직한 경계/리스크
- **마크업 모델의 저작 품질은 아직 미검증**(code-document 실행 루트는 측정됨, 스샷·
  결정론 digest 좋았음). 검증 전 확신 금지.
- **안전 서사가 이동**: "닫힌 선언 렌더 어휘" → "신뢰된 컴포넌트 레지스트리".
  "누가 컴포넌트를 등록하나"의 신뢰·리뷰가 새 관심사(빌드 시점, LiveFrame 관심사).
- **애플식 아트-디렉션(스크롤 연출/픽셀 오버랩)은 스코프 밖** — flex 파싱 루트 한계.
- 미해결: fail-safe UX 구체화, 폼(컴포넌트화), 컴포넌트 discovery(메뉴 규모 커질 때),
  멀티테넌트 스코핑(LiveFrame), 엣지/빈 상태, 스트리밍/cold-start(LiveFrame).

## 13. 검증 경로 (lab → 하드컷오버)
**labs/ 에서** code-document 하네스 재사용(시나리오/evaluator/스샷/결정론 digest) +
무거운 뒷단(컴파일러·샌드박스·broker·rollback) 제거 → **파싱+매핑+등록 컴포넌트 렌더**로
교체. 측정 질문: "마크업이 brick 대비 컨텍스트를 줄이나 + 컴포넌트 모델이 표현력
충분한가." **결과 괜찮으면 → main/core 하드컷오버.**

## 관련 브랜치/자산
- `codex/code-document-experiment` — `labs/code-document`: 실행 루트 + 평가 하네스
  (재사용 대상). AST 정책 존재.
- `feat/agent-authoring-surface` — mutation 툴 5개 + `read_authoring_refs`(지연 메뉴
  read). agent-tools를 `packages/core/agent-tools`로 이동.
- `apps/facet-v2` — 빈 뼈대(로컬). L3/마크업 모델과 호환 여부 재검증 필요.

## 참고 데모 (아티팩트, owner 소유)
- 마크업→화면(대시보드): 11d6b6c9-134e-4155-95e6-770400f1caae
- 랜딩 경계 테스트: 8e12e906-3452-4a16-ae95-c7045adb7a57
- 버튼 동작·페이지 이동: 9685cc2f-7faf-4764-9317-11cb95b1b4ed
  (claude.ai/code/artifact/<id>)

---

## 확정된 결정 상세

### 결정 1 — 토큰 규격 (✅ 확정)
토큰을 **3버킷으로 분리**:
1. **스케일 토큰**(직접 참조, 크기 이름) — mode/brand 안 탐.
   `space, fontSize, fontWeight, lineHeight, letterSpacing, radius, borderWidth`(+
   필요시 `motion/duration`, `zBand`).
2. **시맨틱 색·톤 역할**(테마가 값 채움) — 리테마 핵심. 색 역할(표면 `bg/surface/
   raised/overlay/inset`, 글자 `text/text-muted/text-strong/text-inverse/text-link`,
   경계 `border/border-strong`, 강조 `primary/on-primary/accent`, 상태 `info/success/
   warn/danger` +변형) + `shadow/gradient/scrim/highlight`.
3. **구조 고정선택 = 토큰 아님 → 컴포넌트 prop으로**
   `direction, alignment, justification, columns, collapse, width, scroll, textAlign,
   textWrap, lineClamp, objectFit, objectPosition, aspectRatio, enterAnimation…`
- **색 계약 = 시맨틱 역할만(1층).** 프리미티브 색 ramp는 core 계약 아님 — 테마 저자가
  자기 테마 내부에서 선택.

### 결정 2 — 컨테이너 컴포넌트 세트 (✅ 확정)
**Facet 제공 컨테이너 컴포넌트 4개**: `Screen` / `Stack` / `Row` / `Grid`.
- `Screen`=화면 루트(뷰포트 바운드) · `Stack`=세로 flex · `Row`=가로 flex · `Grid`=격자.
- 공유 prop(토큰-바운드): `gap, align, justify, padding, wrap`. Grid: `columns,
  minItemWidth`. 방향이 태그 이름에 박혀 `direction=` 불필요.

### 결정 3 — 기본 컴포넌트 카탈로그 (✅ 확정)
- **"고도" 개념 폐기.** 컴포넌트는 정의하기 나름 낮거나 높음(assets 컴포넌트도 자유).
  Facet의 일 = **"컴포넌트를 잘 정의하고 에이전트가 안전하게 조합·사용하게" 하는 것**,
  높낮이 규칙이 아님. assets 기본 카탈로그는 실용적 선택일 뿐.
- **선택 기준**: 컴포넌트는 **"구분되는 시각적/기능적 실체"** 여야 함 — 그냥 데이터
  모양이면 안 됨. (그래서 `KeyValue`는 "카드 안 행 나열 = 데이터 모양"이라 제외.)
- **컨테이너 5** (§5): `Screen/Stack/Row/Grid/Overlay`.
- **콘텐츠 최소** (모델 증명용, 검증 후 확장): `Text, Card, Table, Metric, Button,
  Badge` (+ `Empty` 경계 유지).
- **시나리오 따라 추가**: `Chart`(추세), `List`(데이터 바인딩 반복=기능적 실체),
  `Field`(입력, 폼 숙제 연동), `Image`, `Loading`.
- brick과 겹치는 건 우연(Table/Chart는 원래 필요). brick의 `progress/richtext/box`
  등은 기능 도출에서 자동으로 안 들어옴 — 필요할 때 추가.

### 결정 4 — 인터랙션/이벤트 모델 (✅ 확정)
상세 = §7 / §7b. 요지:
- **저작 관례 하나**: `action="kind:name"` (+`arg`/`collect`). 런타임이 kind로 라우팅.
- kind 3: `agent:`(이벤트+수집→에이전트→패치) / `local:`(노드 간 view-state 배선, 닫힌
  verb `open/close/toggle/select/filter`) / `nav:`(화면 전환).
- **내재 동작(정렬·탭·타이핑)은 컴포넌트가 소유 → action 불필요.** 신호(scroll/dwell)는
  선택 로그.
- 개발자=슬롯+`useFacetAction`, 에이전트=값만. 기존 event-layer+view-state 재사용.
- **발견 계약(§7b)**: 카탈로그 선주입 금지 — 경계 인덱스 + 지연 `read_component_spec`.

### 결정 5 — 파서 / 허용목록 / repair 계약 (✅ 확정)
- **5-1 컴포넌트 정의**: **진짜 React 우선**(신뢰 dev, 리치) + **마크업 템플릿 보조**(기존
  컴포넌트 조합, 파싱만, 비개발자·안전 편의). 둘 다 레지스트리 등록→태그.
- **5-2 파서(구문만)**: JSX 모양. 속성 값 = **문자열만**(토큰/데이터ref `data="x.y"`/
  액션 `action="kind:name"`/리터럴). 출력=컴포넌트 트리. **거부: JS 표현식 `{...}`,
  핸들러 코드, `<script>`, 스프레드, import, 미등록 태그.** (데이터 바인딩은 표현식 아닌
  **속성 문자열만**.)
- **5-3 허용목록(의미)**: ①태그∈레지스트리 ②prop∈스키마 ③값∈허용도메인(그 prop의
  **enum**(컴포넌트별) 또는 **토큰 도메인**(공유)) ④코드/표현식 없음 ⑤구조 규칙
  (Screen=루트 등). 허용도메인은 컴포넌트 스키마에 담겨 §7b 지연 read로 옴.
- **5-4 위반 처리(양면)**: 방문자 = **fail-safe**(이전 트리 유지, 무효 노드만 스킵, 절대
  안 깨짐) / 에이전트 = **구조화 거절**(무엇을·어디서·어떻게 고칠지 → self-repair,
  기존 `docs/AGENT-TOOL-RESULT-CONTRACT.md` 재사용).

### 결정 6 — v2 처리 + invariant 재검증 (✅ 확정)
- **facet-v2 미사용**: 이 저장소에 facet-v2 없음(어느 브랜치·워크트리·히스토리에도).
  계획 = **labs/markup-model(실험·측정) → 기존 main/core 하드컷오버.** 별도 v2 앱 안 만듦.
  (외부에 v2 invariant 문서가 있으면 이 DIRECTION과 대조해 유효한 것만 흡수 — 비차단.)
- **invariant 재검증**: §1b로 재서술. ②(패치/fail-safe) 완전 보존, ①(선언형/무코드)은
  정신 유지·메커니즘을 "레지스트리+허용목록"으로 변경.

## 열린 결정 로그 (1~6, 순서대로 확정)
| # | 결정 | 상태 |
|---|---|---|
| 1 | 토큰 규격 (스케일/시맨틱/구조 3버킷, 색=시맨틱만) | ✅ 확정 |
| 2 | 컨테이너 컴포넌트 세트 (Screen/Stack/Row/Grid, +Overlay는 결정3) | ✅ 확정 |
| 3 | 기본 컴포넌트 카탈로그 (고도 폐기, 컨테이너5 + 콘텐츠 최소, "구분되는 실체" 기준) | ✅ 확정 |
| 4 | 인터랙션/이벤트 모델 (`action="kind:name"`, 3 kind, 내재=컴포넌트, 발견=지연) | ✅ 확정 |
| 5 | 파서/허용목록/repair 계약 + 컴포넌트 정의(React 우선+템플릿) | ✅ 확정 |
| 6 | v2 처리 (facet-v2 미사용, lab→main/core, 불변식 §1b 재서술) | ✅ 확정 |

**결정 1~6 전부 확정.** 다음 단계 = **측정 하네스 설계**(§13): labs/에서 code-document
하네스 재사용 + 파싱→매핑→등록 컴포넌트 렌더로 교체, brick 대비 컨텍스트·저작 품질 비교.
후속 세부(미해결): fail-safe UX, 폼 계약, 카탈로그 발견 인덱스 포맷, 스트리밍/cold-start.
