import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../state";
import type { Attempt, Session, TestDefinition } from "../types";

const FAULT_CATEGORIES = [
  "", "video", "audio", "control", "network", "cabling", "configuration", "other",
];

/* The guided test screen (§8): one test at a time, PASS & CONTINUE as the
 * primary action, FAIL requiring a note, note/photo without leaving the
 * step, and automatic pattern activation per step (FR-21..26). */
export default function GuidedTest() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useApp();
  const requestedIndex = (location.state as { index?: number } | null)?.index;

  const [session, setSession] = useState<Session | null>(null);
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [captions, setCaptions] = useState<string[]>([]);
  const [failing, setFailing] = useState(false);
  const [faultCategory, setFaultCategory] = useState("");
  const stepOpenedAt = useRef<string>(new Date().toISOString());
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [sess, defs] = await Promise.all([
      api.get<Session>(`/api/v1/sessions/${id}`),
      api.get<{ tests: TestDefinition[] }>("/api/v1/tests"),
    ]);
    setSession(sess);
    setTests(defs.tests);
    return sess;
  }, [id]);

  useEffect(() => {
    void load().then((sess) => {
      if (
        requestedIndex !== undefined &&
        requestedIndex >= 0 &&
        requestedIndex < sess.selected_tests.length
      ) {
        setIndex(requestedIndex);
        return;
      }
      const firstOpen = sess.selected_tests.findIndex(
        (key) => !sess.progress.tests.find((t) => t.test_key === key)?.answered
      );
      setIndex(firstOpen === -1 ? sess.selected_tests.length - 1 : firstOpen);
    });
  }, [load]);

  const currentKey = session && index !== null ? session.selected_tests[index] : null;
  const definition = useMemo(
    () => tests.find((t) => t.key === currentKey) ?? null,
    [tests, currentKey]
  );

  /* FR-26: activate the step's pattern automatically when it opens. */
  useEffect(() => {
    if (!definition || !session) return;
    stepOpenedAt.current = new Date().toISOString();
    const params =
      definition.pattern_key === "soak" && session.soak_minutes > 0
        ? { minutes: session.soak_minutes }
        : {};
    void api
      .post(`/api/v1/patterns/${definition.pattern_key}/activate`, { params })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Pattern activation failed")
      );
    setNote("");
    setPhotos([]);
    setCaptions([]);
    setFailing(false);
    setFaultCategory("");
    setError("");
  }, [definition?.key, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || index === null) return <p className="muted">Loading…</p>;
  if (session.status === "draft") {
    return (
      <div className="alert warn">
        This session has not been started yet. Go back and press “Start guided test”.
      </div>
    );
  }

  const progressFor = (key: string) =>
    session.progress.tests.find((t) => t.test_key === key);

  const uploadPhotos = async (attempt: Attempt) => {
    for (let i = 0; i < photos.length; i++) {
      const form = new FormData();
      form.append("file", photos[i]);
      form.append("caption", captions[i] ?? "");
      await api.postForm(
        `/api/v1/sessions/${session.id}/attempts/${attempt.id}/evidence`,
        form
      );
    }
  };

  const record = async (result: "pass" | "fail") => {
    if (!currentKey) return;
    if (result === "fail" && !note.trim()) {
      setError("A failed test requires a short note before continuing (FR-22).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const attempt = await api.post<Attempt>(
        `/api/v1/sessions/${session.id}/tests/${currentKey}/attempts`,
        {
          result,
          note,
          fault_category: result === "fail" ? faultCategory : "",
          started_at: stepOpenedAt.current,
        }
      );
      await uploadPhotos(attempt);
      const updated = await load();
      const nextOpen = updated.selected_tests.findIndex(
        (key) => !updated.progress.tests.find((t) => t.test_key === key)?.answered
      );
      if (nextOpen === -1) {
        navigate(`/session/${session.id}/review`);
      } else {
        setIndex(nextOpen);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record result");
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setPhotos((previous) => [...previous, ...incoming]);
    setCaptions((previous) => [...previous, ...incoming.map(() => "")]);
  };

  const soak = status?.soak;
  const isSoakStep = definition?.pattern_key === "soak";
  const answeredHere = progressFor(currentKey ?? "");

  return (
    <>
      <h1>
        {definition?.name ?? currentKey}{" "}
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {index + 1} / {session.selected_tests.length}
        </span>
      </h1>

      <div className="progress-strip" aria-label="Test progress">
        {session.selected_tests.map((key, i) => {
          const p = progressFor(key);
          return (
            <span
              key={key}
              className={`step ${p?.latest_result ?? ""} ${i === index ? "current" : ""}`}
              title={key}
            />
          );
        })}
      </div>

      <div className="card">
        <p className="mt0">{definition?.instruction}</p>
        <p className="muted">
          <strong>Expected:</strong> {definition?.expected_result}
        </p>
        <table className="kv">
          <tbody>
            <tr>
              <td>Pattern on output</td>
              <td>{status?.pattern.active_pattern ?? "…"}</td>
            </tr>
            <tr>
              <td>Output mode</td>
              <td>
                {status?.output.active?.active_mode
                  ? `${status.output.active.active_mode.key} on ${status.output.active.connector}`
                  : "HDMI output disconnected"}
              </td>
            </tr>
            {answeredHere?.answered && (
              <tr>
                <td>Previous result</td>
                <td>
                  <span className={`pill ${answeredHere.latest_result}`}>
                    {answeredHere.latest_result?.toUpperCase()}
                  </span>{" "}
                  attempt {answeredHere.attempt_count} — a new answer records a retest (FR-24)
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {isSoakStep && (
          <div className={`alert ${soak?.running ? "info" : "warn"}`}>
            {soak?.running
              ? `Soak running — ${definitionStep(soak.current_step)} · ${fmtSeconds(soak.elapsed_seconds)} elapsed, ${fmtSeconds(soak.remaining_seconds)} remaining${soak.faults ? ` · ${soak.faults} fault(s)` : ""}`
              : "Soak is not running. It starts automatically when this step opens; confirm the result only after it completes."}
          </div>
        )}
      </div>

      <div className="card">
        <label htmlFor="note">Note {failing && "(required for a failed test)"}</label>
        <textarea
          id="note"
          value={note}
          placeholder={failing ? "Describe what was observed at the destination…" : "Optional observation…"}
          onChange={(e) => setNote(e.target.value)}
        />
        {failing && (
          <>
            <label htmlFor="fault">Fault category</label>
            <select id="fault" value={faultCategory} onChange={(e) => setFaultCategory(e.target.value)}>
              {FAULT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category || "— select —"}
                </option>
              ))}
            </select>
          </>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)}
        />
        <div style={{ height: 8 }} />
        <button type="button" className="btn-sm" onClick={() => fileInput.current?.click()}>
          📷 Attach photo{photos.length > 0 && ` (${photos.length})`}
        </button>
        {photos.length > 0 && (
          <div className="evidence-thumbs">
            {photos.map((file, i) => (
              <div key={i} style={{ width: 130 }}>
                <img src={URL.createObjectURL(file)} alt={`Photo ${i + 1}`} />
                <input
                  placeholder="Caption"
                  style={{ minHeight: 34, fontSize: "0.8rem", marginTop: 4 }}
                  value={captions[i] ?? ""}
                  onChange={(e) =>
                    setCaptions((previous) =>
                      previous.map((c, j) => (j === i ? e.target.value : c))
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {!failing ? (
        <>
          <button className="btn-pass" disabled={busy} onClick={() => record("pass")}>
            ✓ PASS &amp; CONTINUE
          </button>
          <div style={{ height: 10 }} />
          <div className="btn-row">
            <button className="btn-fail" disabled={busy} onClick={() => setFailing(true)}>
              ✗ Fail…
            </button>
            <button
              className="btn-ghost"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ← Previous
            </button>
            <button
              className="btn-ghost"
              disabled={index >= session.selected_tests.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className="btn-fail"
            disabled={busy || !note.trim()}
            onClick={() => record("fail")}
          >
            Record FAIL and continue
          </button>
          <div style={{ height: 10 }} />
          <button className="btn-ghost" disabled={busy} onClick={() => setFailing(false)}>
            Back to test
          </button>
        </>
      )}
    </>
  );
}

function fmtSeconds(seconds: number | undefined): string {
  const total = seconds ?? 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function definitionStep(step: string | undefined): string {
  return step ? `showing ${step}` : "cycling";
}
