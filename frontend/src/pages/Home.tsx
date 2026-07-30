import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../state";
import type { Report, SessionListItem } from "../types";

export default function Home() {
  const { status } = useApp();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    void api
      .get<{ sessions: SessionListItem[] }>("/api/v1/sessions")
      .then((result) => setSessions(result.sessions))
      .catch(() => setSessions([]));
    void api
      .get<{ reports: Report[] }>("/api/v1/reports")
      .then((result) => setReports(result.reports.slice(0, 5)))
      .catch(() => setReports([]));
  }, []);

  const inProgress = sessions.filter(
    (session) => session.status === "in_progress" || session.status === "review"
  );
  const drafts = sessions.filter((session) => session.status === "draft");

  const active = status?.output.active;
  const mode = active?.active_mode;

  return (
    <>
      <h1>Home</h1>

      <Link to="/new" className="btn btn-primary">＋ New test session</Link>

      {inProgress.length > 0 && (
        <div className="card">
          <h2>Resume in progress</h2>
          {inProgress.map((session) => (
            <Link key={session.id} to={`/session/${session.id}/test`} className="list-item">
              <div className="grow">
                <div>{session.project_name} — {session.room || "no room"}</div>
                <div className="sub">{session.id}</div>
              </div>
              <span className="pill status">{session.status.replace("_", " ")}</span>
            </Link>
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="card">
          <h2>Drafts</h2>
          {drafts.map((session) => (
            <Link key={session.id} to={`/session/${session.id}`} className="list-item">
              <div className="grow">
                <div>{session.project_name} — {session.room || "no room"}</div>
                <div className="sub">{session.id}</div>
              </div>
              <span className="pill pending">draft</span>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Live source status</h2>
        <table className="kv">
          <tbody>
            <tr>
              <td>Pattern</td>
              <td>{status?.pattern.active_pattern ?? "—"}</td>
            </tr>
            <tr>
              <td>Output</td>
              <td>
                {active
                  ? `${active.connector} · ${mode ? `${mode.width}×${mode.height} @ ${mode.refresh} Hz` : "no mode"}`
                  : "HDMI output disconnected"}
              </td>
            </tr>
            <tr>
              <td>Soak</td>
              <td>
                {status?.soak.running
                  ? `running · ${Math.floor((status.soak.remaining_seconds ?? 0) / 60)} min remaining`
                  : "not running"}
              </td>
            </tr>
            <tr>
              <td>Health</td>
              <td>{status?.health_ok ? "OK" : "Attention required — see Maintenance"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card center">
        <h2>Connect a phone</h2>
        <p className="muted mt0">
          {status?.identity.control_url} · {status?.identity.hostname}
        </p>
        <img className="qr" src="/api/v1/identity/qr.svg" alt="QR code linking to this control interface" />
      </div>

      {reports.length > 0 && (
        <div className="card">
          <h2>Recent reports</h2>
          {reports.map((report) => (
            <div key={report.id} className="list-item">
              <div className="grow">
                <div>{report.project_name} — {report.room || "no room"}</div>
                <div className="sub">{report.session_id} · rev {report.revision} · {report.generated_at}</div>
              </div>
              <a className="btn btn-sm" href={`/api/v1/reports/${report.id}/download?kind=pdf`}>
                PDF
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
