import sqlite3, time, gzip, shutil
from pathlib import Path

DB=Path("data/alai.db")
SEED=Path("seed/alai.seed.db.gz")
now=int(time.time()*1000)

STAGES=[
("PREESCOLAR","PREESCOLAR",200000),
("PRIMARIA","PRIMARIA",190000),
("PREMEDIA","PREMEDIA",180000),
("MEDIA","MEDIA",170000),
("UNIVERSIDAD","UNIVERSIDAD",120000),
("MAESTRIA","MAESTRIA",90000),
("DOCTORADO","DOCTORADO",70000),
]

conn=sqlite3.connect(DB)
cur=conn.cursor()

cols=[r[1] for r in cur.execute("PRAGMA table_info(learning_jobs)").fetchall()]
if "stage" not in cols:
    cur.execute("ALTER TABLE learning_jobs ADD COLUMN stage TEXT DEFAULT 'POST_DOCTORADO'")
if "base_priority" not in cols:
    cur.execute("ALTER TABLE learning_jobs ADD COLUMN base_priority INTEGER DEFAULT 0")

cur.execute("CREATE TABLE IF NOT EXISTS education_control (id TEXT PRIMARY KEY, active_stage TEXT NOT NULL, updated_at INTEGER NOT NULL)")

cur.execute("UPDATE learning_jobs SET stage='POST_DOCTORADO' WHERE stage IS NULL OR stage=''")

for stage,key,base in STAGES:
    cur.execute("UPDATE learning_jobs SET stage=?, base_priority=CASE WHEN base_priority IS NULL OR base_priority=0 THEN ? ELSE base_priority END, updated_at=? WHERE topic LIKE ?",
        (stage,base,now,"%"+key+"%"))

cur.execute("UPDATE learning_jobs SET priority=0, updated_at=? WHERE stage IN ('PREESCOLAR','PRIMARIA','PREMEDIA','MEDIA','UNIVERSIDAD','MAESTRIA','DOCTORADO') AND status='pending'",(now,))

active="POST_DOCTORADO"
for stage,key,base in STAGES:
    left=cur.execute("SELECT COUNT(*) FROM learning_jobs WHERE stage=? AND status!='completed'",(stage,)).fetchone()[0]
    if left>0:
        active=stage
        break

if active!="POST_DOCTORADO":
    cur.execute("UPDATE learning_jobs SET priority=CASE WHEN base_priority>0 THEN base_priority ELSE priority END, updated_at=? WHERE stage=? AND status='pending'",(now,active))
    cur.execute("UPDATE learning_jobs SET priority=80, updated_at=? WHERE stage='POST_DOCTORADO' AND status='pending' AND priority>80 AND priority<999",(now,))

cur.execute("UPDATE learning_jobs SET priority=999999, stage='CHAT_PRIORITY', updated_at=? WHERE status='pending' AND priority>=999",(now,))
cur.execute("INSERT INTO education_control VALUES ('main',?,?) ON CONFLICT(id) DO UPDATE SET active_stage=excluded.active_stage, updated_at=excluded.updated_at",(active,now))

conn.commit()
print("active_stage:",active)
for r in cur.execute("SELECT stage,topic,priority FROM learning_jobs WHERE status='pending' ORDER BY priority DESC LIMIT 15"):
    print(r)
conn.close()

tmp=Path("seed/alai.seed.db")
shutil.copyfile(DB,tmp)
with open(tmp,"rb") as f,gzip.open(SEED,"wb") as z:
    shutil.copyfileobj(f,z)
tmp.unlink()
