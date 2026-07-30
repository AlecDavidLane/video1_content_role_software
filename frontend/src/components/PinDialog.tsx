import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { useApp } from "../state";

export default function PinDialog() {
  const { setNeedsPin, refresh } = useApp();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ token: string }>("/api/v1/auth/token", { pin });
      setToken(result.token);
      setNeedsPin(false);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN rejected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.72)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <form className="card" style={{ width: "100%", maxWidth: 360 }} onSubmit={submit}>
        <h2 className="mt0">Control PIN required</h2>
        <p className="muted">
          Changing patterns, sessions or settings requires the appliance control PIN.
        </p>
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
        {error && <div className="alert error">{error}</div>}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button type="button" className="btn-ghost" onClick={() => setNeedsPin(false)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || pin.length === 0}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
