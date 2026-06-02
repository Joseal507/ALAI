import Database from 'better-sqlite3';
import fs from 'fs';
import zlib from 'zlib';

const db = new Database('data/alai.db');
const now = Date.now();

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
}

function safe(sql) {
  try { db.exec(sql); } catch (e) {}
}

safe(`ALTER TABLE learning_jobs ADD COLUMN stage TEXT DEFAULT 'POST_DOCTORADO'`);
safe(`ALTER TABLE learning_jobs ADD COLUMN base_priority INTEGER DEFAULT 0`);
safe(`ALTER TABLE knowledge_units ADD COLUMN education_node_id TEXT DEFAULT ''`);
safe(`ALTER TABLE knowledge_units ADD COLUMN mastery_score INTEGER DEFAULT 0`);

db.exec(`
CREATE TABLE IF NOT EXISTS education_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  stage TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  mastery_score INTEGER NOT NULL DEFAULT 0,
  coverage_score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS education_prerequisites (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  prerequisite_node_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS education_assessments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  assessment_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS education_control (
  id TEXT PRIMARY KEY,
  active_stage TEXT NOT NULL,
  mode TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function id(prefix) {
  return `${prefix}_${now}_${Math.random().toString(36).slice(2,10)}`;
}

const insertNode = db.prepare(`
INSERT OR IGNORE INTO education_nodes
(id,parent_id,stage,node_type,name,path,priority,status,created_at,updated_at)
VALUES (@id,@parent_id,@stage,@node_type,@name,@path,@priority,'planned',@created_at,@updated_at)
`);

const insertJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id,topic,priority,status,created_at,updated_at,stage,base_priority)
VALUES (@id,@topic,@priority,'pending',@created_at,@updated_at,@stage,@base_priority)
`);

function node(stage, type, name, path, priority, parent = null) {
  const existing = db.prepare(`SELECT id FROM education_nodes WHERE path=?`).get(path);
  if (existing) return existing.id;
  const nid = id('node');
  insertNode.run({id:nid,parent_id:parent,stage,node_type:type,name,path,priority,created_at:now,updated_at:now});
  return nid;
}

function curriculumJob(stage, target, priority, path) {
  const topic =
    `ALAI_CURRICULUM_EXPAND | stage=${stage} | path=${path} | target=${target} | ` +
    `task=Build the full academic map: courses, units, topics, subtopics, prerequisites, examples, exercises, assessments, Panama context when relevant, and universal standards.`;
  insertJob.run({id:id('job'),topic,priority,status:'pending',created_at:now,updated_at:now,stage,base_priority:priority});
}

db.prepare(`DELETE FROM learning_jobs WHERE topic LIKE 'ALAI_CURRICULUM_EXPAND%'`).run();
db.prepare(`DELETE FROM education_nodes`).run();
db.prepare(`DELETE FROM education_prerequisites`).run();
db.prepare(`DELETE FROM education_assessments`).run();

const stages = [
  ['PREESCOLAR', 210000],
  ['PRIMARIA', 190000],
  ['PREMEDIA', 180000],
  ['MEDIA', 170000],
  ['UNIVERSIDAD', 130000],
  ['MAESTRIA', 90000],
  ['DOCTORADO', 70000],
  ['POST_DOCTORADO', 50000]
];

for (const [stage, priority] of stages) {
  node(stage, 'stage', stage, stage, priority);
}

const school = {
  PREESCOLAR: ['Desarrollo socioemocional','Lenguaje inicial','Prematemática','Motricidad','Exploración del entorno','Arte y juego'],
  PRIMARIA: ['Matemáticas','Español','Ciencias Naturales','Ciencias Sociales Panamá','Inglés','Arte','Música','Educación Física','Tecnología básica'],
  PREMEDIA: ['Matemáticas','Español','Ciencias Naturales','Historia y Geografía','Cívica','Inglés','Tecnología','Arte','Educación Física'],
  MEDIA: ['Matemáticas','Física','Química','Biología','Español y Literatura','Historia','Geografía','Filosofía','Lógica','Economía','Informática','Inglés']
};

for (const [stage, subjects] of Object.entries(school)) {
  const stageNode = node(stage, 'stage', stage, stage, stages.find(s=>s[0]===stage)[1]);
  for (const subject of subjects) {
    const path = `${stage}/${subject}`;
    node(stage, 'subject', subject, path, stages.find(s=>s[0]===stage)[1], stageNode);
    curriculumJob(stage, subject, stages.find(s=>s[0]===stage)[1], path);
  }
}

const faculties = {
  'Medicina y Ciencias de la Salud': ['Medicina','Enfermería','Odontología','Farmacia','Nutrición','Fisioterapia','Salud Pública','Veterinaria','Tecnología Médica'],
  'Ingeniería': ['Ingeniería Civil','Ingeniería Mecánica','Ingeniería Eléctrica','Ingeniería Electromecánica','Ingeniería Química','Ingeniería Industrial','Ingeniería de Sistemas','Ingeniería de Software','Ingeniería Ambiental','Ingeniería Biomédica','Ingeniería Mecatrónica'],
  'Arquitectura y Diseño': ['Arquitectura','Urbanismo','Construcción','Diseño Industrial','Diseño Gráfico','Diseño de Interiores','Paisajismo'],
  'Ciencias Naturales y Matemáticas': ['Matemáticas','Física','Química','Biología','Geología','Astronomía','Estadística','Ciencias Ambientales'],
  'Computación e IA': ['Computer Science','Inteligencia Artificial','Machine Learning','Data Science','Ciberseguridad','Redes','Bases de Datos','Sistemas Operativos','Robótica'],
  'Economía Finanzas y Negocios': ['Economía','Finanzas','Contabilidad','Administración','Mercados Financieros','Logística','Marketing','Comercio Internacional'],
  'Derecho y Política': ['Derecho','Derecho Constitucional','Derecho Civil','Derecho Penal','Derecho Internacional','Ciencias Políticas','Relaciones Internacionales'],
  'Humanidades': ['Filosofía','Historia','Lingüística','Literatura','Ética','Artes','Música'],
  'Educación': ['Pedagogía','Didáctica','Currículo','Evaluación Educativa','Psicología Educativa','Tecnología Educativa','Educación Especial'],
  'Ciencias Sociales': ['Sociología','Antropología','Psicología','Comunicación','Trabajo Social','Geografía Humana']
};

const uni = node('UNIVERSIDAD','stage','UNIVERSIDAD','UNIVERSIDAD',130000);
for (const [faculty, careers] of Object.entries(faculties)) {
  const fpath = `UNIVERSIDAD/${faculty}`;
  const fid = node('UNIVERSIDAD','faculty',faculty,fpath,130000,uni);
  curriculumJob('UNIVERSIDAD',`facultad completa de ${faculty}`,130000,fpath);
  for (const career of careers) {
    const cpath = `${fpath}/${career}`;
    node('UNIVERSIDAD','career',career,cpath,125000,fid);
    curriculumJob('UNIVERSIDAD',`carrera completa de ${career}`,125000,cpath);
  }
}

for (const [stage, targets, priority] of [
  ['MAESTRIA',['maestrías por facultad','especializaciones profesionales','metodología de investigación avanzada','tesis de maestría','lectura crítica de papers'],90000],
  ['DOCTORADO',['doctorados por disciplina','frontera de investigación','publicación académica','contribuciones originales','revisión sistemática y meta-análisis'],70000],
  ['POST_DOCTORADO',['investigación de frontera','papers nuevos','tecnologías emergentes','actualidad mundial','conocimiento general avanzado'],50000]
]) {
  const root = node(stage,'stage',stage,stage,priority);
  for (const target of targets) {
    const path = `${stage}/${target}`;
    node(stage,'research_area',target,path,priority,root);
    curriculumJob(stage,target,priority,path);
  }
}

db.prepare(`
INSERT INTO education_control (id,active_stage,mode,updated_at)
VALUES ('main','PREESCOLAR','education_first',?)
ON CONFLICT(id) DO UPDATE SET active_stage='PREESCOLAR', mode='education_first', updated_at=excluded.updated_at
`).run(now);

const tmp = 'seed/alai.seed.db';
await db.backup(tmp);
db.close();

const input = fs.readFileSync(tmp);
fs.writeFileSync('seed/alai.seed.db.gz', zlib.gzipSync(input));
fs.unlinkSync(tmp);

console.log('✅ Curriculum OS listo');
