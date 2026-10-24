export interface Env {
  CONFIG: KVNamespace;
  AUTH: DurableObjectNamespace;
  ASSETS: Fetcher;
  AUTH_INSTANCE?: string;
}
