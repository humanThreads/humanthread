import {
  agentCredentialStatusSchema,
  loopModelRoutingSchema,
  modelCatalogSchema,
  modelCatalogSiteSchema,
  modelSiteSchema,
  modelSitesDocumentSchema,
  type AgentCredentialStatus,
  type LoopModelRouting,
  type ModelCatalog,
  type ModelCatalogSite,
  type ModelSite,
  type ModelSitesDocument,
} from "./local-model-configuration";

export type LocalAccountContext = {
  deploymentOrigin: string;
  userId: string;
};

export interface LocalModelInvoke {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface NativeLocalModelCommands {
  getCredentialStatus(credentialRef: string): Promise<AgentCredentialStatus>;
  setCredential(input: { credentialRef: string; kind: "openai_api_key"; apiKey: string }): Promise<AgentCredentialStatus>;
  deleteCredential(credentialRef: string): Promise<AgentCredentialStatus>;
  listSites(): Promise<ModelSitesDocument>;
  saveSite(site: ModelSite, accountDefault?: ModelSitesDocument["accountDefault"]): Promise<ModelSitesDocument>;
  saveModelDefaults(accountDefault: ModelSitesDocument["accountDefault"]): Promise<ModelSitesDocument>;
  deleteSite(siteId: string): Promise<ModelSitesDocument>;
  getCatalog(): Promise<ModelCatalog>;
  saveCatalog(catalog: ModelCatalog): Promise<ModelCatalog>;
  testAndRefreshSite(site: ModelSite, catalog?: ModelCatalogSite, credential?: string): Promise<ModelCatalogSite>;
  getRouting(): Promise<LoopModelRouting>;
  saveRouting(routing: LoopModelRouting): Promise<LoopModelRouting>;
}

export function createNativeLocalModelCommands(
  context: LocalAccountContext,
  invoke: LocalModelInvoke,
): NativeLocalModelCommands {
  const accountArgs = () => ({
    deploymentOrigin: context.deploymentOrigin,
    userId: context.userId,
  });

  return {
    async getCredentialStatus(credentialRef) {
      const result = await invoke("get_agent_credential_status", {
        ...accountArgs(),
        credentialRef,
      });
      return agentCredentialStatusSchema.parse(result);
    },
    async setCredential(input) {
      const result = await invoke("set_agent_credential", {
        ...accountArgs(),
        credentialRef: input.credentialRef,
        kind: input.kind,
        apiKey: input.apiKey,
      });
      return agentCredentialStatusSchema.parse(result);
    },
    async deleteCredential(credentialRef) {
      const result = await invoke("delete_agent_credential", {
        ...accountArgs(),
        credentialRef,
      });
      return agentCredentialStatusSchema.parse(result);
    },
    async listSites() {
      const result = await invoke("list_model_sites", accountArgs());
      return modelSitesDocumentSchema.parse(result);
    },
    async saveSite(site, accountDefault) {
      const result = await invoke("save_model_site", {
        ...accountArgs(),
        site: modelSiteSchema.parse(site),
        accountDefault: accountDefault ?? null,
      });
      return modelSitesDocumentSchema.parse(result);
    },
    async saveModelDefaults(accountDefault) {
      const result = await invoke("save_model_defaults", {
        ...accountArgs(),
        accountDefault: accountDefault ?? null,
      });
      return modelSitesDocumentSchema.parse(result);
    },
    async deleteSite(siteId) {
      const result = await invoke("delete_model_site", { ...accountArgs(), siteId });
      return modelSitesDocumentSchema.parse(result);
    },
    async getCatalog() {
      const result = await invoke("get_model_catalog", accountArgs());
      return modelCatalogSchema.parse(result);
    },
    async saveCatalog(catalog) {
      const result = await invoke("save_model_catalog", { ...accountArgs(), catalog });
      return modelCatalogSchema.parse(result);
    },
    async testAndRefreshSite(site, catalog, credential) {
      const result = await invoke("test_and_refresh_model_site", {
        ...accountArgs(),
        site: modelSiteSchema.parse(site),
        catalog: catalog ?? null,
        credential: credential ?? null,
      });
      return modelCatalogSiteSchema.parse(result) as ModelCatalogSite;
    },
    async getRouting() {
      const result = await invoke("get_loop_model_routing", accountArgs());
      return loopModelRoutingSchema.parse(result);
    },
    async saveRouting(routing) {
      const result = await invoke("save_loop_model_routing", { ...accountArgs(), routing });
      return loopModelRoutingSchema.parse(result);
    },
  };
}
