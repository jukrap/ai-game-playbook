---
source: docs/engine-support.md
source_sha256: fea7c1b77c5f60162f9e23195d26980fe478436b7b6b4c7ea8e4e4bc52bca3d7
translated_at: 2026-08-27
---

# 엔진 지원 모델

> 상태: 모든 엔진 지원은 `planned`입니다. 이 제품으로 검증한 엔진은 없습니다.

[English](engine-support.md) · [문서](README.ko.md)

## 공통 엔진 계약

각 first-party adapter는 엔진이 허용하는 범위에서 같은 생명주기를 제공할 계획입니다.

`detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`

모든 operation은 offline, headless, editor-bound, runtime-bound, build-bound 여부를 선언합니다. 지원하지 않는 operation은 명시적 degrade reason을 반환합니다. adapter는 실제 gameplay input을 teleport로, runtime capture를 Editor viewport로, complete test result를 process success로 대체할 수 없습니다.

## 현재 지원 matrix

| Capability 묶음 | Godot | Unity | Unreal Engine |
| --- | --- | --- | --- |
| Project 탐지 | `planned` | `planned` | `planned` |
| Static/headless 검증 | `planned` | `planned` | `planned` |
| Editor 연결과 mutation | `planned` | `planned` | `planned` |
| 결정적 runtime input과 state | `planned` | `planned` | `planned` |
| 실제 runtime capture | `planned` | `planned` | `planned` |
| Windows x64 build/export startup | `planned` | `planned` | `planned` |

등급은 environment와 capability별로 평가합니다. 설치된 Editor 탐지만으로 adapter 지원을 확립하지 않습니다.

Source-built `agpb engine status --engine godot` command는 support grade가 아니라 control-plane observation입니다. Static Godot project candidate 하나를 검증하고 major/minor hint를 pin된 `4.7.2` target과 비교합니다. Executable path를 받지 않고 host-tool discovery/version probe나 process start를 수행하지 않으며 matrix의 모든 cell을 `planned`로 유지합니다.

Internal-only 후속 흐름은 discovery와 execution을 분리합니다. Project-only 준비는 host candidate를 읽지 않고 bounded explicit source count와 source digest를 bind합니다. Discovery가 exact configured file 또는 선택한 PATH directory의 고정 direct name을 읽기 전에 signed single-use `host-tool-inspection` grant가 필요합니다. Discovery는 nonrecursive이고 process를 시작하지 않으며 source path나 execution authority를 반환하지 않고 원본 same-process report 뒤에만 candidate를 보존합니다. Version 준비는 선택한 retained candidate 하나만 받고 bounded runner가 `--version`만 호출하기 전에 content/filesystem-identity digest에 결합된 두 번째 signed grant를 요구합니다. Probe는 dispatch 전 drift를 거부하고 실행 뒤 identity를 다시 확인하며 authorization을 정산하고 raw path/output 없이 normalized process와 output digest를 출력합니다. 세 번째 workflow-bound admission은 그 원본 completed report만 받고 고정 headless startup argument를 bind하며 exact project root에 대한 core-produced containment assessment를 얻습니다. 원본 same-process witness를 보존하고 assessment/provider-catalog digest를 approval, report, receipt evidence에 bind합니다. 현재 provider catalog가 비어 있어 유효한 decision은 `block`뿐이며 project process를 시작하지 않습니다. 이는 fail-closed admission이지 구현된 sandbox가 아닙니다. 이 component들에는 automated local witness가 있지만 실제 Godot binary의 retained execution이 없고 CLI/MCP에 노출되지 않으므로 matrix를 변경하지 않습니다.

## Godot 방향

Godot에는 첫 static adapter 경계와 assessment 결합 fail-closed preflight admission이 생겼고 첫 live adapter 계획 대상인 점은 그대로입니다. Static scene inspect, typed containment refusal, blocked admission은 contained engine-backed preflight 및 runtime play와 분리합니다. 첫 alpha에는 script/batch validation, exact project/Editor identity, 실제 input mapping을 통한 결정적 input, gameplay state assertion, 실제 runtime frame, log, Windows export startup이 필요합니다.

project bridge는 인증하고 fail closed해야 하며 Windows를 지원하고 schema parity를 보존해야 합니다. 또한 Editor mutation 직렬화, request/output 제한, lock 복구, 실제 runtime frame/input 동작을 증명해야 합니다. 모든 hard gate를 만족하는 후보가 없으면 최소 GDScript bridge를 만듭니다.

## Unity 방향

Unity 자동화는 공식 command-line과 MCP 경로를 우선하고 검증된 fallback만 고려할 계획입니다. adapter는 exact project, package state, Editor version, process, session을 결합하고 `UnityLockfile`을 존중하며 domain reload를 일관되게 복구해야 합니다.

test success에는 완료된 Test Runner XML report와 0보다 큰 test count가 필요합니다. EditMode와 PlayMode evidence는 분리합니다. Scene View, 실제 Game View, Development Build frame은 서로 다른 등급입니다. Unity가 `verified`에 도달하려면 Windows x64 Development Build startup이 필요합니다.

## Unreal 방향

Unreal 자동화는 공식 MCP, Editor Python, Automation Framework, UAT, UBT를 중심으로 계획합니다. Editor-bound operation은 exact project, engine build, process, socket, session, world, transaction identity를 갖는 직렬 lane을 사용합니다.

Automation report는 완전하고 0건이 아니어야 합니다. Editor viewport, PIE gameplay, packaged startup은 별도 evidence class입니다. actor/asset mutation에는 lookup, scoped transaction, compare-and-swap state, save/reload/requery, bounded rollback이 필요합니다. active worktree switching, 전체 Unreal process 종료, 복구할 수 없는 delete는 지원하지 않습니다.

## 검증 기준

엔진은 공통 graybox scenario가 실제 gameplay에서 통과하고 target Windows player가 성공적으로 시작한 뒤에만 `verified`가 됩니다. receipt에는 engine/version, renderer, scene/world, camera, seed, input trace, state assertion, log, test, capture hash, build artifact hash, recovery outcome이 포함되어야 합니다. environment 또는 budget 정보가 없으면 performance는 `unverified`입니다.
