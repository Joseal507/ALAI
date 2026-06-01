import LiveDashboard from './LiveDashboard';

async function getSystemStatus() {
  try {
    const base = process.env.NEXT_PUBLIC_ALAI_BASE_URL || 'http://localhost:6969';
    const res = await fetch(`${base}/api/system/status`, { cache: 'no-store' });
    if (!res.ok) throw new Error('status failed');
    return await res.json();
  } catch {
    return {
      success: false,
      status: 'offline',
      knowledge: 0,
      edges: 0,
      queue: { pending: 0, running: 0, completed: 0, failed: 0 },
      latestKnowledge: [],
      latestJobs: [],
      latestEvent: null,
      researchMissions: [],
      gaps: [],
      learningChain: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export default async function Home() {
  const status = await getSystemStatus();

  return (
    <main className="simplePage">
      <section className="simpleHero">
        <div className="topLine">
          <span className="liveDot" />
          <b>ALAI CORE ONLINE</b>
        </div>

        <h1>advancelogic</h1>
        <h2>ALAI SYSTEM</h2>

        <p>
          ALAI aprende sola: detecta huecos, crea misiones, estudia, verifica,
          guarda conocimiento y decide el próximo tema.
        </p>
      </section>

      <LiveDashboard initialStatus={status} />
    </main>
  );
}
