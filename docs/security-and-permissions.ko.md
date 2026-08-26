---
source: docs/security-and-permissions.md
source_sha256: bf54b11c04d1b89cae2af1e85a907d742bdba0b39ae425058147a7ca0dc83286
translated_at: 2026-08-26
---

# 보안과 권한

> 상태: 계획된 permission 정책입니다. 초기 filesystem/process/mutating-lane enforcement는 존재하지만 permission broker, Editor 또는 bridge enforcement는 아직 없습니다.

[English](security-and-permissions.md) · [문서](README.ko.md)

## 기본 권한 모델

| 행동 | 계획된 기본값 |
| --- | --- |
| Project file read와 state inspect | 선택한 project 안에서 허용 |
| 승인된 feature contract 안의 source 변경 | 선언한 path/change budget 안에서 허용 |
| Editor control | project와 Editor session별 한 번 승인 |
| 승인된 test와 build 실행 | 설정한 time/output/resource budget 안에서 허용 |
| Pack 또는 skill install/update | 매번 별도 승인 |
| Network 접근 | 매번 별도 승인 |
| Project data 외부 전송 | 매번 별도 승인 |
| 유료 provider 호출 | 매번 별도 승인 |
| 파괴 작업 | 매번 별도 승인 |
| Publish 또는 release | 매번 별도 승인 |

permission은 control plane이 평가하며 MCP annotation, skill, engine bridge, host UI에 위임하지 않습니다. approval은 project identity, command, scope, 필요한 경우 session, budget, expiration에 결합합니다.

## Fail-closed 중단 조건

다음 중 하나라도 발생하면 추가 mutation 전에 실행을 중단합니다.

- 가능한 project 또는 Editor instance가 둘 이상입니다.
- project, engine, process, session, scene/world, feature-contract identity가 바뀝니다.
- owned 또는 approved path 밖의 file을 변경하려 합니다.
- 예상하지 않은 dirty file이나 compare-and-swap mismatch가 나타납니다.
- path traversal, symlink escape, stale PID, invalid token, schema mismatch를 탐지합니다.
- time, output, changed-file, changed-byte, repair, resource, cost budget을 초과합니다.
- operation이 불확실한 mutation state로 끝납니다.
- required test가 없거나 incomplete, all-skipped, zero-test입니다.

불확실한 mutation은 자동 재시도하지 않습니다. workflow는 먼저 `uncertain` receipt를 기록하고 state reconciliation 또는 명시적 recovery를 요구합니다.

## Process와 Editor 격리

현재 private core는 local executable과 project root를 digest로 결합하고 argument array로 직접 spawn합니다. environment value와 project-scoped working directory를 제한하고 time, idle time, combined output 상한을 적용하며 중단 시 owned process tree만 종료합니다. Windows에서는 최소한의 비민감 OS 기준값만 유지하고 명시적으로 allowlist하지 않은 inherited user/path value를 가립니다. 중단된 실행은 mutation-uncertain으로 유지하며 reconcile 전에는 안전하게 retry할 수 없습니다. 이 경계는 CPU, memory, filesystem 또는 network sandbox가 아닙니다.

현재 private core는 초기화된 project마다 고정 local lease 하나를 사용해 `project-write`, `editor-bound`, `build-bound` 작업을 admission합니다. record는 root/project digest, run UUID, PID, 캡처한 runtime-start identity, runtime nonce, lane, 필요한 경우 Editor-session digest를 결합합니다. acquisition은 제한된 대기와 cancellation을 사용하며 갱신은 명시적으로 수행하고 compare-and-swap으로 보호합니다. 만료만으로는 takeover할 수 없습니다. live, reused 또는 확인할 수 없는 foreign PID는 계속 차단하고 dead owner record만 재획득 전에 atomic quarantine합니다. foreign live process start time은 아직 OS에서 독립적으로 attest하지 않으며 automatic heartbeat, parallel-reader coordination, 실제 Editor session 제어도 없습니다.

계획된 local bridge는 인증된 project-scoped session, 제한된 request body/queue, timeout, cancellation, normalized outer/inner error를 사용합니다. 기본으로 loopback에 bind하고 unauthenticated server를 노출하지 않습니다.

## Filesystem과 pack 안전

현재 core는 canonical project root를 결합하고 writable path link와 portable path ambiguity를 거부하며 제한된 staged SHA-256 compare-and-swap 쓰기를 수행합니다. managed pack lifecycle은 아직 계획 단계입니다. install/update는 content를 stage하고 digest/manifest를 검증하며 사용자 변경을 탐지한 뒤 owned path만 promote할 예정입니다. uninstall은 owned hash와 계속 일치하는 file만 제거할 예정입니다.

path 검사는 최종 target을 resolve하고 traversal, absolute-path injection, symlink escape를 거부합니다. engine과 system tool은 탐지하지만 자동 설치하지 않습니다.

## Network, provider, telemetry

telemetry는 계획하지 않습니다. 일반 evidence는 local에 남습니다. 외부 evidence export, network access, provider call은 destination, data category, retention expectation, model/provider identity, estimated cost를 포함해 따로 승인해야 하는 action입니다.

hosted provider는 기본 disabled입니다. 첫 버전은 optional image provider pack 최대 하나만 허용할 수 있습니다. install approval은 이후 transmission 또는 paid call을 허가하지 않습니다.

## Secret과 공개 산출물

secret과 local connection detail은 ignore된 machine-local configuration에 둡니다. raw value가 secret을 노출한다면 receipt에는 redacted command 정보와 hash를 저장합니다. 사용자가 명시적으로 선택하고 승인하지 않는 한 public document, export, diagnostic은 private absolute path, token, internal URL, raw local configuration을 제외해야 합니다.
