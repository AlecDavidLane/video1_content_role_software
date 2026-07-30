export interface DisplayMode {
  width: number;
  height: number;
  refresh: number;
  key: string;
}

export interface OutputInfo {
  connector: string;
  connected: boolean;
  active_mode: DisplayMode | null;
  modes: DisplayMode[];
}

export interface OutputState {
  outputs: OutputInfo[];
  active: OutputInfo | null;
  quick_modes: string[];
  error?: string;
}

export interface AudioSink {
  name: string;
  description: string;
  is_default: boolean;
  is_hdmi: boolean;
}

export interface Identity {
  appliance_id: string;
  friendly_name: string;
  source_number: number;
  hostname: string;
  ip_address: string;
  control_url: string;
  app_version: string;
  role_version: string;
}

export interface SoakState {
  running: boolean;
  requested_minutes?: number;
  elapsed_seconds?: number;
  remaining_seconds?: number;
  current_step?: string;
  faults?: number;
}

export interface Status {
  identity: Identity;
  pattern: { active_pattern: string; params: Record<string, unknown> };
  output: OutputState;
  audio: { sinks: AudioSink[]; error?: string };
  soak: SoakState;
  health_ok: boolean;
  current_session_id: string | null;
  setup_complete: boolean;
  app_version: string;
}

export interface PatternDef {
  key: string;
  name: string;
  description: string;
  parameters: Record<string, { type: string; default: number; min: number; max: number }>;
}

export interface TestDefinition {
  id: number;
  key: string;
  name: string;
  instruction: string;
  expected_result: string;
  pattern_key: string;
  required_by_default: number;
  sequence: number;
}

export interface Evidence {
  id: number;
  caption: string;
  mime_type: string;
  sha256: string;
  created_at: string;
  original_path: string;
  derivative_path: string;
}

export interface Attempt {
  id: number;
  session_id: string;
  test_key: string;
  attempt_number: number;
  result: "pass" | "fail";
  note: string;
  engineer: string;
  fault_category: string;
  started_at: string | null;
  answered_at: string;
  captured_system_state: Record<string, unknown>;
  evidence?: Evidence[];
}

export interface TestProgress {
  test_key: string;
  answered: boolean;
  latest_result: "pass" | "fail" | null;
  attempt_count: number;
}

export interface Progress {
  tests: TestProgress[];
  unanswered: string[];
  failed: string[];
  can_complete_passed: boolean;
  can_complete_failed: boolean;
}

export interface Project {
  id: number;
  name: string;
  client: string;
  site: string;
  default_engineer: string;
}

export interface Session {
  id: string;
  project_id: number;
  project: Project | null;
  room: string;
  engineer: string;
  signal_path_text: string;
  endpoints: Record<string, string>;
  selected_tests: string[];
  soak_minutes: number;
  status:
    | "draft"
    | "in_progress"
    | "review"
    | "completed_passed"
    | "completed_failed";
  started_at: string | null;
  completed_at: string | null;
  reopened_at: string | null;
  created_at: string;
  attempts: Attempt[];
  progress: Progress;
}

export interface SessionListItem {
  id: string;
  status: Session["status"];
  room: string;
  project_name: string;
  client: string;
  site: string;
  created_at: string;
  completed_at: string | null;
  selected_tests: string[];
}

export interface Report {
  id: number;
  session_id: string;
  revision: number;
  pdf_path: string;
  json_path: string;
  json_sha256: string;
  generated_at: string;
  project_name?: string;
  room?: string;
}

export interface HealthCheck {
  ok: boolean;
  detail: string;
}

export interface Health {
  ok: boolean;
  checks: Record<string, HealthCheck>;
  started_at: string;
}

export interface SystemEvent {
  id: number;
  session_id: string | null;
  severity: "info" | "warning" | "error";
  event_type: string;
  message: string;
  created_at: string;
}
