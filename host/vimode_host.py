#!/usr/bin/env python3
"""vimode's native messaging host: watches the config file for the extension.

The extension sends {"path": "..."} (on connect, and whenever the path is
changed in the options page). The host answers with {"path", "text"} straight
away and again every time the file changes, or {"path", "error"} while it
cannot be read. Polling the mtime twice a second is plenty for a file edited by
hand, and needs nothing outside the standard library.

Messages are the native messaging framing: a 4-byte native-endian length, then
that many bytes of UTF-8 JSON, on stdin and stdout.
"""

import json
import os
import select
import struct
import sys

POLL_SECONDS = 0.5


def send(msg):
    data = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
    sys.stdout.buffer.flush()


def read_exactly(n):
    # Straight from the file descriptor: a buffered read could pull a second
    # message into Python's buffer, where select() would never report it.
    data = b""
    while len(data) < n:
        chunk = os.read(0, n - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def receive():
    head = read_exactly(4)
    if head is None:
        return None
    (length,) = struct.unpack("=I", head)
    body = read_exactly(length)
    return None if body is None else json.loads(body.decode("utf-8"))


def expand(path):
    return os.path.expandvars(os.path.expanduser(path))


def main():
    path = None
    seen = None
    while True:
        ready, _, _ = select.select([0], [], [], POLL_SECONDS)
        if ready:
            msg = receive()
            if msg is None:
                return
            if isinstance(msg.get("path"), str):
                path = msg["path"]
                seen = None
        if path is None:
            continue
        full = expand(path)
        try:
            st = os.stat(full)
            stamp = (st.st_mtime_ns, st.st_size, st.st_ino)
            if stamp != seen:
                with open(full, encoding="utf-8") as f:
                    text = f.read()
                seen = stamp
                send({"path": full, "text": text})
        except OSError as e:
            if seen != "error":
                seen = "error"
                send({"path": full, "error": f"cannot read {full}: {e.strerror}"})


if __name__ == "__main__":
    main()
