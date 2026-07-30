import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Session, TestDefinition } from "../types";

/* Review screen (§8): all steps and statuses, missing/failed summary,
 * Complete as Passed/Failed. Completion is validated server-side (FR-37). */
export default function Review() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sess, defs] = await Promise.all([
      api.get<Session>(`/api/v1/sessions/${id}`),
      api.get<{ tests: TestDefinition[] }>("/api/v1/tests"),
    ]);
    setSession(sess);
    setTests(defs.tests);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return <p className="muted">Loading…</p>;

  const name = (key: string) => tests.find((t) => t.key === key)?.name ?? key;
  const progress = session.progress;
  const evidenceCount = session.attempts.reduce(
    (count, attempt) => count + (attempt.evidence?.length ?? 0),
    0
  );

  const goTo = (key: string) => {
    const idx = session.selected_tests.indexOf(key);
    navigate(`/session/${session.id}/test`, { state: { index: idx } });
  };

  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.post<Session>(`/api/v1/sessions/${session.id}/complete`);
      navigate(`/session/${result.id}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Completion blocked");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Review — {session.id}</h1>

      <div className="card">
        {session.selected_tests.map((key) => {
          const p = progress.tests.find((t) => t.test_key === key);
          const attempts = session.attempts.filter((a) => a.test_key === key);
          const latest = attempts[attempts.length - 1];
          return (
            <div key={key} className="list-item">
              <div className="grow">
                <div>{name(key)}</div>
                <div className="sub">
                  {p?.answered
                    ? `${attempts.length} attempt(s)${latest?.note ? ` · ${latest.note}` : ""}`
                    : "Not answered yet"}
                </div>
              </div>
              {p?.answered ? (
                <span className={`pill ${p.latest_result}`}>{p.latest_result?.toUpperCase()}</span>
              ) : (
                <span className="pill pending">MISSING</span>
              )}
              <button className="btn-sm" onClick={() => goTo(key)}>
                {p?.answered ? "Retest" : "Answer"}
              </button>
            </div>
          );
        })}
        <p className="muted">Evidence attached: {evidenceCount} photo(s)</p>
      </div>

      {progress.unanswered.length > 0 && (
        <div className="alert warn">
          Completion is blocked — unanswered tests: {progress.unanswered.map(name).join(", ")} (FR-37)
        </div>
      )}
      {progress.failed.length > 0 && progress.unanswered.length === 0 && (
        <div className="alert error">
          Latest attempt failed for: {progress.failed.map(name).join(", ")}. The session
          can only be completed as <strong>Failed</strong>.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      {progress.can_complete_passed && (
        <button className="btn-pass" disabled={busy} onClick={complete}>
          Complete as PASSED
        </button>
      )}
      {progress.can_complete_failed && (
        <button className="btn-fail" disabled={busy} onClick={complete}>
          Complete as FAILED
        </button>
      )}
      <div style={{ height: 10 }} />
      <Link className="btn btn-ghost" to={`/session/${session.id}/test`}>
        ← Back to guided test
      </Link>
    </>
  );
}
