/** A placeholder: what horizon scanning will do, and what to use until it is built. */
export default function Horizon({ canManage, onOpenWorkflows }: { canManage: boolean; onOpenWorkflows: () => void }) {
  return (
    <>
      <p className="eyebrow">Legal, regulatory and compliance</p>
      <h1>Horizon</h1>
      <p className="lead">A watch on the law and regulation that is coming, so the board hears about it before it arrives.</p>
      <section className="card warning">
        <h2>Not built yet</h2>
        <p>This page is a placeholder. Nothing here is monitored, so do not rely on it to tell you about a change in the law.</p>
      </section>
      <section className="block">
        <h2>What it will do</h2>
        <ul>
          <li>Keep a list of upcoming changes that affect your sector and the places you operate, each with its source and start date.</li>
          <li>Show which of your entities, register entries, policies and training a change touches.</li>
          <li>Start an assessment for each change that matters, with an owner and a deadline ahead of the start date.</li>
          <li>Give the board a short view of what is coming, what has been assessed and what is not yet ready.</li>
        </ul>
      </section>
      <section className="block">
        <h2>Until then</h2>
        <p>
          When you learn of a change, run the "New legislation assessment" workflow. It records the summary, what the change
          affects, the updates made and the sign-off.
        </p>
        {canManage && (
          <button type="button" className="quiet" onClick={onOpenWorkflows}>
            Open workflows
          </button>
        )}
      </section>
    </>
  );
}
