from app.services.realtime_voice import (
    RealtimeVoiceJob,
    RealtimeVoiceQueue,
    SessionCircuitBreaker,
    split_assistant_text,
)


def test_split_assistant_text_prefers_sentence_boundaries():
    assert split_assistant_text("你好。我查到了，可以分三步。", max_chars=12) == [
        "你好。",
        "我查到了，",
        "可以分三步。",
    ]


def test_split_assistant_text_hard_splits_long_text_without_punctuation():
    assert split_assistant_text("abcdefghijklmnopqrstuvwxyz", max_chars=8) == [
        "abcdefgh",
        "ijklmnop",
        "qrstuvwx",
        "yz",
    ]


def test_voice_session_queue_rejects_when_full():
    queue = RealtimeVoiceQueue(max_size=3)

    accepted = [
        queue.enqueue(RealtimeVoiceJob(job_id=f"job-{index}", message_id=f"msg-{index}", text="hello"))
        for index in range(3)
    ]
    rejected = queue.enqueue(RealtimeVoiceJob(job_id="job-4", message_id="msg-4", text="overflow"))

    assert [item.accepted for item in accepted] == [True, True, True]
    assert [item.queue_position for item in accepted] == [1, 2, 3]
    assert rejected.accepted is False
    assert rejected.reason == "queue_full"
    assert rejected.fallback == "message_tts"


def test_circuit_opens_after_session_failure_threshold_and_half_open_probe():
    now = 1000.0

    def now_fn():
        return now

    circuit = SessionCircuitBreaker(
        failure_threshold=2,
        window_seconds=60,
        open_seconds=30,
        now_fn=now_fn,
    )

    assert circuit.can_accept().accepted is True
    circuit.record_failure("tts_chunk_timeout")
    assert circuit.state == "closed"

    circuit.record_failure("openclaw_stream_failed")
    assert circuit.state == "open"
    rejected = circuit.can_accept()
    assert rejected.accepted is False
    assert rejected.reason == "circuit_open"
    assert rejected.fallback == "message_tts"

    now += 31
    probe = circuit.can_accept()
    assert probe.accepted is True
    assert circuit.state == "half_open"

    second_probe = circuit.can_accept()
    assert second_probe.accepted is False
    assert second_probe.reason == "circuit_open"

    circuit.record_success()
    assert circuit.state == "closed"
    assert circuit.can_accept().accepted is True
