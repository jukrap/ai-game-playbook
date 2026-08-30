extends RefCounted

const OUTPUT_PREFIX := "AGPB_GRAYBOX "
const SCENARIO_DIGEST := "sha256:4bce945905093f746939b6b8f1c6183d0795f2f74b533763970aeed5be4e6c0f"

var _game
var _scenario: Dictionary
var _inputs: Array
var _checkpoints: Array
var _terminal: Array
var _next_input := 0
var _passed: Dictionary = {}
var _finished := false
var _event_sink := Callable()
var _passed_handler := Callable()


func _init(
	game,
	scenario: Dictionary,
	event_sink: Callable = Callable(),
	passed_handler: Callable = Callable()
) -> void:
	_game = game
	_scenario = scenario
	_event_sink = event_sink
	_passed_handler = passed_handler
	_inputs = scenario.get("inputs", [])
	_checkpoints = scenario.get("checkpoints", [])
	_terminal = scenario.get("terminal", [])
	_emit("replay-started", {
		"scenarioId": scenario.get("scenarioId", ""),
		"scenarioDigest": SCENARIO_DIGEST,
		"seed": scenario.get("initialState", {}).get("seed", ""),
	})


func before_tick(tick: int) -> void:
	if _finished:
		return
	while _next_input < _inputs.size():
		var event: Dictionary = _inputs[_next_input]
		var event_tick := int(event.get("tick", -1))
		if event_tick > tick:
			break
		if event_tick < tick:
			_fail("input-missed", tick, {"sequence": event.get("sequence", -1)})
			return
		_game.apply_replay_event(
			String(event.get("action", "")),
			String(event.get("phase", "")),
			event.get("value")
		)
		_next_input += 1


func after_tick(tick: int) -> void:
	if _finished:
		return
	_evaluate_oracles(_checkpoints, tick, false)
	if _finished:
		return
	_evaluate_oracles(_terminal, tick, true)
	if _finished:
		return
	if _terminal_complete():
		if _all_checkpoints_complete():
			_emit("replay-passed", {
				"tick": tick,
				"scenarioDigest": SCENARIO_DIGEST,
			})
			_finished = true
			if _passed_handler.is_valid():
				_passed_handler.call(tick)
			else:
				_game.finish_replay(0)
		else:
			_fail("checkpoint-incomplete", tick, {})
		return
	var maximum_ticks := int(_scenario.get("clock", {}).get("maximumTicks", 0))
	if tick >= maximum_ticks:
		_fail("maximum-ticks-reached", tick, {})


func _evaluate_oracles(oracles: Array, tick: int, terminal: bool) -> void:
	for oracle_value in oracles:
		var oracle: Dictionary = oracle_value
		var oracle_id := String(oracle.get("oracleId", ""))
		if bool(_passed.get(oracle_id, false)):
			continue
		if oracle.has("atTick"):
			var at_tick := int(oracle.get("atTick", -1))
			if tick == at_tick:
				if _oracle_passes(oracle):
					_pass_oracle(oracle, tick, terminal)
				else:
					_fail("oracle-failed", tick, {"oracleId": oracle_id})
					return
			continue
		var window: Dictionary = oracle.get("withinTicks", {})
		var first_tick := int(window.get("firstTick", -1))
		var last_tick := int(window.get("lastTick", -1))
		if tick < first_tick:
			continue
		if _oracle_passes(oracle):
			_pass_oracle(oracle, tick, terminal)
		elif tick >= last_tick:
			_fail("oracle-window-expired", tick, {"oracleId": oracle_id})
			return


func _oracle_passes(oracle: Dictionary) -> bool:
	for assertion_value in oracle.get("assertions", []):
		if not _assertion_passes(assertion_value):
			return false
	return true


func _assertion_passes(assertion: Dictionary) -> bool:
	var path := String(assertion.get("path", ""))
	var operator := String(assertion.get("operator", ""))
	var exists := _game.has_state_path(path)
	if operator == "exists":
		return exists
	if operator == "absent":
		return not exists
	if not exists:
		return false
	var actual: Variant = _game.state_value(path)
	var expected: Variant = _expected_value(assertion.get("expected", {}))
	match operator:
		"eq":
			return actual == expected
		"neq":
			return actual != expected
		"gt":
			return float(actual) > float(expected)
		"gte":
			return float(actual) >= float(expected)
		"lt":
			return float(actual) < float(expected)
		"lte":
			return float(actual) <= float(expected)
		"within":
			var tolerance := float(assertion.get("tolerance", "0"))
			return absf(float(actual) - float(expected)) <= tolerance
	return false


func _expected_value(expected: Dictionary) -> Variant:
	match String(expected.get("kind", "")):
		"null":
			return null
		"boolean":
			return bool(expected.get("value", false))
		"integer":
			return int(String(expected.get("value", "0")))
		"decimal":
			return float(String(expected.get("value", "0")))
		"text":
			return String(expected.get("value", ""))
	return null


func _pass_oracle(oracle: Dictionary, tick: int, terminal: bool) -> void:
	var oracle_id := String(oracle.get("oracleId", ""))
	_passed[oracle_id] = true
	var snapshot := _state_snapshot(oracle.get("stateHashFields", []))
	_emit("oracle-passed", {
		"oracleId": oracle_id,
		"terminal": terminal,
		"tick": tick,
		"state": snapshot,
		"stateHash": _state_hash(snapshot),
	})


func _state_snapshot(fields: Array) -> Array:
	var snapshot: Array = []
	for field_value in fields:
		var path := String(field_value)
		snapshot.append({
			"path": path,
			"value": _normalized_value(_game.state_value(path)),
		})
	return snapshot


func _normalized_value(value: Variant) -> Variant:
	if typeof(value) == TYPE_FLOAT:
		return "%.6f" % value
	return value


func _state_hash(snapshot: Array) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	context.update(JSON.stringify(snapshot).to_utf8_buffer())
	return "sha256:%s" % context.finish().hex_encode()


func _all_checkpoints_complete() -> bool:
	for oracle_value in _checkpoints:
		var oracle: Dictionary = oracle_value
		if not bool(_passed.get(String(oracle.get("oracleId", "")), false)):
			return false
	return true


func _terminal_complete() -> bool:
	if _terminal.is_empty():
		return false
	for oracle_value in _terminal:
		var oracle: Dictionary = oracle_value
		if not bool(_passed.get(String(oracle.get("oracleId", "")), false)):
			return false
	return true


func _fail(code: String, tick: int, details: Dictionary) -> void:
	if _finished:
		return
	_finished = true
	var output := {
		"code": code,
		"tick": tick,
		"scenarioDigest": SCENARIO_DIGEST,
	}
	for key in details:
		output[key] = details[key]
	_emit("replay-failed", output)
	_game.finish_replay(2)


func _emit(event: String, details: Dictionary) -> void:
	if _event_sink.is_valid():
		_event_sink.call(event, details)
		return
	var output := {"event": event}
	for key in details:
		output[key] = details[key]
	print(OUTPUT_PREFIX + JSON.stringify(output))
