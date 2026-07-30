import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Report, Session } from "../types";

/* Report screen (§8): overall status, generate/regenerate, download PDF
 * and JSON, saved path (FR-35), duplicate-as-new-test. */
export default function ReportComplete() {
  const { id } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sess, reps] = await Promise.all([
      api.get<Session>(`/api/v1/sessions/${id}`),
      api.get<{ reports: Report[] }>(`/api/v1/sessions/${id}/reports`),
    ]);
    setSession(sess);
    setReports(reps.reports);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return <p className="muted">Loading…</p>;

  const passed = session.status === "completed_passed";
  const completed = passed || session.status === "completed_failed";

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/v1/sessions/${session.id}/report`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Report — {session.id}</h1>

      {completed ? (
        <div className={`alert ${passed ? "info" : "error"}`}>
          Overall result: <strong>{passed ? "PASSED" : "FAILED"}</strong>
          {session.completed_at && ` · completed ${session.completed_at}`}
        </div>
      ) : (
        <div className="alert warn">
          This session is not completed yet; reports are generated after completion.
        </div>
      )}

      {completed && (
        <button className="btn-primary" disabled={busy} onClick={generate}>
          {reports.length === 0 ? "Generate report" : "Regenerate report (new revision)"}
        </button>
      )}
      {error && <div className="alert error">{error}</div>}

      {reports.map((report) => (
        <div className="card" key={report.id}>
          <h2 className="mt0">Revision {report.revision}</h2>
          <table className="kv">
            <tbody>
              <tr><td>Generated</td><td>{report.generated_at}</td></tr>
              <tr><td>Saved to</td><td style={{ wordBreak: "break-all" }}>{report.pdf_path}</td></tr>
              <tr><td>JSON checksum</td><td style={{ wordBreak: "break-all" }}>{report.json_sha256}</td></tr>
            </tbody>
          </table>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <a className="btn btn-primary" href={`/api/v1/reports/${report.id}/download?kind=pdf`}>
              Download PDF
            </a>
            <a className="btn" href={`/api/v1/reports/${report.id}/download?kind=json`}>
              Download JSON
            </a>
          </div>
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <Link className="btn" to="/new">New test</Link>
        <Link className="btn btn-ghost" to={`/session/${session.id}`}>Session details</Link>
      </div>
    </>
  );
}
