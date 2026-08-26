---
source: README.md
source_sha256: 5b51e856d979b3fa38692937676a58b8fb3cdefd1fadf8511aa655804f49866f
translated_at: 2026-08-27
---

# AI Game Playbook

> 상태: control plane 계약, registry, core 안전 경계, managed-pack transaction, durable private receipt record와 소스 빌드 방식의 실험적 read-only command 세 개를 구현하고 있습니다. 설치 가능한 패키지, MCP 서버, 엔진 어댑터는 아직 없습니다.

[English](README.md)

AI Game Playbook은 Godot, Unity 또는 Unreal Engine을 사용하는 개인과 소규모 팀을 위한 AI 보조 게임 개발 control plane입니다. 코드 생성만이 아니라 범위가 제한된 workflow, 명시적 authority, 재현 가능한 evidence와 실제 엔진 동작을 중시합니다.

## 현재 존재하는 것

- versioned schema, semantic validation과 결정적 digest를 포함한 private pnpm/TypeScript workspace.
- command, skill, workflow, role lens, schema, pack descriptor를 검증하고 서로 일치하는 CLI, MCP, 문서, skill routing metadata를 생성하는 typed registry.
- canonical project identity, link-safe path resolution, bounded file read, staged compare-and-swap write/delete, bounded direct process execution, project mutation lease, scoped signed approval, workflow state, durable checkpoint와 append-only run receipt 안전 primitive.
- write-free preflight, exact ownership, add/update/remove transaction, append-only journal, active-transaction barrier, 명확한 실패 뒤 rollback, marker 결합 directory ownership, 별도 승인 recovery finalization을 제공하는 private managed-pack runtime.
- 실험적 private CLI package와 repository-local `agpb` entry point. 구현된 명령은 plan-only `agpb init`, read-only `agpb doctor`, static read-only `agpb project inspect`입니다.
- `init`, `doctor`, `project inspect`를 available로 표시하고 나머지 모든 명령과 엔진 capability를 planned로 유지하는 digest 결합 공개 surface.
- 영어 공개 문서와 한국어 mirror, Windows/Linux conformance check.

현재 CLI slice는 고정된 16개 `.ai-game-playbook/` target layout을 계획하고, 지원 Node.js 범위, runtime-registry parity, project state, installed-pack state, active transaction marker를 진단하며, bounded Godot/Unity/Unreal project marker와 canonical committed project profile을 검사합니다. Project inspection은 `.git` marker만 관찰하면 dirty state를 unknown으로 유지하고 static lock을 process나 선택 가능한 Editor session으로 간주하지 않습니다. 세 명령 모두 간결한 human output 또는 등록된 canonical JSON을 출력하며 write, process launch, network access, Editor control을 수행하지 않습니다.

대부분의 runtime component는 여전히 private library입니다. Pack mutation에는 exact same-process plan, broker가 발급한 `install` authorization, attest된 project-write lease가 필요합니다. Recovery finalizer는 bounded inspector가 이미 분류한 stable state만 닫을 수 있으며 pack artifact를 repair하거나 mixed state를 해결할 수 없습니다. Private receipt store는 canonical record를 compare-and-swap head 뒤에 영속화하고 complete project-local artifact locator를 다시 열어 검증하지만, artifact byte를 content-addressed storage로 복사하거나 retention, listing, export, migration-ready historical access를 제공하지는 않습니다. Approval reservation과 active lease는 memory-only이고 general mutation dispatcher나 approval UI는 없습니다.

## 현재 CLI 실행

배포된 package는 없습니다. pin된 Node.js와 pnpm을 사용하는 source checkout에서 다음을 실행합니다.

```text
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- init --project <project-path>
pnpm run agpb -- init --project <project-path> --json
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
pnpm run agpb -- project inspect --project <project-path>
pnpm run agpb -- project inspect --project <project-path> --json
```

`init`은 write-free layout plan에 path conflict가 없으면 exit code `0`, 선택한 root나 계획 target이 blocked이면 `3`을 반환합니다. `doctor`는 project state 미초기화 같은 attention-level warning을 포함해 blocking finding 없이 진단을 마치면 `0`, blocking finding이 있으면 `3`을 반환합니다. `project inspect`는 nonblocking unknown을 포함한 validated static report에 `0`, unavailable root, invalid/mismatched profile, ambiguous engine selection에 `3`을 반환합니다. 세 명령 모두 잘못된 CLI 사용은 `2`, validated report를 만들지 못한 내부 실패는 `1`입니다.

## 제품 방향

첫 완성 제품 목표는 개인 또는 최대 5인 팀이 만드는 Windows x64용 offline single-player 3D vertical slice입니다. 의도한 흐름은 다음과 같습니다.

1. Project를 inspect하고 사용 가능한 engine capability를 negotiate합니다.
2. 범위가 제한된 feature contract와 permission budget을 정의합니다.
3. Project-scoped execution lane 하나를 통해 source 또는 Editor state를 변경합니다.
4. Compile/import, test, play, deterministic input replay와 실제 runtime evidence capture를 수행합니다.
5. Build/export하고 receipt를 기록하며 필요할 때 안전하게 rollback합니다.

Godot, Unity, Unreal Engine만 first-party engine으로 계획합니다. Web game framework, multiplayer, mobile, console, XR, macOS 검증은 첫 alpha 범위 밖입니다.

## 설계 약속

- 하나의 typed registry가 노출된 모든 command를 정의합니다. CLI help와 dispatch는 같은 validated descriptor와 schema identity를 사용합니다.
- 지원하지 않는 capability는 명시적으로 degrade하며 낮은 evidence를 `verified`로 표시하지 않습니다.
- Editor mutation은 project별로 직렬화하고 identity 또는 dirty-file state가 모호하면 중단합니다.
- Installation, network, external transmission, paid call, destructive action, publish는 각각 별도 승인이 필요합니다.
- Telemetry는 계획하지 않습니다. Evidence는 explicit export action으로만 local project 밖으로 나갑니다.
- Engine, Editor, Blender와 다른 system tool은 탐지하되 자동 설치하지 않습니다.
- Uncertain mutation은 자동 재시도하지 않습니다.

## 설계 문서

- [문서 인덱스](docs/README.ko.md)
- [현재 상태와 범위](docs/status-and-scope.ko.md)
- [핵심 개념과 공개 타입](docs/concepts.ko.md)
- [명령줄 인터페이스 상태](docs/planned-cli.ko.md)
- [목표 아키텍처](docs/architecture.ko.md)
- [엔진 지원 모델](docs/engine-support.ko.md)
- [보안과 권한](docs/security-and-permissions.ko.md)
- [자산과 출처](docs/assets-and-provenance.ko.md)
- [증거와 검증](docs/evidence-and-verification.ko.md)
- [로드맵](docs/roadmap.ko.md)

## 설치와 릴리스

Repository-local executable은 설치 가능한 product package가 아닙니다. 이 프로젝트라고 기대하며 비슷한 이름의 package를 설치하지 마십시오. Non-owned file을 건드리지 않는 clean install, same-version reinstall, update, conflict, rollback, uninstall 검증을 통과한 뒤 package 설치 문서를 추가합니다.

## 프로젝트 상태와 라이선스

구현 중 interface가 바뀔 수 있습니다. 프로젝트 license를 아직 선택하지 않았으므로 license file이 추가되기 전에는 재배포 권리를 가정하지 마십시오. 해당 결정과 검증 gate를 통과하기 전에는 package publish나 release를 계획하지 않습니다.
