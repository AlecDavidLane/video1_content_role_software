import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Project, Session, TestDefinition } from "../types";

const ENDPOINT_FIELDS: Array<[keyof EndpointsForm, string, string]> = [
  ["source", "Source", "e.g. TL test source HDMI out"],
  ["transmitter", "Transmitter / encoder", "e.g. HDBaseT TX, AVoIP encoder"],
  ["network", "Network / switching stage", "e.g. 10G switch, matrix"],
  ["receiver", "Receiver / decoder", "e.g. HDBaseT RX, AVoIP decoder"],
  ["destination", "Destination", "e.g. Boardroom display"],
];

interface EndpointsForm {
  source: string;
  transmitter: string;
  network: string;
  receiver: string;
  destination: string;
}

export default function NewTest() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [client, setClient] = useState("");
  const [site, setSite] = useState("");
  const [room, setRoom] = useState("");
  const [engineer, setEngineer] = useState("");
  const [pathText, setPathText] = useState("");
  const [endpoints, setEndpoints] = useState<EndpointsForm>({
    source: "", transmitter: "", network: "", receiver: "", destination: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [soakMinutes, setSoakMinutes] = useState(30);

  useEffect(() => {
    void api.get<{ tests: TestDefinition[] }>("/api/v1/tests").then((result) => {
      setTests(result.tests);
      setSelected(
        new Set(result.tests.filter((t) => t.required_by_default).map((t) => t.key))
      );
    });
    void api
      .get<{ projects: Project[] }>("/api/v1/projects")
      .then((result) => setProjects(result.projects))
      .catch(() => setProjects([]));
  }, []);

  const applyProject = (id: string) => {
    const project = projects.find((p) => String(p.id) === id);
    if (project) {
      setProjectName(project.name);
      setClient(project.client);
      setSite(project.site);
      if (!engineer) setEngineer(project.default_engineer);
    }
  };

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api.post<Session>("/api/v1/sessions", {
        project_name: projectName,
        client,
        site,
        room,
        engineer,
        signal_path_text: pathText,
        endpoints,
        selected_tests: Array.from(selected),
        soak_minutes: selected.has("soak") ? soakMinutes : 0,
      });
      navigate(`/session/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>New test session</h1>

      {projects.length > 0 && (
        <div className="card">
          <label htmlFor="reuse">Reuse a previous project</label>
          <select id="reuse" defaultValue="" onChange={(e) => applyProject(e.target.value)}>
            <option value="">— start fresh —</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.site || project.client || "no site"})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card">
        <h2>Project</h2>
        <label htmlFor="project">Project *</label>
        <input id="project" required value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        <label htmlFor="client">Client</label>
        <input id="client" value={client} onChange={(e) => setClient(e.target.value)} />
        <label htmlFor="site">Site</label>
        <input id="site" value={site} onChange={(e) => setSite(e.target.value)} />
        <label htmlFor="room">Room / area</label>
        <input id="room" value={room} onChange={(e) => setRoom(e.target.value)} />
        <label htmlFor="engineer">Engineer</label>
        <input id="engineer" value={engineer} onChange={(e) => setEngineer(e.target.value)} />
      </div>

      <div className="card">
        <h2>Signal path</h2>
        {ENDPOINT_FIELDS.map(([key, label, placeholder]) => (
          <div key={key}>
            <label htmlFor={`ep-${key}`}>{label}</label>
            <input
              id={`ep-${key}`}
              placeholder={placeholder}
              value={endpoints[key]}
              onChange={(e) => setEndpoints({ ...endpoints, [key]: e.target.value })}
            />
          </div>
        ))}
        <label htmlFor="pathtext">Free-text description</label>
        <textarea
          id="pathtext"
          placeholder="e.g. Rack PC position 3 → matrix in 7 → out 2 → lectern extender → projector"
          value={pathText}
          onChange={(e) => setPathText(e.target.value)}
        />
      </div>

      <div className="card checklist">
        <h2>Required tests</h2>
        {tests.map((test) => (
          <label key={test.key} className="check">
            <input
              type="checkbox"
              checked={selected.has(test.key)}
              onChange={() => toggle(test.key)}
            />
            <span>
              {test.name}
              <span className="sub muted" style={{ display: "block", fontSize: "0.8rem" }}>
                {test.instruction}
              </span>
            </span>
          </label>
        ))}
        {selected.has("soak") && (
          <>
            <label htmlFor="soakmin">Soak duration (minutes)</label>
            <input
              id="soakmin"
              type="number"
              min={1}
              max={1440}
              value={soakMinutes}
              onChange={(e) => setSoakMinutes(Number(e.target.value))}
            />
          </>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      <button className="btn-primary" type="submit" disabled={busy || !projectName}>
        Create session
      </button>
    </form>
  );
}
