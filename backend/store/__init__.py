"""Training store (Supabase Postgres or local SQLite). Use get_store(); tests swap it with set_store()."""

import os
import threading
from pathlib import Path
from typing import Optional

from store.db import Conflict, NotFound, Store, make_engine  # noqa: F401

_store: Optional[Store] = None
_lock = threading.Lock()


def open_store(url: Optional[str] = None, sqlite_path: Optional[Path] = None) -> Store:
    """A store for this URL (or SUPABASE_DB_URL, or the local SQLite file) with its tables ensured."""
    if url is None and sqlite_path is None:
        url = os.getenv("SUPABASE_DB_URL") or None
    engine, backend = make_engine(url, sqlite_path)
    store = Store(engine, backend)
    store.create_tables()
    return store


def get_store() -> Store:
    global _store
    if _store is None:
        with _lock:
            if _store is None:
                _store = open_store()
    return _store


def set_store(store: Optional[Store]) -> None:
    """Replace the process-wide store (tests point it at a temp SQLite file)."""
    global _store
    with _lock:
        if _store is not None and _store is not store:
            _store.engine.dispose()
        _store = store
