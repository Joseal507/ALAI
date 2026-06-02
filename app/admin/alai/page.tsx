async function getData() {
  const res = await fetch('http://localhost:6969/api/admin/alai/status', { cache: 'no-store' });
  return res.json();
}

export default async function AlaiAdminPage() {
  const data = await getData();

  return (
    <main style={{ minHeight: '100vh', padding: 32, background: '#070707', color: '#f5f5f5', fontFamily: 'Inter, system-ui' }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>ALAI Knowledge Control</h1>
      <p style={{ color: '#aaa', marginBottom: 32 }}>Dashboard de control para ver qué está estudiando, qué sabe y qué falta.</p>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16, marginBottom: 32 }}>
        <div style={card}>
          <div style={label}>Nivel activo</div>
          <div style={big}>{data.control.active_stage}</div>
        </div>
        <div style={card}>
          <div style={label}>Modo</div>
          <div style={big}>{data.control.mode}</div>
        </div>
        <div style={card}>
          <div style={label}>Chat priority</div>
          <div style={big}>{data.control.chat_priority_enabled ? 'ON' : 'OFF'}</div>
        </div>
      </section>

      <section style={card}>
        <h2>Progreso educativo</h2>
        {data.progress.map((p: any) => (
          <div key={p.stage} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{p.stage}</strong>
              <span>{p.pct}% · completed {p.completed}/{p.total} · pending {p.pending} · failed {p.failed}</span>
            </div>
            <div style={{ height: 10, background: '#222', borderRadius: 999 }}>
              <div style={{ width: `${p.pct}%`, height: 10, background: '#d4af37', borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={card}>
          <h2>Knowledge</h2>
          {Object.entries(data.knowledge).map(([k, v]) => (
            <div key={k} style={row}><span>{k}</span><strong>{String(v)}</strong></div>
          ))}
          <div style={row}><span>confidence avg</span><strong>{data.confidence.avg || 0}</strong></div>
        </div>

        <div style={card}>
          <h2>Curriculum OS</h2>
          {data.nodes.map((n: any, i: number) => (
            <div key={i} style={row}><span>{n.stage} / {n.node_type}</span><strong>{n.total}</strong></div>
          ))}
        </div>
      </section>

      <section style={{ ...card, marginTop: 16 }}>
        <h2>Próximos aprendizajes</h2>
        {data.nextJobs.map((j: any, i: number) => (
          <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid #222' }}>
            <div style={{ color: '#d4af37', fontWeight: 700 }}>{i + 1}. [{j.stage}] p={j.priority}</div>
            <div style={{ color: '#ddd' }}>{j.topic}</div>
          </div>
        ))}
      </section>
    </main>
  );
}

const card = {
  background: '#111',
  border: '1px solid #242424',
  borderRadius: 18,
  padding: 20,
  boxShadow: '0 12px 30px rgba(0,0,0,.25)'
} as const;

const label = {
  color: '#999',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: 1
} as const;

const big = {
  fontSize: 26,
  fontWeight: 800,
  marginTop: 8
} as const;

const row = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid #222'
} as const;
