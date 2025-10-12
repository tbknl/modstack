
interface Logger {
	info: (msg: string) => void;
}

export const makeStopSignalHandler = ({ logger }: { logger?: Logger }) => ({
	configure: () => ({ ok: true, value: null } as const),
	initialize: async (
		_cfg: null,
		{ lifecycle }: {
			lifecycle: {
				stop: () => void,
				status: () => {
					inStoppablePhase: boolean;
					phase: string;
				}
			}
		}
	) => {
		(['SIGHUP', 'SIGINT', 'SIGTERM'] as const).forEach((sig) => {
			process.on(sig, () => {
				const status = lifecycle.status();
				if (status.inStoppablePhase) {
					logger?.info(`Stopping after receiving signal ${sig}.`);
					lifecycle.stop();
				}
				else {
					logger?.info(`Ignoring received signal ${sig}, because lifecycle is in the non-stoppable phase ${status.phase}.`);
				}
			});
		});
		return { instance: {} };
	},
	options: { orderedFinalization: true },
} as const);
