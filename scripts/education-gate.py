import sqlite3, time, gzip, shutil
from pathlib import Path

DB = Path("data/alai.db")
SEED = Path("seed/alai.seed.db.gz")
now = int(time.time() * 1000)

STAGES = [
    ("PREESCOLAR", 210000),
    ("PRIMARIA", 190000),
    ("PREMEDIA", 180000),
    ("MEDIA", 170000),
    ("UNIVERSIDAD", 130000),
    ("MAESTRIA", 90000),
    ("DOCTORADO", 70000),
    ("POST_DOCTORADO", 50000),
]

conn = sqlite3.connect(DB)
cur = conn.cursor()

for col, default in [("stage", "'POST_DOCTORADO'"), ("base_priority", "0")]:
    cols = [r[1] for r in cur.execute("PRAGMA table_info(learning_jobs)").fetchall()]
    if col not in cols:
        cur.execute(f"ALTER TABLE learning_jobs ADD COLUMN {col} TEXT DEFAULT {default}" if col == "stage" else f"ALTER TABLE learning_jobs ADD COLUMN {col} INTEGER DEFAULT {default}")

cur.execute("""
CREATE TABLE IF NOT EXISTS education_control (
  id TEXT PRIMARY KEY,
  active_stage TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'education_first',
  updated_at INTEGER NOT NULL
)
""")

cur.execute("UPDATE learning_jobs SET stage='POST_DOCTORADO' WHERE stage IS NULL OR stage=''")

for stage, base in STAGES:
    cur.execute("""
    UPDATE learning_jobs
    SET stage=?, base_priority=CASE WHEN base_priority IS NULL OR base_priority=0 THEN ? ELSE base_priority END, updated_at=?
    WHERE topic LIKE ?
    """, (stage, base, now, f"%stage={stage}%"))

cur.execute("""
UPDATE learning_jobs
SET priority=0, updated_at=?
WHERE stage IN ('PREESCOLAR','PRIMARIA','PREMEDIA','MEDIA','UNIVERSIDAD','MAESTRIA','DOCTORADO','POST_DOCTORADO')
AND status='pending'
""", (now,))

active_stage = "POST_DOCTORADO"

for stage, base in STAGES:
    remaining = cur.execute("""
    SELECT COUNT(*) FROM learning_jobs
    WHERE stage=? AND status!='completed'
    """, (stage,)).fetchone()[0]
    if remaining > 0:
        active_stage = stage
        break

cur.execute("""
UPDATE learning_jobs
SET priority=CASE WHEN base_priority > 0 THEN base_priority ELSE ? END, updated_at=?
WHERE stage=? AND status='pending'
""", (dict(STAGES)[active_stage], now, active_stage))

cur.execute("""
UPDATE learning_jobs
SET priority=999999, stage='CHAT_PRIORITY', updated_at=?
WHERE status='pending'
AND (
  topic LIKE 'CHAT_REQUEST |%'
  OR topic LIKE 'USER_QUESTION |%'
)
""", (now,))

cur.execute("""
INSERT INTO education_control (id, active_stage, mode, updated_at)
VALUES ('main', ?, 'education_first', ?)
ON CONFLICT(id) DO UPDATE SET
active_stage=excluded.active_stage,
mode='education_first',
updated_at=excluded.updated_at
""", (active_stage, now))

conn.commit()

print("=== ALAI EDUCATION GATE ===")
print("active_stage:", active_stage)
print("Top pending:")
for row in cur.execute("""
SELECT stage, topic, priority
FROM learning_jobs
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 20
"""):
    print(row)

conn.close()

Path("seed").mkdir(exist_ok=True)
tmp = Path("seed/alai.seed.db")
shutil.copyfile(DB, tmp)
with open(tmp, "rb") as f_in, gzip.open(SEED, "wb") as f_out:
    shutil.copyfileobj(f_in, f_out)
tmp.unlink()
