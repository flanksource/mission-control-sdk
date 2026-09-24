export type PlaybookParameter = {
  name: string;
  default?: unknown;
  label?: string;
  required?: boolean;
  icon?: string;
  description?: string;
  type?: string;
  properties?: Record<string, unknown> | null;
  dependsOn?: string[];
};

export type Playbook = {
  id: string;
  namespace?: string;
  name: string;
  title?: string | null;
  icon?: string | null;
  description?: string | null;
  category?: string | null;
  parameters?: PlaybookParameter[] | unknown;
  spec?: {
    parameters?: PlaybookParameter[];
    [key: string]: unknown;
  } | null;
};

/** The resource a playbook runs against. */
export type PlaybookTarget = {
  configId?: string;
  componentId?: string;
  checkId?: string;
};

export type ListPlaybooksOptions = {
  /** Only list playbooks Mission Control considers eligible for this config. */
  configId?: string;
};

export type PlaybookRunRequest = PlaybookTarget & {
  id: string;
  params?: Record<string, string>;
};

export type PlaybookRunResponse = {
  run_id: string;
  starts_at: string;
};

export type PlaybooksClient = {
  list(options?: ListPlaybooksOptions): Promise<Playbook[]>;
  parameters(playbookId: string, target?: PlaybookTarget): Promise<PlaybookParameter[]>;
  run(request: PlaybookRunRequest): Promise<PlaybookRunResponse>;
};
