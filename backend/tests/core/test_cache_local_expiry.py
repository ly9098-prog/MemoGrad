from app.core.cache import CacheClient


def test_idle_expired_local_entries_are_purged_before_new_write(monkeypatch):
    client = CacheClient()
    client._enabled = False
    monkeypatch.setattr("time.time", lambda: 10.0)
    client._local_set("expired", {"private": True}, ttl=1)
    client._local["expired"] = (9.0, {"private": True})
    monkeypatch.setattr("time.time", lambda: 20.0)

    client._local_set("current", {"ok": True}, ttl=30)

    assert "expired" not in client._local
    assert "current" in client._local
