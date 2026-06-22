export type DangerLevel = "SAFE" | "EDIT" | "PUBLISH";

export type DexInputOption = {
  value: string;
  label: string;
};

export type DexInputDescriptor = {
  name: string;
  label: string;
  type: "text" | "path" | "select" | "boolean" | "json";
  flag?: string;
  positional?: boolean;
  placeholder?: string;
  defaultValue?: string | boolean;
  options?: DexInputOption[];
};

export type DexCommandGroup = {
  id: string;
  label: string;
  description: string;
};

export type DexCommandDescriptor = {
  id: string;
  label: string;
  group: string;
  danger: DangerLevel;
  command: string[];
  repoSupport: string[];
  summary: string;
  inputs: DexInputDescriptor[];
  supportsDryRun?: boolean;
  requiresProdConfirmation?: boolean;
  ttyOnly?: boolean;
  nativeWorkflow?: string;
};

export type DexRegistry = {
  version: number;
  confirmationPhrase: string;
  groups: DexCommandGroup[];
  commands: DexCommandDescriptor[];
};

export type DexWorkspace = {
  ok: boolean;
  activeRepo: string;
  activeRoot: string;
  configPath: string;
  configExists: boolean;
  issues: string[];
  repos: Record<string, { root?: string } | string>;
  defaultRepo: string;
  supportedRepos: string[];
};

export type DexRunRequest = {
  commandId: string;
  repo: string;
  values: Record<string, string | boolean>;
  dryRun?: boolean;
  confirmation?: string;
};

export type DexRunEvent = {
  runId?: string;
  type: string;
  commandId?: string;
  label?: string;
  danger?: DangerLevel;
  args?: string[];
  cwd?: string;
  text?: string;
  error?: string;
  ok?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  confirmationRequired?: boolean;
};
