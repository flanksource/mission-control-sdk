import type { Transport } from "../core/transport.js";
import { normalizeOptionalString, requirePathSegment } from "../core/url.js";
import type {
  ListPlaybooksOptions,
  Playbook,
  PlaybookParameter,
  PlaybookRunRequest,
  PlaybookRunResponse,
  PlaybooksClient,
  PlaybookTarget,
} from "./types.js";

export function createPlaybooksClient(transport: Transport): PlaybooksClient {
  return {
    list(options: ListPlaybooksOptions = {}): Promise<Playbook[]> {
      return transport.json<Playbook[]>("/playbook/list", {
        query: { config_id: normalizeOptionalString(options.configId) },
      });
    },

    async parameters(
      playbookId: string,
      target: PlaybookTarget = {},
    ): Promise<PlaybookParameter[]> {
      const id = requirePathSegment(playbookId, "playbookId");
      const response = await transport.json<{ params?: PlaybookParameter[] }>(
        `/playbook/${encodeURIComponent(id)}/params`,
        { method: "POST", body: { id, ...targetBody(target) } },
      );
      return response.params ?? [];
    },

    run({ id, params, ...target }: PlaybookRunRequest): Promise<PlaybookRunResponse> {
      return transport.json<PlaybookRunResponse>("/playbook/run", {
        method: "POST",
        body: { id, ...targetBody(target), ...(params ? { params } : {}) },
      });
    },
  };
}

/** Maps the SDK's camelCase target onto Mission Control's snake_case wire fields. */
function targetBody(target: PlaybookTarget): Record<string, string> {
  const body: Record<string, string> = {};
  const configId = normalizeOptionalString(target.configId);
  const componentId = normalizeOptionalString(target.componentId);
  const checkId = normalizeOptionalString(target.checkId);
  if (configId) body.config_id = configId;
  if (componentId) body.component_id = componentId;
  if (checkId) body.check_id = checkId;
  return body;
}
