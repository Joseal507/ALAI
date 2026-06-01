'use client';

import { useEffect, useState } from 'react';

export default function LiveDashboard({ initialStatus }: { initialStatus: any }) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system/status', { cache: 'no-store' });
        const data = await res.json();
        setStatus(data);
      } catch {}
    };

    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const activeJob =
    status.latestJobs?.find((j: any) => j.status === 'running') ||
    status.latestJobs?.[0];

  const latestKnowledge = status.latestKnowledge?.[0];
  const currentMission = status.researchMissions?.find((m: any) =>
    activeJob?.topic && m.topic?.toLowerCase() === activeJob.topic.toLowerCase()
  );

  const chatMission = status.researchMissions?.find((m: any) =>
    m.reason?.includes('Created from chat')
  ) || null;

  const topMission = currentMission || status.researchMissions?.[0];
  const nextConcept =
    status.learningChain?.[0]?.target_title ||
    status.gaps?.[0]?.target_title ||
    status.researchMissions?.[1]?.topic;

  return (
    <>
      <section className="statusStrip">
        <div className="miniStat"><span>Knowledge</span><b>{status.knowledge}</b></div>
        <div className="miniStat"><span>Pending</span><b>{status.queue.pending}</b></div>
        <div className="miniStat"><span>Running</span><b>{status.queue.running}</b></div>
        <div className="miniStat"><span>Completed</span><b>{status.queue.completed}</b></div>
        <div className="miniStat"><span>Claims</span><b>{status.claimsCount || 0}</b></div>
        <div className="miniStat"><span>Conflicts</span><b>{status.pendingConflicts || 0}</b></div>
        <div className="miniStat">
          <span>Verified</span>
          <b>{status.claimVerification?.verifiedClaims || 0}/{status.claimVerification?.totalClaims || 0}</b>
        </div>
        <div className="miniStat"><span>Integrity</span><b>{status.systemIntegrity || 'Clean'}</b></div>
      </section>


      <section className="nowCard">
        <div className="nowBadge">KNOWLEDGE HEALTH</div>

        <div className="cleanFlow">
          <div><span>🧠</span><b>{status.health?.knowledge || 0}</b><p>Knowledge</p></div>
          <div><span>🧾</span><b>{status.health?.claims || 0}</b><p>Claims</p></div>
          <div><span>✅</span><b>{status.health?.verified || 0}</b><p>Verified</p></div>
          <div><span>🔗</span><b>{status.health?.inferences || 0}</b><p>Inferences</p></div>
          <div><span>⚖️</span><b>{status.health?.conflicts || 0}</b><p>Conflicts</p></div>
          <div><span>💚</span><b>{status.health?.healthScore || 0}%</b><p>Health</p></div>
          <div><span>🏆</span><b>{status.learningQuality?.averageScore || 0}</b><p>Quality</p></div>
        </div>
      </section>

      <section className="nowCard">
        {chatMission && (
          <div className="chatMissionAlert">
            <span>CHAT MISSION WAITING</span>
            <b>{chatMission.topic}</b>
            <p>ALAI no sabía esto. Ya lo puso en cola para aprenderlo cuando le toque por prioridad.</p>
          </div>
        )}

        <div className="nowBadge">LIVE · AUTO UPDATING</div>

        <div className={activeJob?.status === 'running' ? 'studyingNow activeStudy' : 'studyingNow'}>
          <div className="studyOrb"><span /></div>

          <div>
            <span className="studyLabel">
              {activeJob?.status === 'running' ? 'NOW STUDYING' : 'LAST LEARNED'}
            </span>

            <h3>
              {activeJob?.status === 'running'
                ? activeJob.topic
                : latestKnowledge?.title || 'Esperando aprendizaje'}
            </h3>

            <p>
              {activeJob?.status === 'running'
                ? 'ALAI está investigando, preguntando teachers, verificando y guardando conocimiento.'
                : 'ALAI terminó este tema y está esperando el siguiente ciclo.'}
            </p>
          </div>
        </div>

        <div className="cleanFlow">
          <div><span>1</span><b>Reason</b><p>{currentMission?.reason || 'Picked from queue by priority.'}</p></div>
          <i>→</i>
          <div><span>2</span><b>Learning</b><p>{activeJob?.topic || 'No active job'}</p></div>
          <i>→</i>
          <div><span>3</span><b>Saved</b><p>{latestKnowledge?.title || 'Nothing saved yet'}</p></div>
          <i>→</i>
          <div><span>4</span><b>Next</b><p>{nextConcept || 'No next concept yet'}</p></div>
        </div>
      </section>

      <section className="threeCards">
        <div className="infoCard">
          <span>Último conocimiento</span>
          <b>{latestKnowledge?.title || 'None'}</b>
          <p>{latestKnowledge?.summary || 'Todavía no hay resumen.'}</p>
        </div>

        <div className="infoCard">
          <span>Próxima misión</span>
          <b>{topMission?.topic || 'None'}</b>
          <p>{topMission?.reason || 'No hay misión pendiente.'}</p>
        </div>

        <div className="infoCard">
          <span>Próximo hueco</span>
          <b>{status.gaps?.[0]?.target_title || 'None'}</b>
          <p>ALAI puede convertir esto en una misión de investigación.</p>
        </div>
      </section>


      <section className="threeCards">
        <div className="infoCard">
          <span>Top Weak Knowledge</span>
          <b>{status.weakKnowledge?.[0]?.title || 'None'}</b>
          <p>
            Score {status.weakKnowledge?.[0]?.score ?? 0} ·
            Claims {status.weakKnowledge?.[0]?.claims ?? 0} ·
            Verified {status.weakKnowledge?.[0]?.verified ?? 0}
          </p>
        </div>

        <div className="infoCard">
          <span>Needs Better Structure</span>
          <b>{status.weakKnowledge?.[1]?.title || 'None'}</b>
          <p>ALAI should extract more claims or verify this topic.</p>
        </div>

        <div className="infoCard">
          <span>Reinforcement Target</span>
          <b>{status.weakKnowledge?.[2]?.title || 'None'}</b>
          <p>Low score topics should become future reinforcement missions.</p>
        </div>
      </section>

      <footer>Updated {status.updatedAt}</footer>
    </>
  );
}
