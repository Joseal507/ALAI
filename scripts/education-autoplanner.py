import sqlite3, time, random, string, gzip, shutil
from pathlib import Path

DB=Path("data/alai.db")
SEED=Path("seed/alai.seed.db.gz")
now=int(time.time()*1000)

def rid(p):
    return p+"_"+str(now)+"_"+''.join(random.choice(string.ascii_lowercase+string.digits) for _ in range(8))

conn=sqlite3.connect(DB)
cur=conn.cursor()

cur.execute("CREATE TABLE IF NOT EXISTS education_nodes (id TEXT PRIMARY KEY,parent_id TEXT,stage TEXT NOT NULL,node_type TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,priority INTEGER NOT NULL,status TEXT DEFAULT 'planned',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)")
cur.execute("CREATE TABLE IF NOT EXISTS education_expansion_log (id TEXT PRIMARY KEY,stage TEXT NOT NULL,target TEXT NOT NULL,created_jobs INTEGER NOT NULL,created_at INTEGER NOT NULL)")

cols=[r[1] for r in cur.execute("PRAGMA table_info(learning_jobs)").fetchall()]
if "stage" not in cols:
    cur.execute("ALTER TABLE learning_jobs ADD COLUMN stage TEXT DEFAULT 'POST_DOCTORADO'")
if "base_priority" not in cols:
    cur.execute("ALTER TABLE learning_jobs ADD COLUMN base_priority INTEGER DEFAULT 0")

def add_job(stage, target, priority):
    topic=f"ALAI_CURRICULUM_EXPAND | stage={stage} | target={target} | task=Build complete ordered curriculum with prerequisites, subjects, units, topics, subtopics, Panama context when relevant, and universal standards."
    cur.execute("INSERT OR IGNORE INTO learning_jobs (id,topic,priority,status,created_at,updated_at,stage,base_priority) VALUES (?,?,?,?,?,?,?,?)",
        ("job_"+rid("autoedu"),topic,priority,"pending",now,now,stage,priority))

def add_node(stage,node_type,name,path,priority,parent=None):
    if cur.execute("SELECT 1 FROM education_nodes WHERE path=?",(path,)).fetchone():
        return
    cur.execute("INSERT INTO education_nodes (id,parent_id,stage,node_type,name,path,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (rid("node"),parent,stage,node_type,name,path,priority,"planned",now,now))

school=[
("PREESCOLAR",210000,["currículo completo de preescolar Panamá + universal","desarrollo socioemocional","lenguaje inicial","prematemática","motricidad","exploración del entorno"]),
("PRIMARIA",190000,["currículo completo primaria Panamá 1 a 6","matemáticas primaria","español primaria","ciencias naturales primaria","ciencias sociales Panamá primaria","inglés primaria"]),
("PREMEDIA",180000,["currículo completo premedia Panamá 7 a 9","matemáticas premedia","español premedia","ciencias naturales premedia","historia geografía cívica Panamá","tecnología"]),
("MEDIA",170000,["currículo completo media Panamá 10 a 12","bachillerato ciencias","bachillerato comercio","bachillerato letras","matemáticas media","física química biología","filosofía lógica historia literatura"])
]

faculties={
"Medicina y Salud":["Medicina","Enfermería","Odontología","Farmacia","Nutrición","Fisioterapia","Salud pública","Veterinaria"],
"Ingeniería":["Civil","Mecánica","Eléctrica","Electromecánica","Química","Industrial","Sistemas","Software","Ambiental","Biomédica","Mecatrónica"],
"Arquitectura y Diseño":["Arquitectura","Urbanismo","Diseño industrial","Diseño gráfico","Interiores","Paisajismo"],
"Ciencias":["Matemáticas","Física","Química","Biología","Geología","Astronomía","Estadística"],
"Computación e IA":["Computer Science","IA","Machine Learning","Data Science","Ciberseguridad","Redes","Bases de datos","Sistemas operativos","Robótica"],
"Economía y Negocios":["Economía","Finanzas","Contabilidad","Administración","Mercados financieros","Logística","Marketing"],
"Derecho y Política":["Derecho","Derecho constitucional","Derecho civil","Derecho penal","Derecho internacional","Ciencias políticas"],
"Humanidades":["Filosofía","Historia","Lingüística","Literatura","Ética","Artes","Música"],
"Educación":["Pedagogía","Didáctica","Currículo","Evaluación educativa","Psicología educativa","Tecnología educativa"],
"Ciencias Sociales":["Sociología","Antropología","Psicología","Comunicación","Trabajo social"]
}

created=0
for stage,prio,targets in school:
    add_node(stage,"stage",stage,stage,prio)
    for t in targets:
        add_node(stage,"curriculum_target",t,f"{stage}/{t}",prio)
        add_job(stage,t,prio); created+=1

for faculty,careers in faculties.items():
    add_node("UNIVERSIDAD","faculty",faculty,f"UNIVERSIDAD/{faculty}",130000)
    add_job("UNIVERSIDAD",f"facultad completa de {faculty}",130000); created+=1
    for c in careers:
        add_node("UNIVERSIDAD","career",c,f"UNIVERSIDAD/{faculty}/{c}",125000)
        add_job("UNIVERSIDAD",f"carrera completa de {faculty} / {c}: materias, años, prerrequisitos, laboratorios, proyectos",125000); created+=1

for stage,prio,targets in [
("MAESTRIA",90000,["maestrías por facultad","especializaciones","metodología avanzada","lectura crítica de papers","tesis de maestría"]),
("DOCTORADO",70000,["doctorados por disciplina","frontera de investigación","publicación académica","contribuciones originales","meta-análisis"]),
("POST_DOCTORADO",50000,["investigación de frontera","nuevos papers","tecnologías emergentes","conocimiento general avanzado"])
]:
    for t in targets:
        add_node(stage,"research_target",t,f"{stage}/{t}",prio)
        add_job(stage,t,prio); created+=1

cur.execute("INSERT INTO education_expansion_log VALUES (?,?,?,?,?)",(rid("log"),"ALL","auto curriculum planner",created,now))
conn.commit()
conn.close()

tmp=Path("seed/alai.seed.db")
shutil.copyfile(DB,tmp)
with open(tmp,"rb") as f,gzip.open(SEED,"wb") as z:
    shutil.copyfileobj(f,z)
tmp.unlink()
print("created expansion jobs:",created)
