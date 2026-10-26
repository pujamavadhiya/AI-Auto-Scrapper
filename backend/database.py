"""
User Authentication & Per-User API Keys Database Manager
Uses SQLite (embedded, zero-configuration, persistent).
"""

import os
import sqlite3
import hashlib
import secrets
import hmac
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List

DB_PATH = Path(__file__).resolve().parent / "app.db"


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for concurrent reads/writes and enforce foreign keys
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db():
    """Initializes tables for users, user_keys, and sessions."""
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                name TEXT,
                role TEXT DEFAULT 'user',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_keys (
                user_id TEXT PRIMARY KEY,
                serpapi_key TEXT DEFAULT '',
                serper_key TEXT DEFAULT '',
                gemini_api_key TEXT DEFAULT '',
                leadocean_api_key TEXT DEFAULT '',
                leadocean_endpoint TEXT DEFAULT '',
                apify_token TEXT DEFAULT '',
                openai_api_key TEXT DEFAULT '',
                default_engine TEXT DEFAULT 'serpapi',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS search_history (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                module_type TEXT NOT NULL,
                search_query TEXT NOT NULL,
                record_count INTEGER DEFAULT 0,
                enriched_count INTEGER DEFAULT 0,
                results_json TEXT NOT NULL,
                filters_json TEXT DEFAULT '{}',
                status TEXT DEFAULT 'completed',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_search_history_user_date
            ON search_history (user_id, created_at DESC);
        """)

        # Auto-seed default admin user if database is empty (e.g. fresh cloud deployment on Render)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users")
        row = cur.fetchone()
        user_count = row[0] if row else 0
        if user_count == 0:
            default_email = os.environ.get("DEFAULT_ADMIN_EMAIL", "admin@example.com").strip().lower()
            default_password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "password123").strip()
            default_name = os.environ.get("DEFAULT_ADMIN_NAME", "Admin User").strip()
            salt = secrets.token_hex(16)
            p_hash, _ = hash_password(default_password, salt)
            user_id = secrets.token_hex(12)
            now_iso = datetime.now(timezone.utc).isoformat()
            cur.execute(
                """
                INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)
                """,
                (user_id, default_email, p_hash, salt, default_name, now_iso, now_iso),
            )
            cur.execute(
                """
                INSERT INTO user_keys (user_id, serpapi_key, serper_key, gemini_api_key, leadocean_api_key, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    os.environ.get("SERPAPI_KEY", ""),
                    os.environ.get("SERPER_API_KEY", ""),
                    os.environ.get("GEMINI_API_KEY", ""),
                    os.environ.get("LEADOCEAN_API_KEY", ""),
                    now_iso,
                ),
            )

        conn.commit()


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    """Hashes password with PBKDF2-HMAC-SHA256."""
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100_000
    )
    return key.hex(), salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    """Securely verifies password using constant-time comparison."""
    calculated_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(calculated_hash, expected_hash)


def create_user(email: str, password: str, name: str = "", role: str = "user") -> Dict[str, Any]:
    """Creates a new user and an associated empty API keys record."""
    clean_email = email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise ValueError("Invalid email address provided.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")

    user_id = secrets.token_hex(12)
    now = datetime.now(timezone.utc).isoformat()
    pwd_hash, salt = hash_password(password)

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, clean_email, pwd_hash, salt, name.strip(), role, now, now)
        )
        conn.execute(
            """
            INSERT INTO user_keys (user_id, updated_at)
            VALUES (?, ?)
            """,
            (user_id, now)
        )
        conn.commit()

    return {
        "id": user_id,
        "email": clean_email,
        "name": name.strip(),
        "role": role,
        "created_at": now
    }


def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticates email and password. Returns user dict or None."""
    clean_email = email.strip().lower()
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT id, email, password_hash, salt, name, role, created_at FROM users WHERE email = ?",
            (clean_email,)
        ).fetchone()

        if not row:
            return None

        if verify_password(password, row["salt"], row["password_hash"]):
            return {
                "id": row["id"],
                "email": row["email"],
                "name": row["name"],
                "role": row["role"],
                "created_at": row["created_at"]
            }
    return None


def create_session(user_id: str, days_valid: int = 30) -> str:
    """Generates a secure session token valid for days_valid days."""
    token = secrets.token_urlsafe(36)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=days_valid)

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (token, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token, user_id, now.isoformat(), expires.isoformat())
        )
        conn.commit()

    return token


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """Retrieves user by active session token. Deletes session if expired."""
    if not token:
        return None

    clean_token = token.replace("Bearer ", "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.name, u.role, s.expires_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (clean_token,)
        ).fetchone()

        if not row:
            return None

        if row["expires_at"] < now_iso:
            conn.execute("DELETE FROM sessions WHERE token = ?", (clean_token,))
            conn.commit()
            return None

        return {
            "id": row["id"],
            "email": row["email"],
            "name": row["name"],
            "role": row["role"]
        }


def delete_session(token: str) -> None:
    """Logs out by invalidating session token."""
    clean_token = token.replace("Bearer ", "").strip()
    with get_db_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (clean_token,))
        conn.commit()


def get_user_keys(user_id: str) -> Dict[str, Any]:
    """Retrieves all API keys and preferences configured for this user."""
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT serpapi_key, serper_key, gemini_api_key, leadocean_api_key,
                   leadocean_endpoint, apify_token, openai_api_key, default_engine, updated_at
            FROM user_keys
            WHERE user_id = ?
            """,
            (user_id,)
        ).fetchone()

        if not row:
            # Create default if not present
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("INSERT OR IGNORE INTO user_keys (user_id, updated_at) VALUES (?, ?)", (user_id, now))
            conn.commit()
            return {
                "serpapi_key": "",
                "serper_key": "",
                "gemini_api_key": "",
                "leadocean_api_key": "",
                "leadocean_endpoint": "",
                "apify_token": "",
                "openai_api_key": "",
                "default_engine": "serpapi",
                "updated_at": now
            }

        return dict(row)


def update_user_keys(user_id: str, keys_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Updates API keys for a specific user without affecting any other user."""
    allowed_fields = {
        "serpapi_key", "serper_key", "gemini_api_key",
        "leadocean_api_key", "leadocean_endpoint",
        "apify_token", "openai_api_key", "default_engine"
    }

    # Normalize aliases from camelCase or snake_case
    alias_map = {
        "serpapiKey": "serpapi_key",
        "serperKey": "serper_key",
        "serperApiKey": "serper_key",
        "geminiApiKey": "gemini_api_key",
        "leadoceanApiKey": "leadocean_api_key",
        "apiKey": "leadocean_api_key",
        "leadoceanEndpoint": "leadocean_endpoint",
        "url": "leadocean_endpoint",
        "apifyToken": "apify_token",
        "openaiApiKey": "openai_api_key",
        "defaultEngine": "default_engine",
        "defaultDecisionMakerEngine": "default_engine"
    }

    normalized = {}
    for k, v in keys_dict.items():
        dest = alias_map.get(k, k)
        if dest in allowed_fields and v is not None:
            normalized[dest] = str(v).strip()

    if not normalized:
        return get_user_keys(user_id)

    now = datetime.now(timezone.utc).isoformat()
    set_clauses = [f"{col} = ?" for col in normalized.keys()]
    set_clauses.append("updated_at = ?")
    params = list(normalized.values()) + [now, user_id]

    sql = f"""
        UPDATE user_keys
        SET {', '.join(set_clauses)}
        WHERE user_id = ?
    """

    with get_db_connection() as conn:
        cur = conn.execute(sql, params)
        if cur.rowcount == 0:
            # Insert if missing
            cols = ["user_id"] + list(normalized.keys()) + ["updated_at"]
            vals = [user_id] + list(normalized.values()) + [now]
            qmarks = ", ".join(["?"] * len(cols))
            conn.execute(f"INSERT INTO user_keys ({', '.join(cols)}) VALUES ({qmarks})", vals)
        conn.commit()

    return get_user_keys(user_id)


def list_users() -> List[Dict[str, Any]]:
    """Lists all registered users with summary of configured keys."""
    with get_db_connection() as conn:
        rows = conn.execute("""
            SELECT u.id, u.email, u.name, u.role, u.created_at,
                   k.serpapi_key, k.serper_key, k.gemini_api_key, k.leadocean_api_key
            FROM users u
            LEFT JOIN user_keys k ON u.id = k.user_id
            ORDER BY u.created_at DESC
        """).fetchall()

        results = []
        for r in rows:
            results.append({
                "id": r["id"],
                "email": r["email"],
                "name": r["name"],
                "role": r["role"],
                "created_at": r["created_at"],
                "has_serpapi_key": bool(r["serpapi_key"]),
                "has_serper_key": bool(r["serper_key"]),
                "has_gemini_key": bool(r["gemini_api_key"]),
                "has_leadocean_key": bool(r["leadocean_api_key"]),
            })
        return results


def delete_user(email: str) -> bool:
    """Deletes a user by email."""
    clean_email = email.strip().lower()
    with get_db_connection() as conn:
        cur = conn.execute("DELETE FROM users WHERE email = ?", (clean_email,))
        conn.commit()
        return cur.rowcount > 0


def update_user_password(email: str, new_password: str) -> bool:
    """Updates password for a user."""
    clean_email = email.strip().lower()
    if len(new_password) < 6:
        raise ValueError("Password must be at least 6 characters.")

    pwd_hash, salt = hash_password(new_password)
    now = datetime.now(timezone.utc).isoformat()

    with get_db_connection() as conn:
        cur = conn.execute(
            """
            UPDATE users
            SET password_hash = ?, salt = ?, updated_at = ?
            WHERE email = ?
            """,
            (pwd_hash, salt, now, clean_email)
        )
        conn.commit()
        return cur.rowcount > 0


def save_search_history(
    user_id: str,
    module_type: str,
    search_query: str,
    records: List[Dict[str, Any]],
    filters: Optional[Dict[str, Any]] = None,
    status: str = "completed",
    enriched_count: Optional[int] = None
) -> Dict[str, Any]:
    """Saves a search query and full extracted results in the history for this user."""
    history_id = f"hist_{secrets.token_hex(10)}"
    now = datetime.now(timezone.utc).isoformat()
    record_count = len(records)
    if enriched_count is None:
        enriched_count = sum(1 for r in records if r.get("enrichmentStatus") == "enriched" or r.get("linkedinUrl") or r.get("email"))

    results_json = json.dumps(records, ensure_ascii=False)
    filters_json = json.dumps(filters or {}, ensure_ascii=False)

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO search_history (
                id, user_id, module_type, search_query,
                record_count, enriched_count, results_json,
                filters_json, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                history_id, user_id, module_type.strip(), search_query.strip(),
                record_count, enriched_count, results_json,
                filters_json, status, now, now
            )
        )
        conn.commit()

    return {
        "id": history_id,
        "userId": user_id,
        "moduleType": module_type,
        "searchQuery": search_query,
        "recordCount": record_count,
        "enrichedCount": enriched_count,
        "status": status,
        "filters": filters or {},
        "createdAt": now,
        "updatedAt": now,
    }


def get_user_search_history(user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Retrieves summary list of all search extractions for this user (most recent first).
    Excludes the heavy results_json payload for fast listing.
    """
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, module_type, search_query, record_count,
                   enriched_count, status, filters_json, created_at, updated_at
            FROM search_history
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit)
        ).fetchall()

        results = []
        for r in rows:
            try:
                filters = json.loads(r["filters_json"]) if r["filters_json"] else {}
            except Exception:
                filters = {}
            results.append({
                "id": r["id"],
                "moduleType": r["module_type"],
                "searchQuery": r["search_query"],
                "recordCount": r["record_count"],
                "enrichedCount": r["enriched_count"],
                "status": r["status"],
                "filters": filters,
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            })
        return results


def get_search_history_by_id(user_id: str, history_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves full extracted results including all records for this user."""
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, module_type, search_query, record_count,
                   enriched_count, results_json, filters_json, status, created_at, updated_at
            FROM search_history
            WHERE id = ? AND user_id = ?
            """,
            (history_id, user_id)
        ).fetchone()

        if not row:
            return None

        try:
            records = json.loads(row["results_json"])
        except Exception:
            records = []

        try:
            filters = json.loads(row["filters_json"]) if row["filters_json"] else {}
        except Exception:
            filters = {}

        return {
            "id": row["id"],
            "userId": row["user_id"],
            "moduleType": row["module_type"],
            "searchQuery": row["search_query"],
            "recordCount": row["record_count"],
            "enrichedCount": row["enriched_count"],
            "records": records,
            "filters": filters,
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


def delete_search_history(user_id: str, history_id: str) -> bool:
    """Deletes a specific search history item belonging to this user."""
    with get_db_connection() as conn:
        cur = conn.execute(
            "DELETE FROM search_history WHERE id = ? AND user_id = ?",
            (history_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def clear_user_search_history(user_id: str) -> int:
    """Clears all search history for this specific user only."""
    with get_db_connection() as conn:
        cur = conn.execute(
            "DELETE FROM search_history WHERE user_id = ?",
            (user_id,)
        )
        conn.commit()
        return cur.rowcount


# Automatically run table migrations upon import
init_db()
