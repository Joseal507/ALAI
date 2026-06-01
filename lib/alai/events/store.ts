import { db } from '../storage/db';

export function saveLearningEvent(args: {
  eventType: string;
  topic?: string;
  title?: string;
  provider?: string;
  confidence?: number | string;
  message?: string;
}) {
  const now = Date.now();
  const id = `event_${now}_${Math.random().toString(36).slice(2)}`;

  db.prepare(`
    INSERT INTO learning_events (
      id, event_type, topic, title, provider, confidence, message, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    args.eventType,
    args.topic || null,
    args.title || null,
    args.provider || null,
    args.confidence === undefined ? null : Number(args.confidence),
    args.message || null,
    now
  );

  return id;
}

export function listLearningEvents(limit = 20) {
  return db.prepare(`
    SELECT *
    FROM learning_events
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function latestLearningEvent() {
  return db.prepare(`
    SELECT *
    FROM learning_events
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
}
