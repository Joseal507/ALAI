export function cleanAlaiTarget(raw: any): string {
  let s = String(raw || '').trim();

  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^ALAI_REINFORCE_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^ALAI_LEARN_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');

  s = s.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task|reason):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').slice(0, 140);
}

export function shouldRejectTarget(raw: any): boolean {
  const s = String(raw || '').toLowerCase();
  if (!s.trim()) return true;
  if (s.includes('[object object]')) return true;
  if (s.length > 600) return true;
  return false;
}
