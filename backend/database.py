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
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List

DB_PATH = Path(__file__).resolve().parent / "app.db"
REGISTRY_PATH = Path(__file__).resolve().parent / "users_registry.json"
RENDER_YAML_PATH = Path(__file__).resolve().parent.parent / "render.yaml"

_last_render_yaml_mtime = 0.0


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for concurrent reads/writes and enforce foreign keys
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def save_users_registry() -> None:
    """Exports all active database users to persistent users_registry.json so accounts survive any restarts."""
    try:
        with get_db_connection() as conn:
            rows = conn.execute(
                "SELECT id, email, password_hash, salt, name, role, created_at, updated_at FROM users"
            ).fetchall()
            users_list = [dict(r) for r in rows]
            with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
                json.dump(users_list, f, indent=2)
    except Exception as e:
        print(f"Warning: could not save users registry: {e}")


def sync_from_render_yaml(force: bool = False) -> bool:
    """
    Synchronizes users, credentials, and roles from render.yaml (or INITIAL_USERS env) directly into the database.
    Checks file mtime so any manual edits to render.yaml are instantly updated in the database and frontend.
    """
    global _last_render_yaml_mtime
    users_raw_string = ""

    if RENDER_YAML_PATH.exists():
        try:
            mtime = RENDER_YAML_PATH.stat().st_mtime
            if not force and mtime == _last_render_yaml_mtime:
                return False
            _last_render_yaml_mtime = mtime
            content = RENDER_YAML_PATH.read_text(encoding="utf-8")
            m = re.search(r"- key:\s*INITIAL_USERS\s*\n\s*value:\s*([^\n]*)", content)
            if m:
                users_raw_string = m.group(1).strip()
        except Exception as e:
            print(f"Warning: could not read render.yaml: {e}")

    if not users_raw_string:
        users_raw_string = os.environ.get("INITIAL_USERS", "").strip()

    if not users_raw_string:
        return False

    now_iso = datetime.now(timezone.utc).isoformat()
    parsed_users = []
    for item in users_raw_string.split(","):
        item = item.strip()
        if not item:
            continue
        parts = item.split(":")
        if len(parts) >= 2:
            u_email = parts[0].strip().lower()
            u_pass = parts[1].strip()
            u_name = parts[2].strip() if len(parts) >= 3 else u_email.split("@")[0].capitalize()
            u_role = parts[3].strip().lower() if len(parts) >= 4 else "user"
            if u_role not in ("admin", "user"):
                u_role = "user"
            parsed_users.append((u_email, u_pass, u_name, u_role))

    if not parsed_users:
        return False

    with get_db_connection() as conn:
        for u_email, u_pass, u_name, u_role in parsed_users:
            row = conn.execute(
                "SELECT id, password_hash, salt, name, role FROM users WHERE email = ? COLLATE NOCASE",
                (u_email,)
            ).fetchone()

            if row:
                user_id = row["id"]
                # Update role and name
                conn.execute(
                    "UPDATE users SET name = ?, role = ?, updated_at = ? WHERE id = ?",
                    (u_name, u_role, now_iso, user_id)
                )
                # If password changed in render.yaml, update password hash & salt
                if not verify_password(u_pass, row["salt"], row["password_hash"]):
                    pwd_hash, salt = hash_password(u_pass)
                    conn.execute(
                        "UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",
                        (pwd_hash, salt, now_iso, user_id)
                    )
            else:
                user_id = secrets.token_hex(12)
                pwd_hash, salt = hash_password(u_pass)
                conn.execute(
                    """
                    INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, u_email, pwd_hash, salt, u_name, u_role, now_iso, now_iso)
                )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO user_keys (user_id, serpapi_key, serper_key, gemini_api_key, leadocean_api_key, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        os.environ.get("SERPAPI_KEY", ""),
                        os.environ.get("SERPER_API_KEY", ""),
                        os.environ.get("GEMINI_API_KEY", ""),
                        os.environ.get("LEADOCEAN_API_KEY", ""),
                        now_iso
                    )
                )
        conn.commit()

    save_users_registry()
    return True


def sync_to_render_yaml(known_passwords: Optional[Dict[str, str]] = None) -> None:
    """
    Reflects any user addition, role update, password change, or deletion from frontend/database back into render.yaml.
    """
    global _last_render_yaml_mtime
    if not RENDER_YAML_PATH.exists():
        return

    try:
        content = RENDER_YAML_PATH.read_text(encoding="utf-8")
        # Extract existing passwords from render.yaml
        passwords_map: Dict[str, str] = {}
        m = re.search(r"- key:\s*INITIAL_USERS\s*\n\s*value:\s*([^\n]*)", content)
        if m:
            val = m.group(1).strip()
            for item in val.split(","):
                parts = item.strip().split(":")
                if len(parts) >= 2:
                    passwords_map[parts[0].strip().lower()] = parts[1].strip()

        if known_passwords:
            for k, v in known_passwords.items():
                if v and len(v) >= 6:
                    passwords_map[k.strip().lower()] = v.strip()

        # Get all non-Puja users from database (Puja is default primary admin)
        with get_db_connection() as conn:
            rows = conn.execute(
                "SELECT email, name, role FROM users WHERE email != 'puja@gmail.com' COLLATE NOCASE ORDER BY created_at ASC"
            ).fetchall()

        items = []
        for r in rows:
            em = r["email"].strip().lower()
            nm = r["name"].strip() if r["name"] else em.split("@")[0].capitalize()
            rl = r["role"].strip().lower() if r["role"] else "user"
            pw = passwords_map.get(em, "Password@123")
            items.append(f"{em}:{pw}:{nm}:{rl}")

        new_val = ",".join(items)

        if "INITIAL_USERS" in content:
            new_content = re.sub(
                r"(- key:\s*INITIAL_USERS\s*\n\s*value:\s*)([^\n]*)",
                r"\g<1>" + new_val,
                content
            )
        else:
            new_content = content.replace(
                "envVars:\n",
                f"envVars:\n      - key: INITIAL_USERS\n        value: {new_val}\n"
            )

        RENDER_YAML_PATH.write_text(new_content, encoding="utf-8")
        _last_render_yaml_mtime = RENDER_YAML_PATH.stat().st_mtime
    except Exception as e:
        print(f"Warning: could not write to render.yaml: {e}")



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

        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_projects (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                module_type TEXT NOT NULL,
                records_json TEXT NOT NULL,
                config_json TEXT DEFAULT '{}',
                status TEXT DEFAULT 'completed',
                total_records INTEGER DEFAULT 0,
                enriched_records INTEGER DEFAULT 0,
                source_file_name TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_projects_user_date
            ON user_projects (user_id, updated_at DESC);
        """)

        # Auto-seed predefined admin user Puja (only Puja, no hardcoded Dhruv or admin user)
        seed_users = [
            ("puja@gmail.com", "Puja@1234", "Puja", "admin"),
        ]

        # Also support custom environment variable: INITIAL_USERS="email:pass:name:role,email2:pass2:name2"
        extra_users_env = os.environ.get("INITIAL_USERS", "").strip()
        if extra_users_env:
            for item in extra_users_env.split(","):
                parts = item.strip().split(":")
                if len(parts) >= 2:
                    u_email = parts[0].strip().lower()
                    u_pass = parts[1].strip()
                    u_name = parts[2].strip() if len(parts) >= 3 else u_email.split("@")[0].capitalize()
                    u_role = parts[3].strip() if len(parts) >= 4 else "user"
                    seed_users.append((u_email, u_pass, u_name, u_role))

        cur = conn.cursor()
        now_iso = datetime.now(timezone.utc).isoformat()

        for u_email, u_pass, u_name, u_role in seed_users:
            u_clean_email = u_email.strip().lower()
            cur.execute("SELECT id FROM users WHERE email = ?", (u_clean_email,))
            existing = cur.fetchone()
            if not existing:
                salt = secrets.token_hex(16)
                p_hash, _ = hash_password(u_pass, salt)
                user_id = secrets.token_hex(12)
                cur.execute(
                    """
                    INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, u_clean_email, p_hash, salt, u_name, u_role, now_iso, now_iso),
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
            else:
                user_id = existing[0]
                # User exists: ensure role and name are kept in sync with seed definition (e.g. role='admin' for Puja)
                cur.execute(
                    "UPDATE users SET role = ?, name = ?, updated_at = ? WHERE email = ?",
                    (u_role, u_name, now_iso, u_clean_email),
                )
                # Backfill any empty user keys with server environment variables if available
                env_defaults = [
                    ("serpapi_key", os.environ.get("SERPAPI_KEY", "").strip()),
                    ("serper_key", os.environ.get("SERPER_API_KEY", "").strip()),
                    ("gemini_api_key", os.environ.get("GEMINI_API_KEY", "").strip()),
                    ("leadocean_api_key", os.environ.get("LEADOCEAN_API_KEY", "").strip()),
                ]
                for col, val in env_defaults:
                    if val:
                        cur.execute(
                            f"UPDATE user_keys SET {col} = ? WHERE user_id = ? AND ({col} IS NULL OR {col} = '')",
                            (val, user_id),
                        )

        # Restore all persistent users from users_registry.json if present
        if REGISTRY_PATH.exists():
            try:
                with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                    saved_users = json.load(f)
                    for su in saved_users:
                        su_email = su.get("email", "").strip().lower()
                        if not su_email:
                            continue
                        cur.execute("SELECT id FROM users WHERE email = ?", (su_email,))
                        existing = cur.fetchone()
                        if not existing:
                            u_id = su.get("id") or secrets.token_hex(12)
                            cur.execute(
                                """
                                INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    u_id,
                                    su_email,
                                    su.get("password_hash"),
                                    su.get("salt"),
                                    su.get("name") or su_email.split("@")[0].capitalize(),
                                    su.get("role") or "user",
                                    su.get("created_at") or now_iso,
                                    su.get("updated_at") or now_iso,
                                ),
                            )
                            cur.execute(
                                """
                                INSERT OR IGNORE INTO user_keys (user_id, updated_at)
                                VALUES (?, ?)
                                """,
                                (u_id, now_iso),
                            )
                        else:
                            if su.get("role"):
                                cur.execute("UPDATE users SET role = ?, name = ? WHERE email = ?", (su.get("role"), su.get("name"), su_email))
            except Exception as e:
                print(f"Warning: could not restore users from registry: {e}")

        # -------------------------------------------------------------
        # Data Migration & Cleanup:
        # 1. Ensure puja@gmail.com is strictly an admin
        # 2. Reassign search_history and keys from old accounts (admin@example.com, dhruv@gmail.com, user2@example.com) to Puja
        # 3. Delete preexisting users except Puja
        # 4. Restore search_history into user_projects for Puja if user_projects is empty
        # -------------------------------------------------------------
        cur.execute("SELECT id FROM users WHERE email = 'puja@gmail.com'")
        puja_row = cur.fetchone()
        if puja_row:
            puja_id = puja_row["id"]
            cur.execute("UPDATE users SET role = 'admin', name = 'Puja' WHERE id = ?", (puja_id,))

            # Find old accounts to remove
            cur.execute("SELECT id, email FROM users WHERE email IN ('admin@example.com', 'dhruv@gmail.com', 'user2@example.com')")
            old_users = cur.fetchall()
            for old_u in old_users:
                old_id = old_u["id"]
                # Reassign history so no user data is lost
                cur.execute("UPDATE search_history SET user_id = ? WHERE user_id = ?", (puja_id, old_id))
                cur.execute("UPDATE user_projects SET user_id = ? WHERE user_id = ?", (puja_id, old_id))
                cur.execute("DELETE FROM sessions WHERE user_id = ?", (old_id,))
                cur.execute("DELETE FROM user_keys WHERE user_id = ?", (old_id,))
                cur.execute("DELETE FROM users WHERE id = ?", (old_id,))

            # Backfill projects from search history for Puja if projects is empty
            cur.execute("SELECT COUNT(*) FROM user_projects WHERE user_id = ?", (puja_id,))
            proj_count = cur.fetchone()[0]
            if proj_count == 0:
                cur.execute(
                    """
                    SELECT id, module_type, search_query, record_count, enriched_count, results_json, filters_json, status, created_at, updated_at
                    FROM search_history WHERE user_id = ?
                    ORDER BY created_at ASC
                    """,
                    (puja_id,)
                )
                for hr in cur.fetchall():
                    p_id = f"proj-{hr['id']}"
                    module_name = hr["module_type"].replace("-", " ").title()
                    p_name = f"{hr['search_query']} ({module_name})"
                    p_desc = f"Extracted leads from {module_name}: '{hr['search_query']}'"
                    cur.execute(
                        """
                        INSERT OR IGNORE INTO user_projects (
                            id, user_id, name, description, module_type,
                            records_json, config_json, status, total_records,
                            enriched_records, source_file_name, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            p_id, puja_id, p_name, p_desc, hr["module_type"],
                            hr["results_json"], hr["filters_json"] or "{}", hr["status"] or "completed",
                            hr["record_count"] or 0, hr["enriched_count"] or 0, "", hr["created_at"], hr["updated_at"]
                        )
                    )

        conn.commit()

    # Persist the registered accounts snapshot
    save_users_registry()
    sync_from_render_yaml(force=True)


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
    """Creates a new user and an associated empty API keys record, strictly preventing duplicate emails."""
    clean_email = email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise ValueError("Invalid email address provided.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")

    with get_db_connection() as conn:
        # Prevent duplicate user with the same email
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (clean_email,)).fetchone()
        if existing:
            raise ValueError(f"User with email '{clean_email}' already exists in the database. Duplicate email IDs are not allowed.")

        user_id = secrets.token_hex(12)
        now = datetime.now(timezone.utc).isoformat()
        pwd_hash, salt = hash_password(password)

        try:
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
            save_users_registry()
            sync_to_render_yaml({clean_email: password})
        except sqlite3.IntegrityError:
            raise ValueError(f"User with email '{clean_email}' already exists in the database. Duplicate email IDs are not allowed.")

    return {
        "id": user_id,
        "email": clean_email,
        "name": name.strip(),
        "role": role,
        "created_at": now
    }


def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticates email and password. Returns user dict or None."""
    sync_from_render_yaml()
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

    sync_from_render_yaml()
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
    sync_from_render_yaml()
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
        cur = conn.execute("DELETE FROM users WHERE email = ? COLLATE NOCASE", (clean_email,))
        conn.commit()
        ok = cur.rowcount > 0
        if ok:
            save_users_registry()
            sync_to_render_yaml()
        return ok


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
            WHERE email = ? COLLATE NOCASE
            """,
            (pwd_hash, salt, now, clean_email)
        )
        conn.commit()
        ok = cur.rowcount > 0
        if ok:
            save_users_registry()
            sync_to_render_yaml({clean_email: new_password})
        return ok


def update_user(
    email: str,
    name: Optional[str] = None,
    role: Optional[str] = None,
    new_password: Optional[str] = None
) -> bool:
    """Updates user name, role, and/or password."""
    clean_email = email.strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    updates = []
    params = []

    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())

    if role is not None:
        clean_role = role.strip().lower()
        if clean_role not in ("admin", "user"):
            clean_role = "user"
        updates.append("role = ?")
        params.append(clean_role)

    if new_password:
        if len(new_password) < 6:
            raise ValueError("Password must be at least 6 characters.")
        p_hash, salt = hash_password(new_password)
        updates.append("password_hash = ?")
        params.append(p_hash)
        updates.append("salt = ?")
        params.append(salt)

    if not updates:
        return True

    updates.append("updated_at = ?")
    params.append(now)
    params.append(clean_email)

    with get_db_connection() as conn:
        cur = conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE email = ? COLLATE NOCASE", params)
        conn.commit()
        ok = cur.rowcount > 0
        if ok:
            save_users_registry()
            sync_to_render_yaml({clean_email: new_password} if new_password else None)
        return ok


def sync_user_account(email: str, password: Optional[str] = None, name: str = "", role: str = "user") -> Dict[str, Any]:
    """Ensures a user account exists; if missing, creates it; if existing, updates role and name."""
    clean_email = email.strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    clean_role = role.strip().lower() if role in ("admin", "user") else "user"
    clean_name = name.strip() if name else clean_email.split("@")[0].capitalize()

    with get_db_connection() as conn:
        existing = conn.execute("SELECT id, role, name FROM users WHERE email = ? COLLATE NOCASE", (clean_email,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE users SET role = ?, name = ?, updated_at = ? WHERE email = ? COLLATE NOCASE",
                (clean_role, clean_name, now, clean_email)
            )
            conn.commit()
            save_users_registry()
            sync_to_render_yaml({clean_email: password} if password else None)
            return {"id": existing["id"], "email": clean_email, "name": clean_name, "role": clean_role, "action": "updated"}
        else:
            user_id = secrets.token_hex(12)
            pwd = password if password and len(password) >= 6 else "Password@123"
            pwd_hash, salt = hash_password(pwd)
            conn.execute(
                """
                INSERT INTO users (id, email, password_hash, salt, name, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, clean_email, pwd_hash, salt, clean_name, clean_role, now, now)
            )
            conn.execute("INSERT OR IGNORE INTO user_keys (user_id, updated_at) VALUES (?, ?)", (user_id, now))
            conn.commit()
            save_users_registry()
            sync_to_render_yaml({clean_email: pwd})
            return {"id": user_id, "email": clean_email, "name": clean_name, "role": clean_role, "action": "created"}



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


def update_search_history(
    history_id: str,
    user_id: str,
    records: List[Dict[str, Any]],
    status: str = "completed",
    enriched_count: Optional[int] = None,
) -> bool:
    """Updates an existing search history entry with newly scraped/enriched records."""
    now = datetime.now(timezone.utc).isoformat()
    record_count = len(records)
    if enriched_count is None:
        enriched_count = sum(1 for r in records if r.get("enrichmentStatus") == "enriched" or r.get("linkedinUrl") or r.get("email") or r.get("Profile URL"))

    results_json = json.dumps(records, ensure_ascii=False)

    with get_db_connection() as conn:
        cur = conn.execute(
            """
            UPDATE search_history
            SET record_count = ?,
                enriched_count = ?,
                results_json = ?,
                status = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (record_count, enriched_count, results_json, status, now, history_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


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


def save_user_project(user_id: str, project: Dict[str, Any]) -> Dict[str, Any]:
    """Saves or updates a project belonging to user_id."""
    proj_id = project.get("id") or f"proj-{int(datetime.now(timezone.utc).timestamp()*1000)}"
    name = project.get("name") or "Untitled Project"
    description = project.get("description") or ""
    module_type = project.get("moduleType") or "decision-maker"
    records = project.get("records") or []
    config = project.get("config") or {}
    status = project.get("status") or "completed"
    source_file_name = project.get("sourceFileName") or ""
    now = datetime.now(timezone.utc).isoformat()
    created_at = project.get("createdAt") or now
    updated_at = project.get("updatedAt") or now
    total_records = project.get("totalRecords") or len(records)
    enriched_records = project.get("enrichedRecords") or sum(
        1 for r in records if r.get("enrichmentStatus") == "enriched" or r.get("linkedinUrl") or r.get("email")
    )

    records_json = json.dumps(records, ensure_ascii=False)
    config_json = json.dumps(config, ensure_ascii=False)

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO user_projects (
                id, user_id, name, description, module_type,
                records_json, config_json, status, total_records,
                enriched_records, source_file_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                module_type = excluded.module_type,
                records_json = excluded.records_json,
                config_json = excluded.config_json,
                status = excluded.status,
                total_records = excluded.total_records,
                enriched_records = excluded.enriched_records,
                source_file_name = excluded.source_file_name,
                updated_at = excluded.updated_at
            """,
            (
                proj_id, user_id, name, description, module_type,
                records_json, config_json, status, total_records,
                enriched_records, source_file_name, created_at, updated_at
            )
        )
        conn.commit()

    return {
        "id": proj_id,
        "name": name,
        "description": description,
        "moduleType": module_type,
        "records": records,
        "config": config,
        "status": status,
        "totalRecords": total_records,
        "enrichedRecords": enriched_records,
        "sourceFileName": source_file_name,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def get_user_projects(user_id: str) -> List[Dict[str, Any]]:
    """Retrieves all projects saved by user_id."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, description, module_type, records_json,
                   config_json, status, total_records, enriched_records,
                   source_file_name, created_at, updated_at
            FROM user_projects
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user_id,)
        ).fetchall()

        results = []
        for r in rows:
            try:
                records = json.loads(r["records_json"]) if r["records_json"] else []
            except Exception:
                records = []
            try:
                config = json.loads(r["config_json"]) if r["config_json"] else {}
            except Exception:
                config = {}

            results.append({
                "id": r["id"],
                "name": r["name"],
                "description": r["description"],
                "moduleType": r["module_type"],
                "records": records,
                "config": config,
                "status": r["status"],
                "totalRecords": r["total_records"],
                "enrichedRecords": r["enriched_records"],
                "sourceFileName": r["source_file_name"],
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            })
        return results


def delete_user_project(user_id: str, project_id: str) -> bool:
    """Deletes a specific project belonging to user_id."""
    with get_db_connection() as conn:
        cur = conn.execute(
            "DELETE FROM user_projects WHERE id = ? AND user_id = ?",
            (project_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def sync_user_projects(user_id: str, projects: List[Dict[str, Any]]) -> int:
    """Batch imports/synchronizes multiple projects for user_id."""
    count = 0
    for p in projects:
        try:
            save_user_project(user_id, p)
            count += 1
        except Exception:
            pass
    return count


# Automatically run table migrations upon import
init_db()
