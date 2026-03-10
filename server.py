import json
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DB_PATH = "finance-tracker.db"

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
            amount         REAL NOT NULL
        );
    """)
    con.commit()
    # Migrate: add opening_balance to existing databases that predate this column
    try:
        con.execute("ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0")
        con.commit()
    except sqlite3.OperationalError:
        pass  # Column already exists
    con.close()


def load_state():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    # ── Accounts + Holdings + Transactions ────────────────────────────────────
    accounts_rows = con.execute(
        "SELECT * FROM accounts ORDER BY created_at"
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
    cat_rows = con.execute("SELECT * FROM categories ORDER BY name").fetchall()
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
        "ORDER BY p.name"
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


def save_state(data):
    accounts    = data.get("accounts",   [])
    categories  = data.get("categories", [])
    payees      = data.get("payees",     [])

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys=ON")
    try:
        with con:
            # ── Delete in FK-safe order ────────────────────────────────────
            con.execute("DELETE FROM transactions")
            con.execute("DELETE FROM payees")
            con.execute("DELETE FROM subcategories")
            con.execute("DELETE FROM categories")
            con.execute("DELETE FROM holdings")
            con.execute("DELETE FROM accounts")

            # ── Categories + Subcategories (must come before transactions) ─
            for cat in categories:
                con.execute(
                    "INSERT INTO categories (id, name) VALUES (?, ?)",
                    (cat["id"], cat["name"])
                )
                for sub in cat.get("subcategories", []):
                    con.execute(
                        "INSERT INTO subcategories (id, category_id, name) VALUES (?, ?, ?)",
                        (sub["id"], cat["id"], sub["name"])
                    )

            # ── Payees (after subcategories) ───────────────────────────────
            for p in payees:
                con.execute(
                    "INSERT INTO payees (id, name, subcategory_id) VALUES (?, ?, ?)",
                    (p["id"], p["name"], p.get("subcategoryId"))
                )

            # ── Accounts + Holdings + Transactions ─────────────────────────
            for acc in accounts:
                con.execute(
                    "INSERT INTO accounts (id, name, tax_type, account_type, opening_balance, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        acc["id"],
                        acc["name"],
                        acc["taxType"],
                        acc.get("accountType", "asset"),
                        acc.get("openingBalance", 0),
                        acc["createdAt"],
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
                        "(id, account_id, date, payee_name, subcategory_id, tag, amount) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            t["id"],
                            acc["id"],
                            t["date"],
                            t["payeeName"],
                            t.get("subcategoryId"),
                            t.get("tag") or None,
                            t["amount"],
                        )
                    )
    finally:
        con.close()


# ── HTTP Handler ───────────────────────────────────────────────────────────────

class FinanceHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            self._handle_get_data()
        else:
            self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            self._handle_post_data()
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    def _handle_get_data(self):
        try:
            state = load_state()
            body = json.dumps(state).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(500, "application/json; charset=utf-8", body)

    def _handle_post_data(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw)
            save_state(data)
            self._respond(200, "application/json; charset=utf-8", b'{"ok":true}')
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self._respond(400, "application/json; charset=utf-8", body)
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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
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
