import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Session } from "../types";

/* Draft session landing page: confirm details, start the guided test,
 * or delete the draft. Completed sessions show results and reopen. */
export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSession(await api.get<Session>(`/api/v1/sessions/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not found");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="alert error">{error}</div>;
  if (!session) return <p className="muted">Loading…</p>;

  const start = async () => {
    try {
      await api.post(`/api/v1/sessions/${session.id}/start`);
      navigate(`/session/${session.id}/test`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  };

  const remove = async () => {
    if (!confirm("Delete this draft session?")) return;
    await api.delete(`/api/v1/sessions/${session.id}`);
    navigate("/");
  };

  const reopen = async () => {
    try {
      await api.post(`/api/v1/sessions/${session.id}/reopen`, { reason: reopenReason });
      navigate(`/session/${session.id}/test`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reopen");
    }
  };

  const completed =
    session.status === "completed_passed" || session.status === "completed_failed";

  return (
    <>
      <h1>{session.id}</h1>
      <span className={`pill ${session.status === "completed_passed" ? "pass" : session.status === "completed_failed" ? "fail" : "status"}`}>
        {session.status.replace("_", " ")}
      </span>

      <div className="card">
        <table className="kv">
          <tbody>
            <tr><td>Project</td><td>{session.project?.name}</td></tr>
            <tr><td>Client</td><td>{session.project?.client}</td></tr>
            <tr><td>Site</td><td>{session.project?.site}</td></tr>
            <tr><td>Room</td><td>{session.room}</td></tr>
            <tr><td>Engineer</td><td>{session.engineer}</td></tr>
            <tr><td>Signal path</td><td>{session.signal_path_text}</td></tr>
            <tr><td>Tests</td><td>{session.selected_tests.join(", ")}</td></tr>
            {session.soak_minutes > 0 && (
              <tr><td>Soak</td><td>{session.soak_minutes} minutes</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {session.status === "draft" && (
        <>
          <button className="btn-primary" onClick={start}>Start guided test</button>
          <div style={{ height: 10 }} />
          <button className="btn-ghost" onClick={remove}>Delete draft</button>
        </>
      )}

      {(session.status === "in_progress" || session.status === "review") && (
        <Link className="btn btn-primary" to={`/session/${session.id}/test`}>
          Continue guided test
        </Link>
      )}

      {completed && (
        <>
          <Link className="btn btn-primary" to={`/session/${session.id}/report`}>
            Reports
          </Link>
          <div style={{ height: 10 }} />
          {!showReopen ? (
            <button className="btn-ghost" onClick={() => setShowReopen(true)}>
              Reopen session…
            </button>
          ) : (
            <div className="card">
              <p className="muted mt0">
                Reopening records a revision event in the audit history (FR-25).
              </p>
              <label htmlFor="reason">Reason for reopening *</label>
              <input id="reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="btn-ghost" onClick={() => setShowReopen(false)}>Cancel</button>
                <button className="btn-primary" disabled={!reopenReason.trim()} onClick={reopen}>
                  Reopen
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
