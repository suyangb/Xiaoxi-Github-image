from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
import sqlite3
import threading
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "app.db"
CONFIG_PATH = DATA_DIR / "config.json"
LOG_PATH = DATA_DIR / "server.log"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 38471

DB_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def write_server_log(message: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"[{now_iso()}] {message}\n")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_secret(length: int = 48) -> str:
    return secrets.token_urlsafe(length)


def parse_json_body(raw: bytes) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败: {exc.msg}") from exc

    if not isinstance(data, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return data


def normalize_string_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, list):
        items = values
    elif isinstance(values, str):
        items = [part.strip() for part in values.replace("，", ",").split(",")]
    else:
        raise ValueError("列表字段必须是字符串数组或逗号分隔字符串")

    result: list[str] = []
    for item in items:
        if not isinstance(item, str):
            raise ValueError("列表字段中的每一项都必须是字符串")
        clean = item.strip()
        if clean:
            result.append(clean)
    return result


def sanitize_repo_key(owner: str, repo_name: str) -> str:
    return f"{owner.strip()}/{repo_name.strip()}".strip("/")


def validate_url(value: str, field_name: str) -> str:
    clean = value.strip()
    if not clean:
        raise ValueError(f"{field_name} 不能为空")
    parsed = urlparse(clean)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} 必须是有效的 http/https 地址")
    return clean


def serialize_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def load_config() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            config = json.load(handle)
    else:
        config = {}

    changed = False
    if not config.get("master_key"):
        config["master_key"] = generate_secret(64)
        changed = True
    if not config.get("listen_host"):
        config["listen_host"] = DEFAULT_HOST
        changed = True
    if not config.get("listen_port"):
        config["listen_port"] = DEFAULT_PORT
        changed = True

    if changed:
        with CONFIG_PATH.open("w", encoding="utf-8") as handle:
            json.dump(config, handle, ensure_ascii=False, indent=2)

    return config


CONFIG = load_config()


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


@dataclass
class AuthContext:
    auth_type: str
    api_key_id: int | None = None
    allowed_repos: list[str] | None = None


def init_db() -> None:
    with DB_LOCK:
        connection = connect_db()
        try:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  server_name TEXT NOT NULL DEFAULT 'GitHub 图床远程服务',
                  whitelist_enabled INTEGER NOT NULL DEFAULT 1,
                  whitelist_entries TEXT NOT NULL DEFAULT '["127.0.0.1"]',
                  cdn_enabled INTEGER NOT NULL DEFAULT 0,
                  cdn_mode TEXT NOT NULL DEFAULT 'replace',
                  cdn_base_url TEXT NOT NULL DEFAULT '',
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS api_keys (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  key_hash TEXT NOT NULL UNIQUE,
                  key_preview TEXT NOT NULL,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  allowed_repos TEXT NOT NULL DEFAULT '[]',
                  ip_whitelist TEXT NOT NULL DEFAULT '[]',
                  remark TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_used_at TEXT
                );

                CREATE TABLE IF NOT EXISTS images (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  owner TEXT NOT NULL,
                  repo_name TEXT NOT NULL,
                  repo_key TEXT NOT NULL,
                  branch TEXT NOT NULL DEFAULT 'main',
                  path TEXT NOT NULL,
                  original_url TEXT NOT NULL,
                  cdn_url_snapshot TEXT NOT NULL DEFAULT '',
                  size INTEGER NOT NULL DEFAULT 0,
                  mime_type TEXT NOT NULL DEFAULT '',
                  sha TEXT NOT NULL DEFAULT '',
                  uploaded_at TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  deleted_at TEXT,
                  source TEXT NOT NULL DEFAULT 'local-client'
                );

                CREATE INDEX IF NOT EXISTS idx_images_repo_key ON images(repo_key);
                CREATE INDEX IF NOT EXISTS idx_images_uploaded_at ON images(uploaded_at DESC);
                CREATE INDEX IF NOT EXISTS idx_images_deleted_at ON images(deleted_at);

                CREATE TABLE IF NOT EXISTS audit_logs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  action TEXT NOT NULL,
                  auth_type TEXT NOT NULL,
                  api_key_id INTEGER,
                  ip TEXT NOT NULL,
                  request_path TEXT NOT NULL,
                  request_method TEXT NOT NULL,
                  status_code INTEGER NOT NULL,
                  detail TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL
                );
                """
            )

            row = connection.execute("SELECT id FROM settings WHERE id = 1").fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO settings (
                      id, server_name, whitelist_enabled, whitelist_entries,
                      cdn_enabled, cdn_mode, cdn_base_url, updated_at
                    )
                    VALUES (1, ?, 1, ?, 0, 'replace', '', ?)
                    """,
                    (
                        "GitHub 图床远程服务",
                        serialize_json(["127.0.0.1"]),
                        now_iso(),
                    ),
                )
            connection.commit()
        finally:
            connection.close()


def get_settings(connection: sqlite3.Connection) -> dict[str, Any]:
    row = connection.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if row is None:
        raise RuntimeError("服务设置不存在")
    return {
        "server_name": row["server_name"],
        "whitelist_enabled": bool(row["whitelist_enabled"]),
        "whitelist_entries": json.loads(row["whitelist_entries"] or "[]"),
        "cdn_enabled": bool(row["cdn_enabled"]),
        "cdn_mode": row["cdn_mode"],
        "cdn_base_url": row["cdn_base_url"],
        "updated_at": row["updated_at"],
    }


def update_settings(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    current = get_settings(connection)

    server_name = str(payload.get("server_name", current["server_name"])).strip() or current["server_name"]
    whitelist_enabled = payload.get("whitelist_enabled", current["whitelist_enabled"])
    cdn_enabled = payload.get("cdn_enabled", current["cdn_enabled"])
    cdn_mode = str(payload.get("cdn_mode", current["cdn_mode"])).strip() or current["cdn_mode"]
    cdn_base_url = str(payload.get("cdn_base_url", current["cdn_base_url"])).strip()

    whitelist_entries = normalize_string_list(payload.get("whitelist_entries", current["whitelist_entries"]))

    if cdn_mode not in {"replace", "proxy"}:
        raise ValueError("CDN 模式仅支持 replace 或 proxy")
    if cdn_enabled and not cdn_base_url:
        raise ValueError("启用 CDN 时必须填写 CDN 基础地址")
    if cdn_base_url:
        validate_url(cdn_base_url, "CDN 基础地址")

    connection.execute(
        """
        UPDATE settings
        SET server_name = ?, whitelist_enabled = ?, whitelist_entries = ?,
            cdn_enabled = ?, cdn_mode = ?, cdn_base_url = ?, updated_at = ?
        WHERE id = 1
        """,
        (
            server_name,
            1 if whitelist_enabled else 0,
            serialize_json(whitelist_entries),
            1 if cdn_enabled else 0,
            cdn_mode,
            cdn_base_url,
            now_iso(),
        ),
    )
    connection.commit()
    return get_settings(connection)


def compute_cdn_url(settings: dict[str, Any], original_url: str, path: str) -> str:
    if not settings["cdn_enabled"] or not settings["cdn_base_url"].strip():
        return ""

    base = settings["cdn_base_url"].rstrip("/")
    if settings["cdn_mode"] == "proxy":
        return f"{base}/{original_url}"
    return f"{base}/{path.lstrip('/')}"


def match_ip_rule(client_ip: str, rule: str) -> bool:
    try:
        if "/" in rule:
            return ipaddress.ip_address(client_ip) in ipaddress.ip_network(rule, strict=False)
        return client_ip == str(ipaddress.ip_address(rule))
    except ValueError:
        return False


def ip_allowed(client_ip: str, whitelist_enabled: bool, rules: list[str]) -> bool:
    if not whitelist_enabled:
        return True
    if not rules:
        return False
    return any(match_ip_rule(client_ip, rule) for rule in rules)


def row_to_api_key(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "key_preview": row["key_preview"],
        "enabled": bool(row["enabled"]),
        "allowed_repos": json.loads(row["allowed_repos"] or "[]"),
        "ip_whitelist": json.loads(row["ip_whitelist"] or "[]"),
        "remark": row["remark"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_used_at": row["last_used_at"],
    }


def row_to_image(row: sqlite3.Row, settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "owner": row["owner"],
        "repo_name": row["repo_name"],
        "repo_key": row["repo_key"],
        "branch": row["branch"],
        "path": row["path"],
        "original_url": row["original_url"],
        "cdn_url_snapshot": row["cdn_url_snapshot"],
        "cdn_url_current": row["cdn_url_snapshot"],
        "size": row["size"],
        "mime_type": row["mime_type"],
        "sha": row["sha"],
        "uploaded_at": row["uploaded_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "source": row["source"],
    }


def validate_image_payload(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    owner = str(payload.get("owner", "")).strip()
    repo_name = str(payload.get("repo_name", "")).strip()
    branch = str(payload.get("branch", "main")).strip() or "main"
    path = str(payload.get("path", "")).strip().lstrip("/")
    original_url = validate_url(str(payload.get("original_url", "")), "原始地址")
    cdn_url = str(payload.get("cdn_url", "")).strip()
    if cdn_url:
        cdn_url = validate_url(cdn_url, "CDN 地址")

    if not name:
        raise ValueError("图片名称不能为空")
    if not owner:
        raise ValueError("owner 不能为空")
    if not repo_name:
        raise ValueError("repo_name 不能为空")
    if not path:
        raise ValueError("path 不能为空")

    try:
        size = int(payload.get("size", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("size 必须是数字") from exc

    if size < 0:
        raise ValueError("size 不能小于 0")

    uploaded_at = str(payload.get("uploaded_at", "")).strip() or now_iso()
    source = str(payload.get("source", "local-client")).strip() or "local-client"
    mime_type = str(payload.get("mime_type", "")).strip()
    sha = str(payload.get("sha", "")).strip()
    repo_key = sanitize_repo_key(owner, repo_name)

    return {
        "name": name,
        "owner": owner,
        "repo_name": repo_name,
        "repo_key": repo_key,
        "branch": branch,
        "path": path,
        "original_url": original_url,
        "cdn_url": cdn_url,
        "size": size,
        "mime_type": mime_type,
        "sha": sha,
        "uploaded_at": uploaded_at,
        "source": source,
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "ImageCenterServer/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        write_server_log(format % args)

    @property
    def client_ip(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if forwarded:
            return forwarded
        return self.client_address[0]

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        self.handle_request()

    def do_POST(self) -> None:
        self.handle_request()

    def do_PATCH(self) -> None:
        self.handle_request()

    def do_DELETE(self) -> None:
        self.handle_request()

    def handle_request(self) -> None:
        try:
            self.dispatch_request()
        except ValueError as exc:
            self.respond_error(400, str(exc), "bad_request")
        except RuntimeError as exc:
            if str(exc) not in {"unauthorized", "forbidden"}:
                self.respond_error(400, str(exc), "runtime_error")
        except Exception as exc:  # pragma: no cover
            write_server_log(f"Unhandled error: {exc}\n{traceback.format_exc()}")
            self.respond_error(500, f"服务内部错误: {exc}", "server_error")

    def dispatch_request(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)

        if path == "/api/ping" and self.command == "GET":
            self.respond_json(
                200,
                {
                    "ok": True,
                    "server_time": now_iso(),
                    "listen_host": CONFIG["listen_host"],
                    "listen_port": CONFIG["listen_port"],
                },
            )
            return

        with DB_LOCK:
            connection = connect_db()
            try:
                if path.startswith("/api/admin/"):
                    auth = self.require_admin_auth()
                    self.handle_admin_route(connection, path, query, auth)
                    return

                if path.startswith("/api/open/"):
                    auth = self.require_api_key_auth(connection)
                    self.handle_open_route(connection, path, query, auth)
                    return

                self.respond_error(404, "接口不存在", "not_found")
            finally:
                connection.close()

    def read_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length 非法") from exc

        raw = self.rfile.read(length) if length > 0 else b""
        return parse_json_body(raw)

    def extract_bearer_token(self) -> str:
        authorization = self.headers.get("Authorization", "").strip()
        if not authorization.lower().startswith("bearer "):
            self.respond_error(401, "缺少 Bearer Token", "missing_bearer_token")
            raise RuntimeError("unauthorized")
        token = authorization[7:].strip()
        if not token:
            self.respond_error(401, "Bearer Token 不能为空", "missing_bearer_token")
            raise RuntimeError("unauthorized")
        return token

    def require_admin_auth(self) -> AuthContext:
        token = self.extract_bearer_token()
        if token != CONFIG["master_key"]:
            self.respond_error(401, "主管理密钥无效", "invalid_master_key")
            raise RuntimeError("unauthorized")
        return AuthContext(auth_type="master")

    def ensure_master_auth(self, auth: AuthContext) -> None:
        if auth.auth_type != "master":
            self.respond_error(403, "该接口仅允许主管理密钥调用", "master_key_required")
            raise RuntimeError("forbidden")

    def require_api_key_auth(self, connection: sqlite3.Connection) -> AuthContext:
        token = self.extract_bearer_token()
        if token == CONFIG["master_key"]:
            settings = get_settings(connection)
            if not ip_allowed(self.client_ip, settings["whitelist_enabled"], settings["whitelist_entries"]):
                self.respond_error(403, "当前 IP 不在服务端白名单中", "ip_forbidden")
                raise RuntimeError("forbidden")
            return AuthContext(auth_type="master", allowed_repos=[])

        token_hash = sha256_text(token)
        row = connection.execute(
            "SELECT * FROM api_keys WHERE key_hash = ?",
            (token_hash,),
        ).fetchone()

        if row is None or not bool(row["enabled"]):
            self.respond_error(401, "API Key 无效或已禁用", "invalid_api_key")
            raise RuntimeError("unauthorized")

        settings = get_settings(connection)
        if not ip_allowed(self.client_ip, settings["whitelist_enabled"], settings["whitelist_entries"]):
            self.respond_error(403, "当前 IP 不在服务端白名单中", "ip_forbidden")
            raise RuntimeError("forbidden")

        key_whitelist = json.loads(row["ip_whitelist"] or "[]")
        if key_whitelist and not ip_allowed(self.client_ip, True, key_whitelist):
            self.respond_error(403, "当前 IP 不在该 API Key 白名单中", "ip_forbidden")
            raise RuntimeError("forbidden")

        timestamp = now_iso()
        connection.execute(
            "UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?",
            (timestamp, timestamp, row["id"]),
        )
        connection.commit()
        return AuthContext(
            auth_type="api_key",
            api_key_id=row["id"],
            allowed_repos=json.loads(row["allowed_repos"] or "[]"),
        )

    def handle_admin_route(
        self,
        connection: sqlite3.Connection,
        path: str,
        query: dict[str, list[str]],
        auth: AuthContext,
    ) -> None:
        settings = get_settings(connection)

        if path == "/api/admin/verify" and self.command == "GET":
            self.respond_json(
                200,
                {
                    "ok": True,
                    "service": {
                        "server_name": settings["server_name"],
                        "listen_host": CONFIG["listen_host"],
                        "listen_port": CONFIG["listen_port"],
                    },
                    "settings": settings,
                },
                auth=auth,
                detail="验证主管理密钥",
            )
            return

        if path == "/api/admin/settings":
            if self.command == "GET":
                self.respond_json(200, settings, auth=auth, detail="读取服务设置")
                return
            if self.command == "PATCH":
                payload = self.read_body()
                updated = update_settings(connection, payload)
                self.respond_json(200, updated, auth=auth, detail="更新服务设置")
                return

        if path == "/api/admin/api-keys":
            if self.command == "GET":
                rows = connection.execute("SELECT * FROM api_keys ORDER BY created_at DESC").fetchall()
                self.respond_json(
                    200,
                    {"items": [row_to_api_key(row) for row in rows]},
                    auth=auth,
                    detail="读取 API Key 列表",
                )
                return

            if self.command == "POST":
                payload = self.read_body()
                plain_key = str(payload.get("plain_key", "")).strip()
                name = str(payload.get("name", "")).strip()
                remark = str(payload.get("remark", "")).strip()
                allowed_repos = normalize_string_list(payload.get("allowed_repos"))
                ip_whitelist = normalize_string_list(payload.get("ip_whitelist"))

                if not name:
                    raise ValueError("API Key 名称不能为空")
                if len(plain_key) < 24:
                    raise ValueError("plain_key 太短，建议至少 24 位")

                created_at = now_iso()
                try:
                    connection.execute(
                        """
                        INSERT INTO api_keys (
                          name, key_hash, key_preview, enabled, allowed_repos,
                          ip_whitelist, remark, created_at, updated_at
                        )
                        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                        """,
                        (
                            name,
                            sha256_text(plain_key),
                            plain_key[:8],
                            serialize_json(allowed_repos),
                            serialize_json(ip_whitelist),
                            remark,
                            created_at,
                            created_at,
                        ),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ValueError("该 API Key 已存在") from exc

                connection.commit()
                self.respond_json(201, {"ok": True}, auth=auth, detail=f"创建 API Key: {name}")
                return

        if path.startswith("/api/admin/api-keys/"):
            try:
                key_id = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self.respond_error(404, "API Key 不存在", "not_found")
                return

            if self.command == "PATCH":
                row = connection.execute("SELECT * FROM api_keys WHERE id = ?", (key_id,)).fetchone()
                if row is None:
                    self.respond_error(404, "API Key 不存在", "not_found")
                    return

                payload = self.read_body()
                name = str(payload.get("name", row["name"])).strip() or row["name"]
                enabled = payload.get("enabled", bool(row["enabled"]))
                remark = str(payload.get("remark", row["remark"])).strip()
                allowed_repos = normalize_string_list(payload.get("allowed_repos", json.loads(row["allowed_repos"] or "[]")))
                ip_whitelist = normalize_string_list(payload.get("ip_whitelist", json.loads(row["ip_whitelist"] or "[]")))

                connection.execute(
                    """
                    UPDATE api_keys
                    SET name = ?, enabled = ?, remark = ?, allowed_repos = ?,
                        ip_whitelist = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        name,
                        1 if enabled else 0,
                        remark,
                        serialize_json(allowed_repos),
                        serialize_json(ip_whitelist),
                        now_iso(),
                        key_id,
                    ),
                )
                connection.commit()
                self.respond_json(200, {"ok": True}, auth=auth, detail=f"更新 API Key: {name}")
                return

            if self.command == "DELETE":
                row = connection.execute("SELECT name FROM api_keys WHERE id = ?", (key_id,)).fetchone()
                if row is None:
                    self.respond_error(404, "API Key 不存在", "not_found")
                    return
                connection.execute("DELETE FROM api_keys WHERE id = ?", (key_id,))
                connection.commit()
                self.respond_json(200, {"ok": True}, auth=auth, detail=f"删除 API Key: {row['name']}")
                return

        if path == "/api/admin/images" and self.command == "GET":
            self.respond_json(
                200,
                self.list_images(connection, query, settings),
                auth=auth,
                detail="读取远程图片列表",
            )
            return

        if path == "/api/admin/logs" and self.command == "GET":
            page = max(int(query.get("page", ["1"])[0]), 1)
            page_size = min(max(int(query.get("page_size", ["20"])[0]), 1), 100)
            offset = (page - 1) * page_size
            total = connection.execute("SELECT COUNT(*) AS count FROM audit_logs").fetchone()["count"]
            rows = connection.execute(
                """
                SELECT * FROM audit_logs
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (page_size, offset),
            ).fetchall()
            self.respond_json(
                200,
                {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "items": [dict(row) for row in rows],
                },
                auth=auth,
                detail="读取操作日志",
            )
            return

        self.respond_error(404, "管理接口不存在", "not_found")

    def list_images(
        self,
        connection: sqlite3.Connection,
        query: dict[str, list[str]],
        settings: dict[str, Any],
        repo_scope: list[str] | None = None,
    ) -> dict[str, Any]:
        page = max(int(query.get("page", ["1"])[0]), 1)
        page_size = min(max(int(query.get("page_size", ["20"])[0]), 1), 100)
        offset = (page - 1) * page_size
        keyword = query.get("keyword", [""])[0].strip()
        repo_name = query.get("repo_name", [""])[0].strip()
        owner = query.get("owner", [""])[0].strip()
        mime_type = query.get("mime_type", [""])[0].strip()
        date_from = query.get("date_from", [""])[0].strip()
        date_to = query.get("date_to", [""])[0].strip()

        where_parts = ["deleted_at IS NULL"]
        params: list[Any] = []

        if keyword:
            where_parts.append("(name LIKE ? OR path LIKE ?)")
            params.extend([f"%{keyword}%", f"%{keyword}%"])
        if repo_name:
            where_parts.append("repo_name = ?")
            params.append(repo_name)
        if owner:
            where_parts.append("owner = ?")
            params.append(owner)
        if mime_type:
            where_parts.append("mime_type = ?")
            params.append(mime_type)
        if date_from:
            where_parts.append("uploaded_at >= ?")
            params.append(date_from)
        if date_to:
            where_parts.append("uploaded_at <= ?")
            params.append(date_to)
        if repo_scope is not None:
            if not repo_scope:
                return {"page": page, "page_size": page_size, "total": 0, "items": []}
            placeholders = ",".join("?" for _ in repo_scope)
            where_parts.append(f"repo_key IN ({placeholders})")
            params.extend(repo_scope)

        where_sql = " AND ".join(where_parts)
        total = connection.execute(
            f"SELECT COUNT(*) AS count FROM images WHERE {where_sql}",
            params,
        ).fetchone()["count"]
        rows = connection.execute(
            f"""
            SELECT * FROM images
            WHERE {where_sql}
            ORDER BY uploaded_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

        return {
            "page": page,
            "page_size": page_size,
            "total": total,
            "items": [row_to_image(row, settings) for row in rows],
        }

    def handle_open_route(
        self,
        connection: sqlite3.Connection,
        path: str,
        query: dict[str, list[str]],
        auth: AuthContext,
    ) -> None:
        settings = get_settings(connection)

        if path == "/api/open/repos" and self.command == "GET":
            repo_scope = auth.allowed_repos or []
            if repo_scope:
                placeholders = ",".join("?" for _ in repo_scope)
                rows = connection.execute(
                    f"""
                    SELECT DISTINCT owner, repo_name, repo_key
                    FROM images
                    WHERE deleted_at IS NULL AND repo_key IN ({placeholders})
                    ORDER BY repo_key ASC
                    """,
                    repo_scope,
                ).fetchall()
            else:
                rows = []
            self.respond_json(
                200,
                {"items": [dict(row) for row in rows]},
                auth=auth,
                detail="读取允许访问的仓库列表",
            )
            return

        if path == "/api/open/images":
            if self.command == "GET":
                self.respond_json(
                    200,
                    self.list_images(connection, query, settings, auth.allowed_repos or []),
                    auth=auth,
                    detail="读取开放图片列表",
                )
                return

            if self.command == "POST":
                self.ensure_master_auth(auth)
                payload = validate_image_payload(self.read_body())
                repo_scope = auth.allowed_repos or []
                if repo_scope and payload["repo_key"] not in repo_scope:
                    self.respond_error(403, "当前 API Key 无权访问该仓库", "repo_forbidden")
                    return

                cdn_url = payload["cdn_url"]
                created_at = now_iso()
                connection.execute(
                    """
                    INSERT INTO images (
                      name, owner, repo_name, repo_key, branch, path,
                      original_url, cdn_url_snapshot, size, mime_type, sha,
                      uploaded_at, created_at, updated_at, source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload["name"],
                        payload["owner"],
                        payload["repo_name"],
                        payload["repo_key"],
                        payload["branch"],
                        payload["path"],
                        payload["original_url"],
                        cdn_url,
                        payload["size"],
                        payload["mime_type"],
                        payload["sha"],
                        payload["uploaded_at"],
                        created_at,
                        created_at,
                        payload["source"],
                    ),
                )
                image_id = connection.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
                connection.commit()
                row = connection.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
                self.respond_json(
                    201,
                    row_to_image(row, settings),
                    auth=auth,
                    detail=f"写入图片记录: {payload['name']}",
                )
                return

        if path.startswith("/api/open/images/"):
            try:
                image_id = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self.respond_error(404, "图片记录不存在", "not_found")
                return

            row = connection.execute("SELECT * FROM images WHERE id = ? AND deleted_at IS NULL", (image_id,)).fetchone()
            if row is None:
                self.respond_error(404, "图片记录不存在", "not_found")
                return

            repo_scope = auth.allowed_repos or []
            if repo_scope and row["repo_key"] not in repo_scope:
                self.respond_error(403, "当前 API Key 无权访问该仓库", "repo_forbidden")
                return

            if self.command == "GET":
                self.respond_json(200, row_to_image(row, settings), auth=auth, detail="读取图片详情")
                return

            if self.command == "DELETE":
                self.ensure_master_auth(auth)
                deleted_at = now_iso()
                connection.execute(
                    "UPDATE images SET deleted_at = ?, updated_at = ? WHERE id = ?",
                    (deleted_at, deleted_at, image_id),
                )
                connection.commit()
                self.respond_json(200, {"ok": True}, auth=auth, detail=f"删除图片记录: {row['name']}")
                return

        self.respond_error(404, "开放接口不存在", "not_found")

    def respond_json(
        self,
        status_code: int,
        payload: dict[str, Any],
        *,
        auth: AuthContext | None = None,
        detail: str = "",
    ) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        if auth is not None:
            self.write_audit_log(auth, status_code, detail)

    def respond_error(self, status_code: int, message: str, code: str) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {
                    "error": {
                        "code": code,
                        "message": message,
                    }
                },
                ensure_ascii=False,
            ).encode("utf-8")
        )

    def write_audit_log(self, auth: AuthContext, status_code: int, detail: str) -> None:
        with connect_db() as connection:
            connection.execute(
                """
                INSERT INTO audit_logs (
                  action, auth_type, api_key_id, ip, request_path,
                  request_method, status_code, detail, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    detail or self.path,
                    auth.auth_type,
                    auth.api_key_id,
                    self.client_ip,
                    self.path,
                    self.command,
                    status_code,
                    detail,
                    now_iso(),
                ),
            )
            connection.commit()


def print_boot_message() -> None:
    print("=" * 72)
    print("GitHub 图床远程服务已初始化")
    print(f"监听地址: http://{CONFIG['listen_host']}:{CONFIG['listen_port']}")
    print(f"主管理密钥: {CONFIG['master_key']}")
    print(f"配置文件: {CONFIG_PATH}")
    print(f"数据库文件: {DB_PATH}")
    print("=" * 72)


def main() -> None:
    init_db()
    print_boot_message()
    server = ThreadingHTTPServer((CONFIG["listen_host"], int(CONFIG["listen_port"])), AppHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
