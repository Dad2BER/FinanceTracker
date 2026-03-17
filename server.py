import datetime
import json
import os
import sqlite3
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Accept --db <path> so the preview server (which runs from the worktree
# directory) can be pointed at the main repo's database:
#   python server.py --db /absolute/path/to/finance-tracker.db
def _get_arg(flag, default):
    try:
        return sys.argv[sys.argv.index(flag) + 1]
    except (ValueError, IndexError):
        return default

DB_PATH = _get_arg("--db", "finance-tracker.db")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico":  "image/x-icon",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
}


# ── Database ───────────────────────────────────────────────────────────────────

def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS profiles (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            tax_type        TEXT NOT NULL,
            account_type    TEXT NOT NULL DEFAULT 'asset',
            opening_balance REAL NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS holdings (
            id          TEXT PRIMARY KEY,
            account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            symbol      TEXT NOT NULL,
            shares      REAL NOT NULL,
            origin      TEXT,
            asset_type  TEXT,
            sort_order  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS categories (
            id   TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS subcategories (
            id          TEXT PRIMARY KEY,
            category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            name        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS payees (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id             TEXT PRIMARY KEY,
            account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            date           TEXT NOT NULL,
            payee_name     TEXT NOT NULL,
            subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
            tag            TEXT,
            amount         REAL NOT NULL,
            excluded       INTEGER NOT NULL DEFAULT 0
        );
    """)
    con.commit()

    # ── Column migrations ──────────────────────────────────────────────────────
    # Add opening_balance to existing databases that predate this column
    try:
        con.execute("ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0")
        con.commit()
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Add profile_id to accounts
    try:
        con.execute("ALTER TABLE accounts ADD COLUMN profile_id TEXT REFERENCES profiles(id)")
        con.commit()
    except sqlite3.OperationalError:
        pass

    # Add profile_id to categories
    try:
        con.execute("ALTER TABLE categories ADD COLUMN profile_id TEXT REFERENCES profiles(id)")
        con.commit()
    except sqlite3.OperationalError:
        pass

    # Add profile_id to payees
    try:
        con.execute("ALTER TABLE payees ADD COLUMN profile_id TEXT REFERENCES profiles(id)")
        con.commit()
    except sqlite3.OperationalError:
        pass

    # Add excluded column to transactions (persists the exclude-from-budget flag)
    try:
        con.execute("ALTER TABLE transactions ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0")
        con.commit()
    except sqlite3.OperationalError:
        pass  # Column already exists

    # ── Data migrations ────────────────────────────────────────────────────────
    # Rename account_type 'liability' → 'ledger'
    con.execute("UPDATE accounts SET account_type = 'ledger' WHERE account_type = 'liability'")
    con.commit()

    # If no profiles exist, create a default "My Accounts" profile and assign
    # all existing data (accounts, categories, payees) to it.
    count = con.execute("SELECT COUNT(*) FROM profiles").fetchone()[0]
    if count == 0:
        default_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat()
        con.execute(
            "INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)",
            (default_id, "My Accounts", now)
        )
        con.execute("UPDATE accounts   SET profile_id = ? WHERE profile_id IS NULL", (default_id,))
        con.execute("UPDATE categories SET profile_id = ? WHERE profile_id IS NULL", (default_id,))
        con.execute("UPDATE payees     SET profile_id = ? WHERE profile_id IS NULL", (default_id,))
        con.commit()

    con.close()


def load_state(profile_id):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    # ── Accounts + Holdings + Transactions ────────────────────────────────────
    accounts_rows = con.execute(
        "SELECT * FROM accounts WHERE profile_id = ? ORDER BY created_at",
        (profile_id,)
    ).fetchall()

    accounts = []
    for a in accounts_rows:
        holdings_rows = con.execute(
            "SELECT * FROM holdings WHERE account_id = ? ORDER BY sort_order",
            (a["id"],)
        ).fetchall()

        holdings = []
        for h in holdings_rows:
            holding = {
                "id":     h["id"],
                "symbol": h["symbol"],
                "shares": h["shares"],
            }
            if h["origin"]:
                holding["origin"] = h["origin"]
            if h["asset_type"]:
                holding["assetType"] = h["asset_type"]
            holdings.append(holding)

        tx_rows = con.execute(
            "SELECT t.*, s.category_id "
            "FROM transactions t "
            "LEFT JOIN subcategories s ON s.id = t.subcategory_id "
            "WHERE t.account_id = ? ORDER BY t.date",
            (a["id"],)
        ).fetchall()

        transactions = []
        for t in tx_rows:
            tx = {
                "id":        t["id"],
                "date":      t["date"],
                "payeeName": t["payee_name"],
                "amount":    t["amount"],
            }
            if t["subcategory_id"]:
                tx["subcategoryId"] = t["subcategory_id"]
            if t["category_id"]:
                tx["categoryId"] = t["category_id"]
            if t["tag"]:
                tx["tag"] = t["tag"]
            if t["excluded"]:
                tx["excluded"] = True
            transactions.append(tx)

        accounts.append({
            "id":             a["id"],
            "name":           a["name"],
            "taxType":        a["tax_type"],
            "accountType":    a["account_type"],
            "openingBalance": a["opening_balance"],
            "createdAt":      a["created_at"],
            "holdings":       holdings,
            "transactions":   transactions,
        })

    # ── Categories + Subcategories ────────────────────────────────────────────
    cat_rows = con.execute(
        "SELECT * FROM categories WHERE profile_id = ? ORDER BY name",
        (profile_id,)
    ).fetchall()
    categories = []
    for c in cat_rows:
        sub_rows = con.execute(
            "SELECT * FROM subcategories WHERE category_id = ? ORDER BY name",
            (c["id"],)
        ).fetchall()
        categories.append({
            "id":            c["id"],
            "name":          c["name"],
            "subcategories": [{"id": s["id"], "name": s["name"]} for s in sub_rows],
        })

    # ── Payees ────────────────────────────────────────────────────────────────
    payee_rows = con.execute(
        "SELECT p.*, s.category_id "
        "FROM payees p "
        "LEFT JOIN subcategories s ON s.id = p.subcategory_id "
        "WHERE p.profile_id = ? "
        "ORDER BY p.name",
        (profile_id,)
    ).fetchall()
    payees = []
    for p in payee_rows:
        payee = {"id": p["id"], "name": p["name"]}
        if p["subcategory_id"]:
            payee["subcategoryId"] = p["subcategory_id"]
        if p["category_id"]:
            payee["categoryId"] = p["category_id"]
        payees.append(payee)

    con.close()
    return {"accounts": accounts, "categories": categories, "payees": payees}


def save_state(data, profile_id):
    accounts   = data.get("accounts",   [])
    categories = data.get("categories", [])
    payees     = data.get("payees",     [])

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys=ON")
    try:
        with con:
            # ── Delete this profile's data in FK-safe order ────────────────────
            account_ids = [
                row[0] for row in
                con.execute("SELECT id FROM accounts WHERE profile_id = ?", (profile_id,)).fetchall()
            ]
            if account_ids:
                ph = ",".join("?" * len(account_ids))
                con.execute(f"DELETE FROM transactions WHERE account_id IN ({ph})", account_ids)
                con.execute(f"DELETE FROM holdings    WHERE account_id IN ({ph})", account_ids)

            con.execute("DELETE FROM payees WHERE profile_id = ?", (profile_id,))

            cat_ids = [
                row[0] for row in
                con.execute("SELECT id FROM categories WHERE profile_id = ?", (profile_id,)).fetchall()
            ]
            if cat_ids:
                ph = ",".join("?" * len(cat_ids))
                con.execute(f"DELETE FROM subcategories WHERE category_id IN ({ph})", cat_ids)

            con.execute("DELETE FROM categories WHERE profile_id = ?", (profile_id,))
            con.execute("DELETE FROM accounts   WHERE profile_id = ?", (profile_id,))

            # ── Categories + Subcategories ─────────────────────────────────────
            for cat in categories:
                con.execute(
                    "INSERT INTO categories (id, name, profile_id) VALUES (?, ?, ?)",
                    (cat["id"], cat["name"], profile_id)
                )
                for sub in cat.get("subcategories", []):
                    con.execute(
                        "INSERT INTO subcategories (id, category_id, name) VALUES (?, ?, ?)",
                        (sub["id"], cat["id"], sub["name"])
                    )

            # ── Payees ─────────────────────────────────────────────────────────
            for p in payees:
                con.execute(
                    "INSERT INTO payees (id, name, subcategory_id, profile_id) VALUES (?, ?, ?, ?)",
                    (p["id"], p["name"], p.get("subcategoryId"), profile_id)
                )

            # ── Accounts + Holdings + Transactions ─────────────────────────────
            for acc in accounts:
                con.execute(
                    "INSERT INTO accounts "
                    "(id, name, tax_type, account_type, opening_balance, created_at, profile_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        acc["id"],
                        acc["name"],
                        acc["taxType"],
                        acc.get("accountType", "asset"),
                        acc.get("openingBalance", 0),
                        acc["createdAt"],
                        profile_id,
                    )
                )
                for idx, h in enumerate(acc.get("holdings", [])):
                    con.execute(
                        "INSERT INTO holdings "
                        "(id, account_id, symbol, shares, origin, asset_type, sort_order) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            h["id"],
                            acc["id"],
                            h["symbol"],
                            h["shares"],
                            h.get("origin"),
                            h.get("assetType"),
                            idx,
                        )
                    )
                for t in acc.get("transactions", []):
                    con.execute(
                        "INSERT INTO transactions "
                        "(id, account_id, date, payee_name, subcategory_id, tag, amount, excluded) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            t["id"],
                            acc["id"],
                            t["date"],
                            t["payeeName"],
                            t.get("subcategoryId"),
                            t.get("tag") or None,
                            t["amount"],
                            1 if t.get("excluded") else 0,
                        )
                    )
    finally:
        con.close()


# ── Profile Management ─────────────────────────────────────────────────────────

def get_profiles():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM profiles ORDER BY created_at").fetchall()
    con.close()
    return [{"id": r["id"], "name": r["name"], "createdAt": r["created_at"]} for r in rows]


def create_profile(name):
    profile_id = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat()
    con = sqlite3.connect(DB_PATH)
    try:
        with con:
            con.execute(
                "INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)",
                (profile_id, name.strip(), now)
            )
    finally:
        con.close()
    return {"id": profile_id, "name": name.strip(), "createdAt": now}


def rename_profile(profile_id, name):
    con = sqlite3.connect(DB_PATH)
    try:
        with con:
            con.execute("UPDATE profiles SET name = ? WHERE id = ?", (name.strip(), profile_id))
    finally:
        con.close()
    return {"id": profile_id, "name": name.strip()}


def delete_profile(profile_id):
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys=ON")
    try:
        with con:
            account_ids = [
                row[0] for row in
                con.execute("SELECT id FROM accounts WHERE profile_id = ?", (profile_id,)).fetchall()
            ]
            if account_ids:
                ph = ",".join("?" * len(account_ids))
                con.execute(f"DELETE FROM transactions WHERE account_id IN ({ph})", account_ids)
                con.execute(f"DELETE FROM holdings    WHERE account_id IN ({ph})", account_ids)

            con.execute("DELETE FROM payees WHERE profile_id = ?", (profile_id,))

            cat_ids = [
                row[0] for row in
                con.execute("SELECT id FROM categories WHERE profile_id = ?", (profile_id,)).fetchall()
            ]
            if cat_ids:
                ph = ",".join("?" * len(cat_ids))
                con.execute(f"DELETE FROM subcategories WHERE category_id IN ({ph})", cat_ids)

            con.execute("DELETE FROM categories WHERE profile_id = ?", (profile_id,))
            con.execute("DELETE FROM accounts   WHERE profile_id = ?", (profile_id,))
            con.execute("DELETE FROM profiles   WHERE id = ?", (profile_id,))
    finally:
        con.close()


# ── HTTP Handler ───────────────────────────────────────────────────────────────

class FinanceHandler(BaseHTTPRequestHandler):

    def _parse_path(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        return parsed.path, {k: v[0] for k, v in qs.items()}

    def do_GET(self):
        path, params = self._parse_path()
        if path == "/api/data":
            self._handle_get_data(params.get("profile"))
        elif path == "/api/profiles":
            self._handle_get_profiles()
        elif path == "/api/backup":
            self._handle_get_backup()
        else:
            self._serve_static(path)

    def do_POST(self):
        path, params = self._parse_path()
        if path == "/api/data":
            self._handle_post_data(params.get("profile"))
        elif path == "/api/profiles":
            self._handle_post_profiles()
        elif path == "/api/restore":
            self._handle_post_restore()
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    def do_PUT(self):
        path, _ = self._parse_path()
        parts = [p for p in path.split("/") if p]  # ["api", "profiles", "<id>"]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "profiles":
            self._handle_put_profile(parts[2])
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    def do_DELETE(self):
        path, _ = self._parse_path()
        parts = [p for p in path.split("/") if p]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "profiles":
            self._handle_delete_profile(parts[2])
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    def _handle_get_data(self, profile_id):
        if not profile_id:
            body = json.dumps({"error": "profile parameter required"}).encode("utf-8")
            self._respond(400, "application/json; charset=utf-8", body)
            return
        try:
            state = load_state(profile_id)
            body = json.dumps(state).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_post_data(self, profile_id):
        if not profile_id:
            body = json.dumps({"error": "profile parameter required"}).encode("utf-8")
            self._respond(400, "application/json; charset=utf-8", body)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw)
            save_state(data, profile_id)
            self._respond(200, "application/json; charset=utf-8", b'{"ok":true}')
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(400, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_get_profiles(self):
        try:
            body = json.dumps(get_profiles()).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_post_profiles(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw)
            name = data.get("name", "").strip()
            if not name:
                self._respond(400, "application/json; charset=utf-8",
                              b'{"error":"name is required"}')
                return
            profile = create_profile(name)
            body = json.dumps(profile).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_put_profile(self, profile_id):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw)
            name = data.get("name", "").strip()
            if not name:
                self._respond(400, "application/json; charset=utf-8",
                              b'{"error":"name is required"}')
                return
            profile = rename_profile(profile_id, name)
            body = json.dumps(profile).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_delete_profile(self, profile_id):
        try:
            all_profiles = get_profiles()
            if len(all_profiles) <= 1:
                body = json.dumps({"error": "Cannot delete the last profile."}).encode("utf-8")
                self._respond(400, "application/json; charset=utf-8", body)
                return
            delete_profile(profile_id)
            self._respond(200, "application/json; charset=utf-8", b'{"ok":true}')
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_get_backup(self):
        try:
            # Checkpoint WAL so all committed data is flushed to the main DB file
            con = sqlite3.connect(DB_PATH)
            con.execute("PRAGMA wal_checkpoint(FULL)")
            con.close()

            with open(DB_PATH, "rb") as f:
                data = f.read()

            today = datetime.date.today().strftime("%Y-%m-%d")
            filename = f"finance-tracker-backup-{today}.db"

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_post_restore(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length)

            # Validate SQLite magic bytes
            if not data.startswith(b"SQLite format 3\x00"):
                body = json.dumps({"error": "Not a valid SQLite database file."}).encode("utf-8")
                self._respond(400, "application/json; charset=utf-8", body)
                return

            # Write to a temp file and verify it opens cleanly before touching the live DB
            tmp_path = DB_PATH + ".restore_tmp"
            with open(tmp_path, "wb") as f:
                f.write(data)

            try:
                test_con = sqlite3.connect(tmp_path)
                test_con.execute("SELECT count(*) FROM sqlite_master").fetchone()
                test_con.close()
            except Exception as e:
                os.remove(tmp_path)
                body = json.dumps({"error": f"Database validation failed: {e}"}).encode("utf-8")
                self._respond(400, "application/json; charset=utf-8", body)
                return

            # Atomically replace the live DB
            os.replace(tmp_path, DB_PATH)

            # Remove stale WAL/SHM files that belong to the old database
            for suffix in ["-wal", "-shm"]:
                stale = DB_PATH + suffix
                if os.path.exists(stale):
                    os.remove(stale)

            # Apply any schema migrations to the restored database
            init_db()

            self._respond(200, "application/json; charset=utf-8", b'{"ok":true}')
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        local = os.path.normpath(os.path.join(os.getcwd(), path.lstrip("/")))
        # Prevent path traversal
        if not local.startswith(os.getcwd()):
            self._respond(403, "text/plain", b"Forbidden")
            return
        if not os.path.isfile(local):
            self._respond(404, "text/plain", b"Not Found")
            return
        ext = os.path.splitext(local)[1].lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")
        with open(local, "rb") as f:
            body = f.read()
        self._respond(200, mime, body)

    def _respond(self, code, content_type, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress per-request stdout noise


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(_get_arg("--port", 3000))
    init_db()
    server = ThreadingHTTPServer(("", port), FinanceHandler)
    print(f"Finance Tracker running at http://localhost:{port}")
    print(f"Database: {os.path.abspath(DB_PATH)}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
