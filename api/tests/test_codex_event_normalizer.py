from app.services.codex_event_normalizer import normalize_codex_server_event


def test_normalizes_agent_message_delta_to_text_delta():
    event = normalize_codex_server_event(
        {
            "method": "item/agentMessage/delta",
            "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "delta": "hello"},
        }
    )

    assert event == {
        "type": "text_delta",
        "turn_id": "turn-1",
        "text": "hello",
        "raw_method": "item/agentMessage/delta",
    }


def test_normalizes_turn_started_to_stable_event():
    event = normalize_codex_server_event(
        {
            "method": "turn/started",
            "params": {"threadId": "thread-1", "turn": {"id": "codex-turn-1", "status": "running"}},
        }
    )

    assert event == {
        "type": "turn_started",
        "turn_id": "codex-turn-1",
        "raw_method": "turn/started",
    }


def test_normalizes_plan_events_to_plan_delta():
    assert normalize_codex_server_event(
        {
            "method": "item/plan/delta",
            "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "delta": "step"},
        }
    ) == {
        "type": "plan_delta",
        "turn_id": "turn-1",
        "text": "step",
        "raw_method": "item/plan/delta",
    }
    assert normalize_codex_server_event(
        {
            "method": "turn/plan/updated",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "explanation": "Plan",
                "plan": [{"step": "Write tests", "status": "in_progress"}],
            },
        }
    ) == {
        "type": "plan_delta",
        "turn_id": "turn-1",
        "text": "Plan\n- [in_progress] Write tests",
        "raw_method": "turn/plan/updated",
    }


def test_normalizes_command_lifecycle_events():
    started = normalize_codex_server_event(
        {
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "type": "commandExecution",
                    "id": "item-1",
                    "command": "pytest api/tests",
                    "cwd": "D:/repo",
                },
            },
        }
    )
    output = normalize_codex_server_event(
        {
            "method": "item/commandExecution/outputDelta",
            "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "delta": "passed"},
        }
    )

    assert started == {
        "type": "command_started",
        "turn_id": "turn-1",
        "command": "pytest api/tests",
        "cwd": "D:/repo",
        "raw_method": "item/started",
    }
    assert output == {
        "type": "command_output",
        "turn_id": "turn-1",
        "stream": "stdout",
        "text": "passed",
        "raw_method": "item/commandExecution/outputDelta",
    }


def test_normalizes_file_change_and_turn_completed_events():
    file_event = normalize_codex_server_event(
        {
            "method": "item/fileChange/patchUpdated",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "changes": [{"path": "api/app/example.py", "kind": "update", "diff": "@@"}],
            },
        }
    )
    completed = normalize_codex_server_event(
        {
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "status": "completed",
                    "items": [{"type": "agentMessage", "id": "item-2", "text": "final"}],
                },
            },
        }
    )

    assert file_event == {
        "type": "file_changed",
        "turn_id": "turn-1",
        "path": "api/app/example.py",
        "change_type": "modified",
        "changed_files": ["api/app/example.py"],
        "raw_method": "item/fileChange/patchUpdated",
    }
    assert completed == {
        "type": "turn_completed",
        "turn_id": "turn-1",
        "final_text": "final",
        "raw_method": "turn/completed",
    }


def test_normalizes_error_and_thread_closed_events():
    failed = normalize_codex_server_event(
        {
            "method": "error",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "willRetry": False,
                "error": {"message": "model failed"},
            },
        }
    )
    closed = normalize_codex_server_event({"method": "thread/closed", "params": {"threadId": "thread-1"}})

    assert failed == {
        "type": "turn_failed",
        "turn_id": "turn-1",
        "error": "model failed",
        "will_retry": False,
        "raw_method": "error",
    }
    assert closed == {
        "type": "session_closed",
        "thread_id": "thread-1",
        "reason": "thread_closed",
        "raw_method": "thread/closed",
    }


def test_unknown_notification_is_preserved_as_raw_event():
    assert normalize_codex_server_event({"method": "model/verification", "params": {"ok": True}}) == {
        "type": "raw_codex_event",
        "raw_method": "model/verification",
        "payload": {"ok": True},
    }
