---
source: docs/security-and-permissions.md
source_sha256: 1067cebfe3d6d8addef214dabe3dc75342d46805a798784c2bed7b10185a826f
translated_at: 2026-08-26
---

# 보안과 권한

> 상태: 계획된 정책입니다. permission broker나 runtime enforcement는 아직 없습니다.

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

각 project에는 mutation lane이 하나 있고 Editor-bound work는 그 안에서 직렬화합니다. process identity는 PID 이상이며 executable/build identity, project root, start time, session token, engine-specific context를 포함합니다. command는 결합된 process만 대상으로 하며 광범위한 process 종료를 금지합니다.

local bridge는 인증된 project-scoped session, 제한된 request body/queue, timeout, cancellation, normalized outer/inner error를 사용합니다. 기본으로 loopback에 bind하고 unauthenticated server를 노출하지 않습니다.

## Filesystem과 pack 안전

managed file은 hash-owned입니다. install/update operation은 content를 stage하고 digest/manifest를 검증하며 path/symlink를 검사하고 사용자 변경을 탐지한 뒤 가능하면 원자적으로 promote합니다. uninstall은 여전히 owned hash와 일치하는 file만 제거합니다. non-owned 또는 modified file은 보존하고 conflict로 보고합니다.

path 검사는 최종 target을 resolve하고 traversal, absolute-path injection, symlink escape를 거부합니다. engine과 system tool은 탐지하지만 자동 설치하지 않습니다.

## Network, provider, telemetry

telemetry는 계획하지 않습니다. 일반 evidence는 local에 남습니다. 외부 evidence export, network access, provider call은 destination, data category, retention expectation, model/provider identity, estimated cost를 포함해 따로 승인해야 하는 action입니다.

hosted provider는 기본 disabled입니다. 첫 버전은 optional image provider pack 최대 하나만 허용할 수 있습니다. install approval은 이후 transmission 또는 paid call을 허가하지 않습니다.

## Secret과 공개 산출물

secret과 local connection detail은 ignore된 machine-local configuration에 둡니다. raw value가 secret을 노출한다면 receipt에는 redacted command 정보와 hash를 저장합니다. 사용자가 명시적으로 선택하고 승인하지 않는 한 public document, export, diagnostic은 private absolute path, token, internal URL, raw local configuration을 제외해야 합니다.
