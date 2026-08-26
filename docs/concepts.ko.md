---
source: docs/concepts.md
source_sha256: 0851c31209395f5fcd6503a7f68f131c76d103e77482633b4ace2863dbcb7202
translated_at: 2026-08-27
---

# 핵심 개념과 공개 타입

> 상태: versioned schema, semantic validator, 결정적 workflow-plan 해석, 초기 private permission, workflow-state, checkpoint, receipt consumer를 구현했습니다. 대부분의 실행 가능한 제품 surface와 engine capability는 아직 계획 단계입니다.

[English](concepts.md) · [문서](README.ko.md)

## 운영 모델

AI Game Playbook은 계약 중심 control plane으로 계획하고 있습니다. 실행은 프로젝트와 사용 가능한 capability를 식별하는 것부터 시작하며, 승인된 feature, budget, engine instance, execution lane에 작업을 결합합니다. 중요한 모든 행동은 증거를 만들고, 증거는 process exit status와 별도로 평가합니다.

공통 생명주기는 다음과 같습니다.

`detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`

adapter는 지원하지 않는 단계를 보고할 수 있습니다. 필수 단계를 조용히 건너뛰거나 더 약한 증거로 대체할 수 없습니다.

## 공개 계약 타입

현재 기반은 이 계약을 versioned JSON schema와 TypeScript 정의 및 fail-closed semantic check로 구현합니다. registry는 검증된 descriptor에서 하나의 immutable workflow plan을 파생할 수 있지만 이것만으로 CLI command, workflow, engine operation을 실행할 수 있는 것은 아닙니다.

| 타입 | 책임 |
| --- | --- |
| `CommandDescriptor` | 한 operation의 input/output schema, required capability, permission, side effect, lane, timeout, retry, budget, required evidence |
| `PackManifest` | pack version, 호환 engine, 제공 skill/command, dependency, digest, owned path, install/update/remove lifecycle |
| `GameProjectProfile` | engine, version, project identity, development stage, target platform, 선언한 quality/change budget |
| `EngineCapabilityReport` | 현재 환경에서 탐지한 operation, limitation, identity, support grade |
| `FeatureContract` | 플레이어가 볼 결과, 허용 변경 범위, 완료 조건, 위험, budget, rollback plan |
| `ApprovalGrant` | exact project, command, request, scope, budget, expiration, 필요한 경우 feature/workflow/Editor session identity에 결합된 단일 signed permission |
| `ResolvedWorkflowPlan` | 실행 전 exact registry, workflow, stage, command와 handler authority, lane, permission, budget, transition, evidence duty에 결합된 하나의 유한 DAG |
| `WorkflowCheckpointRecord` | immutable sequence, exact resolved-plan 및 project authority, in-flight authorization, attempt, 누적 budget, evidence, receipt-chain head, TTL, parent digest |
| `RunReceipt` | run, feature, plan, command descriptor, handler, input, authorization identity와 timing, outer/inner result, artifact, changed file, recovery result |
| `AssetProvenance` | asset source와 lineage, 권리, transform, 필요 시 provider/model/checkpoint/seed, cost/approval, file hash, QA state |

schema identifier와 command identifier는 안정적인 machine name입니다. 사람이 읽는 help와 translation은 대체 command identity를 만들지 않습니다.

## 프로젝트와 feature identity

`GameProjectProfile`은 실행 identity의 루트입니다. process name이나 port가 그럴듯하다는 이유만으로 command가 Editor 또는 project에 붙는 것을 막습니다. `FeatureContract`는 그 project 안에서 허가된 결과와 변경 표면을 좁힙니다.

mutation 전, Editor reload/restart 후, evidence 승격 전에 identity를 검사합니다. project root, engine build, process, session, scene/world가 바뀌거나 예상하지 않은 dirty file이 있으면 실행을 중단합니다.

## Skill, role, workflow

- **skill**은 trigger, exclusion, required capability, verification criteria를 갖고 점진적으로 불러오는 작업 방법입니다. 권한을 부여할 수 없습니다.
- **role lens**는 판단 질문과 evidence 책임을 가진 검토 관점이며 가상 직원이나 독립 executor가 아닙니다.
- **workflow**는 checkpoint, budget, stop condition을 갖춘 등록 command의 제한된 순서입니다. 실행 전에 descriptor를 결정적인 위상 순서와 exact implementation authority를 가진 domain-separated plan으로 해석합니다.

기본 계획은 작업마다 skill 1~5개와 role lens 최대 3개를 선택합니다. 하나의 executor가 mutation을 소유하고 병렬 작업은 안전한 read와 독립 분석으로 제한합니다. private state machine은 이제 resolved plan을 소비하고 authorization과 dispatch 경계를 분리하며 exact permission settlement와 receipt를 검증하고 선언된 failure/rollback transition을 진행하며 uncertainty나 누적 budget 초과를 차단합니다. append-only checkpoint store는 제한된 parent chain을 검증하고 stale authorization을 복원하지 않는 restart hydration을 지원합니다. dispatch하지 않은 admission은 재승인이 필요하고 dispatch 후 정산하지 못한 step은 reconciliation이 필요합니다. 별도 private store는 canonical receipt body를 compare-and-swap head 뒤에 영속화하고 complete artifact snapshot을 producer-bound manifest가 있는 immutable SHA-256 object로 승격합니다. command dispatch, durable approval, artifact format QA, retention/export, uncertainty 해제, engine 실행은 아직 구현하지 않았습니다.

## 실행 결과

process exit, command result, test, gameplay assertion, capture quality, performance, build result는 별도 outcome입니다. 따라서 실행은 더 구체적인 component result를 잃지 않고 `succeeded`, `failed`, `blocked`, `cancelled`, `uncertain` 같은 상태로 끝날 수 있습니다.

불확실한 mutation은 자동으로 재시도하지 않습니다. 복구 전에 pre-change receipt와 project/engine state를 대조해야 합니다.

## 지원 등급

| 등급 | 의미 |
| --- | --- |
| `planned` | 계약은 있지만 runtime capability를 확립하지 않음 |
| `detected` | 호환 project와 tool identity를 찾음 |
| `headless` | 필수 non-editor 검사가 성공함 |
| `editor-preview` | Editor-bound behavior와 preview evidence가 성공함 |
| `verified` | 필수 실제 gameplay와 target build/export scenario가 완전한 receipt와 함께 통과함 |

지원 등급은 엔진 이름 전체가 아니라 capability와 environment별로 적용합니다. screenshot, 생성된 file, 성공한 process만으로는 `verified` 지원을 확립할 수 없습니다.
