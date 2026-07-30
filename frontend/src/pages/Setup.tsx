import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { useApp } from "../state";

/* First-run setup (FR-02): company, branding, default engineer, appliance
 * identity and the control PIN. */
export default function Setup() {
  const navigate = useNavigate();
  const { refresh } = useApp();
  const [companyName, setCompanyName] = useState("");
  const [accentColour, setAccentColour] = useState("#0E7C66");
  const [engineer, setEngineer] = useState("");
  const [applianceId, setApplianceId] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [sourceNumber, setSourceNumber] = useState(1);
  const [reportFooter, setReportFooter] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alreadySetup, setAlreadySetup] = useState(false);

  useEffect(() => {
    void api
      .get<{ setup_complete: boolean; branding: { company_name: string; accent_colour: string; report_footer: string }; appliance: { id: string; friendly_name: string; source_number: number }; default_engineer: string }>(
        "/api/v1/setup"
      )
      .then((setup) => {
        setAlreadySetup(setup.setup_complete);
        setCompanyName(setup.branding.company_name);
        setAccentColour(setup.branding.accent_colour);
        setReportFooter(setup.branding.report_footer);
        setApplianceId(setup.appliance.id);
        setFriendlyName(setup.appliance.friendly_name);
        setSourceNumber(setup.appliance.source_number);
        setEngineer(setup.default_engineer);
      });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pin !== pinConfirm) {
      setError("PINs do not match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/api/v1/setup", {
        company_name: companyName,
        accent_colour: accentColour,
        default_engineer: engineer,
        appliance_id: applianceId,
        friendly_name: friendlyName,
        source_number: sourceNumber,
        report_footer: reportFooter,
        pin,
      });
      // Get a token straight away so the user isn't immediately re-prompted.
      const token = await api.post<{ token: string }>("/api/v1/auth/token", { pin });
      setToken(token.token);
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>{alreadySetup ? "Appliance settings & PIN" : "First-run setup"}</h1>
      {alreadySetup && (
        <div className="alert warn">
          Setup has already been completed. Submitting again updates the details and
          rotates the control PIN (requires an unlocked session).
        </div>
      )}

      <div className="card">
        <h2>Branding</h2>
        <label htmlFor="company">Company name *</label>
        <input id="company" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <label htmlFor="accent">Report accent colour</label>
        <input id="accent" type="color" value={accentColour} onChange={(e) => setAccentColour(e.target.value)} style={{ height: 48, padding: 4 }} />
        <label htmlFor="footer">Report footer text</label>
        <input id="footer" value={reportFooter} onChange={(e) => setReportFooter(e.target.value)} />
        <label htmlFor="engineer">Default engineer</label>
        <input id="engineer" value={engineer} onChange={(e) => setEngineer(e.target.value)} />
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          The report logo can be uploaded from Maintenance after setup.
        </p>
      </div>

      <div className="card">
        <h2>Appliance identity</h2>
        <label htmlFor="appid">Appliance ID</label>
        <input id="appid" placeholder="TL-TESTSOURCE-01" value={applianceId} onChange={(e) => setApplianceId(e.target.value)} />
        <label htmlFor="fname">Friendly name</label>
        <input id="fname" value={friendlyName} onChange={(e) => setFriendlyName(e.target.value)} />
        <label htmlFor="srcnum">Source number</label>
        <input id="srcnum" type="number" min={1} max={999} value={sourceNumber} onChange={(e) => setSourceNumber(Number(e.target.value))} />
      </div>

      <div className="card">
        <h2>Control PIN</h2>
        <p className="muted mt0">
          Required for any state-changing action once setup completes (NFR-09).
        </p>
        <label htmlFor="pin">PIN (minimum 4 characters) *</label>
        <input id="pin" type="password" inputMode="numeric" required minLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
        <label htmlFor="pin2">Confirm PIN *</label>
        <input id="pin2" type="password" inputMode="numeric" required value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} />
      </div>

      {error && <div className="alert error">{error}</div>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {alreadySetup ? "Update settings" : "Complete setup"}
      </button>
    </form>
  );
}
