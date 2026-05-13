from app.services.response_parser import normalize_assistant_reply


def test_parse_json_fenced_reply():
    raw = """Hello today
```json
{"text":"Hello today","emotion":"happy","action":"wave","memory_ops":[{"op":"upsert","content":"user seems upbeat"}]}
```
"""
    result = normalize_assistant_reply(raw)
    assert result["text"] == "Hello today"
    assert result["emotion"] == "happy"
    assert result["action"] == "wave"
    assert result["parse_mode"] == "json_fenced"
    assert result["memory_ops"] == [{"op": "upsert", "content": "user seems upbeat"}]


def test_parse_inline_json_reply():
    raw = 'Still here {"emotion":"thinking","action":"think","memory_ops":[]}'
    result = normalize_assistant_reply(raw)
    assert result["text"] == "Still here"
    assert result["emotion"] == "thinking"
    assert result["action"] == "think"
    assert result["parse_mode"] == "json_inline"


def test_fallback_when_no_json():
    raw = "Could you confirm whether this plan is workable?"
    result = normalize_assistant_reply(raw)
    assert result["text"] == raw
    assert result["emotion"] == "thinking"
    assert result["action"] == "think"
    assert result["memory_ops"] == []
    assert result["parse_mode"] == "heuristic"


def test_plain_neutral_reply_defaults_to_idle_without_motion_plan():
    raw = "Received."

    result = normalize_assistant_reply(raw)

    assert result["emotion"] == "neutral"
    assert result["action"] == "idle"
    assert result["motion_plan"] is None


def test_parse_motion_plan_from_json_payload():
    raw = """
```json
{
  "text": "Hello there",
  "emotion": "happy",
  "action": "wave",
  "memory_ops": [],
  "motion_plan": {
    "sequence": [
      {"template": "greet_wave", "duration_ms": 1200, "intensity": 0.8},
      {"template": "listen_lean", "duration_ms": 1800, "intensity": 0.4}
    ]
  }
}
```
"""
    result = normalize_assistant_reply(raw)

    assert result["motion_plan"] == {
        "sequence": [
            {"template": "greet_wave", "duration_ms": 1200, "intensity": 0.8},
            {"template": "listen_lean", "duration_ms": 1800, "intensity": 0.4},
        ]
    }


def test_synthesizes_motion_plan_from_action_when_missing():
    raw = '{"text":"Received","emotion":"happy","action":"wave","memory_ops":[]}'

    result = normalize_assistant_reply(raw)

    assert result["motion_plan"] == {
        "sequence": [
            {"template": "greet_wave", "duration_ms": 1600, "intensity": 0.7},
            {"template": "listen_lean", "duration_ms": 1800, "intensity": 0.45},
        ]
    }


def test_preserves_motion_key_action_for_local_vmd_resolution():
    raw = '{"text":"Wave now","emotion":"happy","action":"asset_8f3a21","memory_ops":[]}'

    result = normalize_assistant_reply(raw)

    assert result["action"] == "asset_8f3a21"
