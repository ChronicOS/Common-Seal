import { useEffect, useState } from "react";
import { completeByLink, downloadLinkMaterial, openLinkTraining, type LinkTraining } from "./training";
import TrainingTake from "./TrainingTake";
import { Brand } from "./Seal";

/** Training completed by personal link, without signing in */
export default function TrainingPublic({ token }: { token: string }) {
  const [t, setT] = useState<LinkTraining | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openLinkTraining(token).then(setT, (e) => setError(e instanceof Error ? e.message : "This link could not be opened."));
  }, [token]);

  return (
    <div className="page">
      <header className="masthead">
        <Brand />
      </header>
      <main className="content">
        {error && (
          <>
            <h1>This link cannot be opened</h1>
            <p className="lead">{error}</p>
            <p className="muted">Ask the person who sent it for a new link.</p>
          </>
        )}
        {!error && !t && <p className="lead">Loading…</p>}
        {t && !t.available && !t.completed_at && (
          <>
            <h1>{t.title}</h1>
            <p className="lead">This training is no longer available. Ask the person who sent it.</p>
          </>
        )}
        {t && (t.available || t.completed_at) && (
          <>
            <p className="eyebrow">{t.organisation} · Training</p>
            <TrainingTake
              title={t.title}
              content={t.content}
              files={t.completed_at ? [] : t.files.map((f) => ({ name: f.file_name, download: () => downloadLinkMaterial(f) }))}
              questions={t.questions.map((q) => ({ key: String(q.position), prompt: q.prompt, options: q.options }))}
              passMark={t.pass_mark}
              declaration={t.declaration}
              name={t.name}
              dueOn={t.due_on}
              completedAt={t.completed_at}
              signedName={t.signed_name}
              score={t.score}
              policyVersion={t.policy_version}
              onSubmit={(answers, signed, agreed) => completeByLink(token, answers, signed, agreed)}
            />
          </>
        )}
      </main>
    </div>
  );
}
