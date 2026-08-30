extends RefCounted

const OUTPUT_PREFIX := "AGPB_PERSISTENCE "
const SAVE_PATH := "user://graybox-save.json"
const MAX_SAVE_BYTES := 16384
const FRESH_STATE_HASH := "sha256:1d025ef5d6fbb149d4efc570386222eba43a70940cf840cefe6abcb292a6f7b6"
const PERSISTED_STATE_HASH := "sha256:d03c747825e76805b014f27fe25efa647c05dcbfb8a80fba68fd26ffecd5cef7"

var _host
var _identity: Dictionary = {}


func _init(host) -> void:
	_host = host


func run(mode: String) -> void:
	_identity = _load_identity()
	if _identity.is_empty() or not OS.is_userfs_persistent():
		_finish(2)
		return
	match mode:
		"save":
			_run_save_phase()
		"load":
			_run_load_phase()
		_:
			_finish(2)


func _run_save_phase() -> void:
	if not _host.persistence_state_is_fresh():
		_finish(2)
		return
	_emit({
		"event": "persistence-save-started",
		"projectId": _identity.projectId,
		"sourceDigest": _identity.sourceDigest,
		"freshStateHash": FRESH_STATE_HASH,
	})
	_host.prepare_persistence_saved_state()
	if not _host.persistence_state_is_saved() or not _host.save_game():
		_finish(2)
		return
	var save := _save_attestation()
	if save.is_empty():
		_finish(2)
		return
	_emit({
		"event": "persistence-save-completed",
		"projectId": _identity.projectId,
		"sourceDigest": _identity.sourceDigest,
		"stateHash": PERSISTED_STATE_HASH,
		"saveDigest": save.digest,
		"saveBytes": save.bytes,
		"userfsPersistent": true,
	})
	_finish(0)


func _run_load_phase() -> void:
	if not _host.persistence_state_is_fresh():
		_finish(2)
		return
	var save := _save_attestation()
	if save.is_empty():
		_finish(2)
		return
	_emit({
		"event": "persistence-load-started",
		"projectId": _identity.projectId,
		"sourceDigest": _identity.sourceDigest,
		"freshStateHash": FRESH_STATE_HASH,
		"saveDigest": save.digest,
		"saveBytes": save.bytes,
		"userfsPersistent": true,
	})
	if not _host.load_game() or not _host.persistence_state_is_saved():
		_finish(2)
		return
	var loaded_save := _save_attestation()
	if loaded_save != save:
		_finish(2)
		return
	_emit({
		"event": "persistence-load-completed",
		"projectId": _identity.projectId,
		"sourceDigest": _identity.sourceDigest,
		"stateHash": PERSISTED_STATE_HASH,
		"saveDigest": save.digest,
		"saveBytes": save.bytes,
	})
	_emit({
		"event": "persistence-cycle-passed",
		"projectId": _identity.projectId,
		"sourceDigest": _identity.sourceDigest,
		"stateHash": PERSISTED_STATE_HASH,
		"saveDigest": save.digest,
		"saveBytes": save.bytes,
	})
	_finish(0)


func _load_identity() -> Dictionary:
	var text := FileAccess.get_file_as_string("res://manifest.json")
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	var project_id: Variant = parsed.get("projectId")
	var source_digest: Variant = parsed.get("sourceDigest")
	if project_id != "golden.graybox.godot":
		return {}
	if not (source_digest is String) or not source_digest.begins_with("sha256:"):
		return {}
	return {
		"projectId": project_id,
		"sourceDigest": source_digest,
	}


func _save_attestation() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var bytes := FileAccess.get_file_as_bytes(SAVE_PATH).size()
	var digest := FileAccess.get_sha256(SAVE_PATH)
	if bytes < 1 or bytes > MAX_SAVE_BYTES or digest.length() != 64:
		return {}
	return {
		"digest": "sha256:" + digest,
		"bytes": bytes,
	}


func _emit(payload: Dictionary) -> void:
	print(OUTPUT_PREFIX + JSON.stringify(payload))


func _finish(exit_code: int) -> void:
	_host.finish_persistence(exit_code)
