import { createTransport } from "./core/transport.js";
import type {
  ConnectionMode,
  MissionControlClientOptions,
  MissionControlRequestOptions,
} from "./core/types.js";
import { createPlaybooksClient } from "./playbooks/client.js";
import type { PlaybooksClient } from "./playbooks/types.js";
import { createPluginClient } from "./plugins/client.js";
import type { PluginClient, PluginOptions } from "./plugins/types.js";

export type MissionControlClient = {
  mode: ConnectionMode;
  baseUrl: string;
  playbooks: PlaybooksClient;
  /** Returns a handle for one plugin's operations. */
  plugin(pluginRef: string, options?: PluginOptions): PluginClient;
  /** Calls any Mission Control endpoint under baseUrl and returns the native Response. */
  request(path: string, options?: MissionControlRequestOptions): Promise<Response>;
};

/** Creates a Mission Control client; every sub-client shares its base URL, mode and credentials. */
export function createMissionControlClient(
  options: MissionControlClientOptions,
): MissionControlClient {
  const transport = createTransport(options);

  return {
    mode: transport.mode,
    baseUrl: transport.baseUrl,
    playbooks: createPlaybooksClient(transport),
    plugin: (pluginRef, pluginOptions) => createPluginClient(transport, pluginRef, pluginOptions),
    request: transport.request,
  };
}
