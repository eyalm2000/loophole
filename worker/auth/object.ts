import { AuthService, type AuthStorage } from './service';
import type { Env } from '../types';
import { HttpError, json } from '../errors';
import { ConnectionProbe } from '../dns/connection';
import { digest } from './crypto';

// Every operation joins one queue, including asynchronous password work and KV writes.
// That keeps ownership claims and configuration revisions serialized across awaits.
export class AuthObject {
  private service: AuthService;
  private probes: ConnectionProbe;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private state: DurableObjectState,
    env: Env,
  ) {
    const storage: AuthStorage = {
      get: (key) => state.storage.get(key),
      put: (key, value) => state.storage.put(key, value),
      delete: (key) => state.storage.delete(key),
      list: (prefix) => state.storage.list({ prefix }),
    };
    this.service = new AuthService(storage, env);
    this.probes = new ConnectionProbe(storage);
  }
  fetch(request: Request): Promise<Response> {
    const job = this.pending.then(() => this.dispatch(request));
    this.pending = job.catch(() => undefined);
    return job;
  }
  private async dispatch(request: Request): Promise<Response> {
    try {
      const input = (await request.json()) as {
        action: string;
        token: string;
        client: string;
        renew?: boolean;
        pin: string;
        next: string;
        config: unknown;
        host: string;
        hostname: string;
      };
      let result: unknown;
      switch (input.action) {
        case 'state':
          result = { initialized: await this.service.initialized() };
          break;
        case 'setup':
          result = await this.service.setup(input.pin, input.client);
          break;
        case 'login':
          result = await this.service.login(input.pin, input.client);
          break;
        case 'session':
          result = await this.service.session(input.token);
          break;
        case 'status': {
          const config = await this.service.config(input.token);
          result = await this.probes.status(
            await digest(input.token || input.client),
            config.domain,
            input.renew === true,
          );
          break;
        }
        case 'observe-dns':
          await this.probes.observe(input.hostname);
          result = { ok: true };
          break;
        case 'logout':
          await this.service.logout(input.token);
          result = { ok: true };
          break;
        case 'config':
          result = await this.service.config(input.token);
          break;
        case 'save':
          result = await this.service.save(input.token, input.config, input.host);
          break;
        case 'pin':
          await this.service.changePin(input.token, input.pin, input.next, input.client);
          result = { ok: true };
          break;
        case 'diagnostic':
          await this.service.session(input.token);
          await this.service.limit(input.client, 'diagnostic', 12);
          result = { ok: true };
          break;
        case 'verify-domain':
          await this.service.session(input.token);
          await this.service.limit(input.client, 'verify-domain', 120);
          result = { ok: true };
          break;
        default:
          throw new HttpError(404, 'Unknown operation.');
      }
      if (!(await this.state.storage.getAlarm()))
        await this.state.storage.setAlarm(Date.now() + 3600000);
      return json(result);
    } catch (error) {
      return error instanceof HttpError
        ? json({ error: error.message }, error.status, error.headers)
        : json({ error: 'Could not complete the operation.' }, 503);
    }
  }
  async alarm(): Promise<void> {
    await this.service.cleanup();
    await this.probes.cleanup();
    await this.state.storage.setAlarm(Date.now() + 3600000);
  }
}
