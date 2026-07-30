import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import type { PatternDef } from "../types";

/* Manual pattern control (§8): large pattern buttons, active pattern,
 * output mode, audio sink, soak start/stop. */
export default function ManualPatterns() {
  const { status, refresh } = useApp();
  const [patterns, setPatterns] = useState<PatternDef[]>([]);
  const [error, setError] = useState("");
  const [soakMinutes, setSoakMinutes] = useState(30);

  useEffect(() => {
    void api
      .get<{ patterns: PatternDef[] }>("/api/v1/patterns")
      .then((result) => setPatterns(result.patterns));
  }, []);

  const activate = async (key: string) => {
    setError("");
    try {
      const params = key === "soak" ? { minutes: soakMinutes } : {};
      await api.post(`/api/v1/patterns/${key}/activate`, { params });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
    }
  };

  const stopSoak = async () => {
    try {
      await api.post("/api/v1/soak/stop");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop soak");
    }
  };

  const setMode = async (modeKey: string) => {
    const connector = status?.output.active?.connector;
    if (!connector) return;
    setError("");
    try {
      await api.post("/api/v1/output/mode", { connector, mode: modeKey });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mode change failed");
    }
  };

  const setSink = async (sink: string) => {
    setError("");
    try {
      await api.post("/api/v1/audio/sink", { sink });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sink change failed");
    }
  };

  const active = status?.pattern.active_pattern;
  const output = status?.output;
  const soak = status?.soak;

  return (
    <>
      <h1>Manual patterns</h1>
      {error && <div className="alert error">{error}</div>}

      {soak?.running && (
        <div className="alert info">
          Soak running — {soak.current_step} ·{" "}
          {Math.floor((soak.remaining_seconds ?? 0) / 60)} min remaining
          <div style={{ height: 8 }} />
          <button className="btn-sm" onClick={stopSoak}>Stop soak</button>
        </div>
      )}

      <div className="pattern-grid">
        {patterns.map((pattern) => (
          <button
            key={pattern.key}
            className={active === pattern.key ? "active" : ""}
            onClick={() => activate(pattern.key)}
          >
            {pattern.name}
            <span className="desc">{pattern.description.split(".")[0]}</span>
          </button>
        ))}
        <button className={active === "holding" ? "active" : ""} onClick={() => api.post("/api/v1/patterns/holding").then(refresh)}>
          Holding
          <span className="desc">Black screen</span>
        </button>
      </div>

      <div className="card">
        <label htmlFor="soakmin">Soak duration (minutes)</label>
        <input
          id="soakmin"
          type="number"
          min={1}
          max={1440}
          value={soakMinutes}
          onChange={(e) => setSoakMinutes(Number(e.target.value))}
        />
      </div>

      <div className="card">
        <h2>Output mode</h2>
        {output?.active ? (
          <>
            <p className="mt0 muted">
              {output.active.connector} — currently{" "}
              {output.active.active_mode?.key ?? "unknown"}
            </p>
            <div className="btn-row" style={{ flexWrap: "wrap" }}>
              {output.quick_modes.map((modeKey) => (
                <button
                  key={modeKey}
                  className={`btn-sm ${output.active?.active_mode?.key.startsWith(modeKey.split("@")[0]) && output.active?.active_mode?.key === modeKey ? "btn-primary" : ""}`}
                  onClick={() => setMode(modeKey)}
                >
                  {modeKey}
                </button>
              ))}
            </div>
            <label htmlFor="allmodes">All advertised modes (FR-12)</label>
            <select
              id="allmodes"
              value={output.active.active_mode?.key ?? ""}
              onChange={(e) => setMode(e.target.value)}
            >
              {output.active.modes.map((mode) => (
                <option key={mode.key} value={mode.key}>{mode.key}</option>
              ))}
            </select>
          </>
        ) : (
          <div className="alert error">HDMI output disconnected</div>
        )}
      </div>

      <div className="card">
        <h2>Audio sink</h2>
        <select
          value={status?.audio.sinks.find((sink) => sink.is_default)?.name ?? ""}
          onChange={(e) => setSink(e.target.value)}
        >
          {status?.audio.sinks.map((sink) => (
            <option key={sink.name} value={sink.name}>
              {sink.is_hdmi ? "🔊 " : ""}{sink.description || sink.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <h2>Source identity</h2>
        <table className="kv">
          <tbody>
            <tr><td>Appliance</td><td>{status?.identity.appliance_id}</td></tr>
            <tr><td>Source number</td><td>{status?.identity.source_number}</td></tr>
            <tr><td>Name</td><td>{status?.identity.friendly_name}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
