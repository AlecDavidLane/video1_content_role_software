import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import type { Health, SystemEvent } from "../types";

/* Maintenance (§8): health, versions, output/audio/network details,
 * events, branding, config export/import. */
export default function Maintenance() {
  const { status, refresh } = useApp();
  const [health, setHealth] = useState<Health | null>(null);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState("");
  const [accentColour, setAccentColour] = useState("#0E7C66");
  const [reportFooter, setReportFooter] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const response = await fetch("/health");
      setHealth(await response.json());
    } catch {
      setHealth(null);
    }
    try {
      const result = await api.get<{ events: SystemEvent[] }>(
        "/api/v1/system-events?limit=50"
      );
      setEvents(result.events);
    } catch {
      setEvents([]);
    }
    try {
      const setup = await api.get<{
        branding: { company_name: string; accent_colour: string; report_footer: string };
      }>("/api/v1/setup");
      setCompanyName(setup.branding.company_name);
      setAccentColour(setup.branding.accent_colour);
      setReportFooter(setup.branding.report_footer);
    } catch {
      /* leave defaults */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveBranding = async () => {
    setError("");
    setMessage("");
    try {
      await api.put("/api/v1/config/branding", {
        company_name: companyName,
        accent_colour: accentColour,
        report_footer: reportFooter,
      });
      setMessage("Branding saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      await api.postForm("/api/v1/setup/logo", form);
      setMessage("Logo uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    }
  };

  const exportConfig = async () => {
    const config = await api.get<Record<string, unknown>>("/api/v1/config/export");
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "tl-source-config.json";
    link.click();
  };

  const importConfig = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      await fetch("/api/v1/config/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("tl-source-token")
            ? { Authorization: `Bearer ${localStorage.getItem("tl-source-token")}` }
            : {}),
        },
        body: text,
      }).then((response) => {
        if (!response.ok) throw new Error(`Import failed (${response.status})`);
      });
      setMessage("Configuration imported.");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  };

  return (
    <>
      <h1>Maintenance</h1>
      {message && <div className="alert info">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h2>Health</h2>
        {health ? (
          <table className="kv">
            <tbody>
              {Object.entries(health.checks).map(([name, check]) => (
                <tr key={name}>
                  <td>{check.ok ? "🟢" : "🔴"} {name.replace("_", " ")}</td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Health endpoint unreachable.</p>
        )}
      </div>

      <div className="card">
        <h2>Appliance</h2>
        <table className="kv">
          <tbody>
            <tr><td>Appliance ID</td><td>{status?.identity.appliance_id}</td></tr>
            <tr><td>App version</td><td>{status?.identity.app_version}</td></tr>
            <tr><td>Role version</td><td>{status?.identity.role_version || "n/a"}</td></tr>
            <tr><td>Hostname</td><td>{status?.identity.hostname}</td></tr>
            <tr><td>IP address</td><td>{status?.identity.ip_address}</td></tr>
            <tr><td>Control URL</td><td>{status?.identity.control_url}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Branding</h2>
        <label htmlFor="company">Company name</label>
        <input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <label htmlFor="accent">Accent colour</label>
        <input id="accent" type="color" value={accentColour} onChange={(e) => setAccentColour(e.target.value)} style={{ height: 48, padding: 4 }} />
        <label htmlFor="footer">Report footer</label>
        <input id="footer" value={reportFooter} onChange={(e) => setReportFooter(e.target.value)} />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn-primary" onClick={saveBranding}>Save branding</button>
          <button onClick={() => logoInput.current?.click()}>Upload logo</button>
        </div>
        <input
          ref={logoInput}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          style={{ display: "none" }}
          onChange={(e) => uploadLogo(e.target.files?.[0])}
        />
      </div>

      <div className="card">
        <h2>Configuration</h2>
        <div className="btn-row">
          <button onClick={exportConfig}>Export (no secrets)</button>
          <button onClick={() => importInput.current?.click()}>Import…</button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => importConfig(e.target.files?.[0])}
        />
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Export contains no PIN or secrets (FR-05). Diagnostic bundles are created
          with <code>tl-source diag-bundle</code> on the appliance (FR-42).
        </p>
      </div>

      <div className="card">
        <h2>Recent system events</h2>
        {events.length === 0 && <p className="muted">No events.</p>}
        {events.map((event) => (
          <div className="list-item" key={event.id}>
            <div className="grow">
              <div>
                {event.severity === "error" ? "🔴" : event.severity === "warning" ? "🟡" : "🔵"}{" "}
                {event.message}
              </div>
              <div className="sub">
                {event.created_at} · {event.event_type}
                {event.session_id ? ` · ${event.session_id}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
