import * as http from 'http';
import { URL } from 'url';

const getObjectPath = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split('.').filter(p => !!p).reduce((obj: unknown, key) => {
        return obj && typeof obj === 'object' ?
            Array.isArray(obj) && !Number.isInteger(Number.parseInt(key, 10)) ?
            obj.find((el: unknown) => el && typeof el === 'object' && (el as Record<string, unknown>)[key.substring(0, key.indexOf(':'))] === key.substring(key.indexOf(':') + 1)) :
            (obj as Record<string, unknown>)[key] :
            undefined;
    }, obj);
};

interface Logger {
	info: (msg: string) => void;
	error: (msg: string) => void;
}

export const makeControlServer = ({
	defaultPort,
	portConfigKey = 'CONTROL_SERVER_PORT',
	hostConfigKey = 'CONTROL_SERVER_HOST',
	allowStop = false,
	logger,
	info,
}: {
	defaultPort: number;
	portConfigKey?: string;
	hostConfigKey?: string;
	allowStop?: boolean;
	logger?: Logger;
	info?: Record<string, unknown>;
}) => ({
	configure: (envVars: Record<string, string | undefined>) => {
		const rawPort = Number.parseInt(envVars[portConfigKey] ?? `${defaultPort}`);
		const port = rawPort % 1 === 0 && rawPort > 0 && rawPort < 65536 ? rawPort : 0;
		const host = envVars[hostConfigKey] ?? '0.0.0.0';
		return { ok: true, value: { port, host } } as const;
	},
	initialize: async (
		config: { port: number, host: string },
		{ lifecycle }: {
			lifecycle: {
				status: () => { phase: string; inStoppablePhase: boolean; modules: Record<string, unknown> };
				stop: () => void;
			},
		},
	) => {
		const requestHandlers = new Map(Object.entries({
			'/liveness': new Map(Object.entries({
				'GET': () => ({ status: 200, headers: { 'Content-Type': 'text/plain' }, content: 'Live' }),
			})),
			'/readiness': new Map(Object.entries({
				'GET': () => {
					const ready = lifecycle.status().phase === 'ready';
					return { status: ready ? 200 : 503, headers: { 'Content-Type': 'text/plain' }, content: ready ? 'Ready' : 'Not ready' };
				},
			})),
			'/status': new Map(Object.entries({
				'GET': (url: URL) => {
					const status = lifecycle.status();
					const field = url.searchParams.get('field');
					const statusData = field ? getObjectPath(status, field) : status;
					return { status: 200, headers: { 'Content-Type': 'application/json' }, content: JSON.stringify(statusData ?? null) };
				},
			})),
			'/info': new Map(Object.entries({
				'GET': (url: URL) => {
					const field = url.searchParams.get('field');
					const infoData = field ? getObjectPath(info ?? {}, field) : info;
					return { status: 200, headers: { 'Content-Type': 'application/json' }, content: JSON.stringify(infoData ?? null) };
				},
			})),
			'/stop': new Map(Object.entries({
				'POST': () => {
					if (allowStop) {
						if (lifecycle.status().inStoppablePhase) {
							logger?.info('Stopping after control server received stop request.');
							lifecycle.stop();
							return { status: 200, headers: { 'Content-Type': 'text/plain' }, content: 'Stopping' };
						}
						else {
							return { status: 409, headers: { 'Content-Type': 'text/plain' }, content: 'Not in a stoppable phase' };
						}
					}
					else {
						return { status: 423, headers: { 'Content-Type': 'text/plain' }, content: 'Stop not allowed' };
					}
				},
			})),
		}));

		const server = http.createServer((req, res) => {
			const parsedUrl = new URL(req.url ?? '/', 'http://localhost/');
			const pathHandlers = requestHandlers.get(parsedUrl.pathname);
			if (!pathHandlers) {
				res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
			}
			else {
				const reqHandler = pathHandlers.get(req.method ?? '');
				if (!reqHandler) {
					res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method not allowed');
				}
				else {
					try {
						const response = reqHandler(parsedUrl);
						res.writeHead(response.status, response.headers).end(response.content);
					}
					catch (_error: unknown) {
						res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal server error');
					}
				}
			}
		});

		await new Promise<void>((resolve, reject) => {
			server.on('error', (err) => {
				logger?.error(`Control server failed to start listening for requests.`);
				reject(err);
			});
			server.listen(config.port, config.host, () => {
				logger?.info(`Control server listening for http requests on ${server.address()?.toString()}.`);
				resolve();
			});
		});

		return {
			instance: {},
			finalize: async () => {
				await new Promise<void>((resolve, reject) => {
					server.close((err: unknown) => {
						if (err) {
							reject(err);
						}
						else {
							resolve();
						}
					});
				});
			}
		};

	},
	options: { orderedFinalization: true },
});

