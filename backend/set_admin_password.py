#!/usr/bin/env python3
"""Set a tenant admin password. Usage: python3 set_admin_password.py '<password>' [username]"""
import sys, os
import psycopg2
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

pw = sys.argv[1] if len(sys.argv) > 1 else "FaceTrack#2026"
user = sys.argv[2] if len(sys.argv) > 2 else "admin"

url = os.getenv("DATABASE_URL")
if not url:
    sys.exit("DATABASE_URL not set (.env missing?)")

conn = psycopg2.connect(url)
cur = conn.cursor()
cur.execute("UPDATE companies SET admin_password_hash=%s WHERE admin_username=%s",
            (generate_password_hash(pw), user))
conn.commit()
rows = cur.rowcount
# verify
cur.execute("SELECT admin_password_hash FROM companies WHERE admin_username=%s", (user,))
row = cur.fetchone()
ok = bool(row) and check_password_hash(row[0], pw)
conn.close()
print(f"updated {rows} row(s) for '{user}'  |  password verifies: {ok}")
if not rows:
    print(f"  NOTE: no company with admin_username='{user}'. Try: admin | iaa | sabri")
