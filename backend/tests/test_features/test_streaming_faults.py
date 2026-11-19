"""Fault injection tests for the streaming upload handler.

Tests that ``stream_to_temp`` and the upload endpoints handle
errors gracefully: oversized files, corrupt data, disk full, etc.
"""

import asyncio
import os
import threading
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.streaming_upload_handler import stream_to_temp


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error", [asyncio.CancelledError(), ValueError("synthetic read error")]
)
async def test_interrupted_read_reclaims_file_and_descriptor(
    tmp_path, monkeypatch, error
):
    from app.services import streaming_upload_handler as uploads

    created = []
    original = uploads._create_temp

    def create(suffix):
        result = original(suffix)
        created.append(result)
        return result

    monkeypatch.setattr(uploads, "_create_temp", create)
    upload = MagicMock(read=AsyncMock(side_effect=[b"partial", error]))
    with pytest.raises(type(error)):
        await uploads.stream_to_temp(upload)
    assert len(created) == 1
    descriptor, path = created[0]
    try:
        assert not Path(path).exists()
        with pytest.raises(OSError):
            os.fstat(descriptor)
    finally:
        uploads._close_and_unlink(descriptor, path)


@pytest.mark.asyncio
async def test_cancellation_during_temp_creation_reclaims_late_file(monkeypatch):
    from app.services import streaming_upload_handler as uploads

    started, release = threading.Event(), threading.Event()
    created = []
    original = uploads._create_temp

    def create(suffix):
        result = original(suffix)
        created.append(result)
        started.set()
        assert release.wait(timeout=5)
        return result

    monkeypatch.setattr(uploads, "_create_temp", create)
    task = asyncio.create_task(
        uploads.stream_to_temp(MagicMock(read=AsyncMock(return_value=b"")))
    )
    try:
        assert await asyncio.to_thread(started.wait, 5)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert all(not Path(path).exists() for _, path in created)
    finally:
        release.set()
        for descriptor, path in created:
            uploads._close_and_unlink(descriptor, path)


@pytest.mark.asyncio
async def test_partial_os_write_preserves_the_complete_upload(monkeypatch):
    from app.services import streaming_upload_handler as uploads

    original = os.write
    monkeypatch.setattr(uploads.os, "write", lambda fd, data: original(fd, data[:3]))
    upload = MagicMock(read=AsyncMock(side_effect=[b"complete synthetic content", b""]))
    result = await uploads.stream_to_temp(upload)
    try:
        assert Path(result.path).read_bytes() == b"complete synthetic content"
    finally:
        result.close()


@pytest.mark.asyncio
async def test_repeated_cancellation_waits_for_inflight_write(monkeypatch):
    from app.services import streaming_upload_handler as uploads

    started, release = threading.Event(), threading.Event()
    writes = []
    original = os.write

    def write(fd, data):
        started.set()
        assert release.wait(timeout=5)
        result = original(fd, data)
        writes.append(result)
        return result

    monkeypatch.setattr(uploads.os, "write", write)
    upload = MagicMock(read=AsyncMock(side_effect=[b"synthetic content", b""]))
    task = asyncio.create_task(uploads.stream_to_temp(upload))
    try:
        assert await asyncio.to_thread(started.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done(), "fd must stay owned until the executor write finishes"
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert writes == [len(b"synthetic content")]
    finally:
        release.set()


class TestStreamToTempFaults:
    """stream_to_temp error handling."""

    @pytest.mark.asyncio
    async def test_empty_file_returns_empty_tempfile(self):
        """Uploading 0 bytes returns a TempFile with size=0."""
        mock = MagicMock()
        mock.read = AsyncMock(return_value=b"")

        result = await stream_to_temp(mock, suffix=".txt")
        assert result.size == 0
        assert os.path.getsize(result.path) == 0
        result.close()

    @pytest.mark.asyncio
    async def test_exceeds_max_size_raises_valueerror(self):
        """Uploading content exceeding max_size raises ValueError."""
        mock = MagicMock()
        # Return 1 byte per read, simulate 11 bytes total
        mock.read = AsyncMock(side_effect=[b"x"] * 15 + [b""])

        with pytest.raises(ValueError, match="文件超过大小限制"):
            await stream_to_temp(mock, max_size=10, suffix=".bin")

    @pytest.mark.asyncio
    async def test_read_error_cleans_up_tempfile(self):
        """If upload.read() raises, the temp file is removed."""
        mock = MagicMock()
        mock.read = AsyncMock(side_effect=OSError("connection reset"))

        with pytest.raises(OSError):
            await stream_to_temp(mock, suffix=".bin")

        # Temp file should not exist
        # (We can't check the path since we don't have it, but no file should leak)

    @pytest.mark.asyncio
    async def test_partial_read_then_error_cleans_up(self):
        """Partial content + error → temp file is removed."""
        mock = MagicMock()
        mock.read = AsyncMock(side_effect=[b"partial_content", OSError("disk full")])

        with pytest.raises(OSError):
            await stream_to_temp(mock, suffix=".bin")


class TestTempFileFaults:
    """TempFile lifecycle edge cases."""

    @pytest.mark.asyncio
    async def test_double_close_is_idempotent(self):
        """Calling close() twice is safe."""
        mock = MagicMock()
        mock.read = AsyncMock(return_value=b"")

        tmp = await stream_to_temp(mock)
        tmp.close()
        tmp.close()  # should not raise

    @pytest.mark.asyncio
    async def test_detach_prevents_cleanup(self):
        """After detach(), close() does not unlink the file."""
        mock = MagicMock()
        mock.read = AsyncMock(side_effect=[b"content", b""])

        tmp = await stream_to_temp(mock)
        path = tmp.path
        assert os.path.exists(path)

        tmp.detach()
        tmp.close()
        # File should still exist after close() since we detached
        assert os.path.exists(path)
        # Cleanup for test
        os.unlink(path)

    @pytest.mark.asyncio
    async def test_context_manager_cleans_up(self):
        """Using TempFile as context manager cleans up on exit."""
        mock = MagicMock()
        mock.read = AsyncMock(side_effect=[b"content", b""])

        tmp = await stream_to_temp(mock)
        path = tmp.path
        assert os.path.exists(path)

        tmp.__exit__(None, None, None)
        assert not os.path.exists(path)
