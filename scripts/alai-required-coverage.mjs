import Database from 'better-sqlite3';
import fs from 'fs';
import zlib from 'zlib';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(sql) {
  try { db.exec(sql); } catch {}
}

safe(`ALTER TABLE learning_jobs ADD COLUMN stage TEXT DEFAULT 'POST_DOCTORADO';`);
safe(`ALTER TABLE learning_jobs ADD COLUMN base_priority INTEGER DEFAULT 0;`);
safe(`ALTER TABLE learning_jobs ADD COLUMN source TEXT DEFAULT 'auto';`);

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

CREATE TABLE IF NOT EXISTS education_required_coverage (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  required INTEGER NOT NULL DEFAULT 1,
  mastery_required INTEGER NOT NULL DEFAULT 90,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
}

const getNode = db.prepare(`SELECT id FROM education_nodes WHERE path=?`);

const addNode = db.prepare(`
INSERT OR IGNORE INTO education_nodes
(id,parent_id,stage,node_type,name,path,priority,status,created_at,updated_at)
VALUES (@id,@parent_id,@stage,@node_type,@name,@path,@priority,'planned',@created_at,@updated_at)
`);

const addCoverage = db.prepare(`
INSERT OR IGNORE INTO education_required_coverage
(id,stage,path,required,mastery_required,created_at,updated_at)
VALUES (@id,@stage,@path,1,90,@created_at,@updated_at)
`);

const addJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id,topic,priority,status,created_at,updated_at,stage,base_priority,source)
VALUES (@id,@topic,@priority,'pending',@created_at,@updated_at,@stage,@base_priority,'required_coverage')
`);

function node(stage, type, name, path, priority, parentPath = null) {
  const existing = getNode.get(path);
  if (existing) return existing.id;
  const parent = parentPath ? getNode.get(parentPath)?.id || null : null;
  const nid = id('node');
  addNode.run({ id:nid, parent_id:parent, stage, node_type:type, name, path, priority, created_at:now, updated_at:now });
  return nid;
}

function required(stage, subject, unit, topic) {
  const subjectPath = `${stage}/${subject}`;
  const unitPath = `${subjectPath}/${unit}`;
  const topicPath = `${unitPath}/${topic}`;
  node(stage, 'subject', subject, subjectPath, 220000, stage);
  node(stage, 'unit', unit, unitPath, 220000, subjectPath);
  node(stage, 'required_topic', topic, topicPath, 220000, unitPath);
  addCoverage.run({ id:id('cov'), stage, path:topicPath, created_at:now, updated_at:now });
  addJob.run({
    id:id('job'),
    topic:`ALAI_LEARN_TOPIC | stage=${stage} | path=${topicPath} | target=${topic} | mastery_required=90 | task=Learn this exact required topic completely, with explanation, examples, mistakes, exercises, prerequisites, and assessment.`,
    priority:220000,
    created_at:now,
    updated_at:now,
    stage,
    base_priority:220000
  });
}

const preescolar = {
  'Lenguaje inicial': {
    'Sonidos y habla': ['sonidos del lenguaje','escuchar instrucciones simples','pronunciar palabras básicas','vocabulario cotidiano'],
    'Prelectura': ['cuentos cortos','personajes y lugares','secuencia inicio medio final','rimas infantiles'],
    'Abecedario': ['vocales','consonantes','reconocer letras','sonido inicial de palabras','nombre propio'],
    'Preescritura': ['trazos rectos','trazos curvos','direccionalidad izquierda derecha','agarre del lápiz']
  },
  'Prematemática': {
    'Números': ['conteo 1 al 10','conteo 1 al 20','cantidad y número','más y menos','igual y diferente'],
    'Formas': ['círculo','cuadrado','triángulo','rectángulo','clasificar formas'],
    'Colores': ['rojo','azul','amarillo','verde','blanco','negro','clasificar por color'],
    'Patrones': ['patrones simples','ordenar por tamaño','grande mediano pequeño','antes y después']
  },
  'Desarrollo socioemocional': {
    'Identidad': ['mi nombre','mi cuerpo','mi familia','mis gustos','autonomía básica'],
    'Emociones': ['alegría','tristeza','enojo','miedo','expresar emociones','regular emociones'],
    'Convivencia': ['compartir','esperar turno','pedir ayuda','seguir reglas','respeto']
  },
  'Exploración del entorno': {
    'Escuela': ['qué es la escuela','personas de la escuela','salón de clases','útiles escolares','rutinas escolares'],
    'Comunidad': ['familia','casa','vecindario','oficios básicos','seguridad vial básica'],
    'Naturaleza': ['animales','plantas','agua','clima','día y noche']
  },
  'Motricidad': {
    'Motricidad gruesa': ['caminar','correr','saltar','equilibrio','coordinación corporal'],
    'Motricidad fina': ['recortar','pegar','colorear','ensartar','modelar plastilina']
  },
  'Arte y juego': {
    'Expresión': ['dibujo libre','canciones infantiles','ritmo básico','juego simbólico','creatividad']
  }
};

for (const [subject, units] of Object.entries(preescolar)) {
  for (const [unit, topics] of Object.entries(units)) {
    for (const topic of topics) {
      required('PREESCOLAR', subject, unit, topic);
    }
  }
}

fs.mkdirSync('seed', { recursive: true });
fs.copyFileSync('data/alai.db', 'seed/alai.seed.db');
fs.writeFileSync('seed/alai.seed.db.gz', zlib.gzipSync(fs.readFileSync('seed/alai.seed.db')));
fs.unlinkSync('seed/alai.seed.db');

console.log('✅ Required coverage PREESCOLAR creada.');
