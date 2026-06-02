import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS education_required_coverage (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const topics = [
  ['PREMEDIA','Matemáticas','Números y álgebra','enteros'],
  ['PREMEDIA','Matemáticas','Números y álgebra','fracciones y decimales'],
  ['PREMEDIA','Matemáticas','Álgebra','expresiones algebraicas'],
  ['PREMEDIA','Matemáticas','Geometría','ángulos'],
  ['PREMEDIA','Matemáticas','Geometría','área y volumen'],
  ['PREMEDIA','Español','Lectura','comprensión de textos'],
  ['PREMEDIA','Español','Escritura','redacción de párrafos'],
  ['PREMEDIA','Español','Gramática','categorías gramaticales'],
  ['PREMEDIA','Ciencias Naturales','Biología','célula'],
  ['PREMEDIA','Ciencias Naturales','Física básica','fuerza y movimiento'],
  ['PREMEDIA','Ciencias Naturales','Química básica','materia y cambios'],
  ['PREMEDIA','Historia y Geografía','Historia','Panamá y América'],
  ['PREMEDIA','Historia y Geografía','Geografía','mapas y regiones'],
  ['PREMEDIA','Cívica','Ciudadanía','derechos y deberes'],

  ['MEDIA','Matemáticas','Álgebra','ecuaciones lineales'],
  ['MEDIA','Matemáticas','Álgebra','funciones'],
  ['MEDIA','Matemáticas','Geometría','geometría analítica'],
  ['MEDIA','Matemáticas','Estadística','probabilidad'],
  ['MEDIA','Español','Literatura','análisis literario'],
  ['MEDIA','Español','Escritura','ensayo argumentativo'],
  ['MEDIA','Biología','Genética','ADN y herencia'],
  ['MEDIA','Biología','Ecología','ecosistemas'],
  ['MEDIA','Física','Mecánica','cinemática'],
  ['MEDIA','Física','Mecánica','dinámica'],
  ['MEDIA','Química','Estructura atómica','átomos y moléculas'],
  ['MEDIA','Química','Reacciones','balanceo de ecuaciones'],
  ['MEDIA','Historia','Historia universal','edad moderna'],
  ['MEDIA','Geografía','Geografía humana','población y territorio'],
  ['MEDIA','Cívica','Estado y democracia','constitución y ciudadanía']
];

const insertCoverage = db.prepare(`
INSERT OR IGNORE INTO education_required_coverage
(id, stage, path, topic, completed, confidence, created_at, updated_at)
VALUES (@id, @stage, @path, @topic, 0, 0, @now, @now)
`);

const insertJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id, topic, priority, status, created_at, updated_at, stage, base_priority, source)
VALUES (@id, @topic, @priority, 'pending', @now, @now, @stage, @priority, 'required_coverage')
`);

function slug(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0, 80);
}

for (const [stage, subject, unit, topic] of topics) {
  const path = `${stage}/${subject}/${unit}/${topic}`;
  const id = `${stage}_${slug(subject)}_${slug(unit)}_${slug(topic)}`;
  const priority = stage === 'PREMEDIA' ? 180000 : 170000;

  insertCoverage.run({ id, stage, path, topic, now });

  insertJob.run({
    id: `job_${id}`,
    stage,
    priority,
    now,
    topic: `ALAI_LEARN_TOPIC | stage=${stage} | path=${path} | target=${topic} | mastery_required=90 | task=Learn this exact required topic completely, with explanation, examples, mistakes, exercises, prerequisites, and assessment.`
  });
}

console.log('Added PREMEDIA/MEDIA required coverage:', topics.length);
db.close();
