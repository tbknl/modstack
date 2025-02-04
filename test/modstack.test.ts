import { describe, it, expect } from 'vitest';
import { modstack, ModstackError } from 'modstack';
import { ensureThrow, ensurePromiseReject } from './helpers/utils.js';

// TODO: logger.
// TODO: lifecycle dep
// TODO: complete + lifecycle

type EnvVars = Record<string, string | undefined>;

const makeLoggerMock = () => ({
	_msgs: [] as { level: 'info' | 'error', msg: string, data: unknown }[],
	info(msg: string, data?: unknown) { this._msgs.push({ level: 'info', msg, data })},
	error(msg: string, data?: unknown) { this._msgs.push({ level: 'error', msg, data })},
});

const makeMod = () => ({
	configure: (_envVars: EnvVars) => ({ ok: true as const, value: null }),
	initialize: async (_cfg: null) => ({ instance: {} }),
});

describe('mod stack builder', () => {
	it('has add and complete methods', () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger });
		expect(builder).toHaveProperty('add', expect.any(Function));
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to add a mod to the stack', () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger }).add('mod-a', makeMod(), {});
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('requires a unique name for each module', () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger })
			.add('mod', makeMod(), {})
			// @ts-expect-error: mod name already used.
			.add('mod', makeMod(), {});
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to add multiple mods to the stack', () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger })
			.add('mod-a', makeMod(), {})
			.add('mod-b', makeMod(), {})
			.add('mod-c', makeMod(), {});
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to define compatible dependencies for a module', () => {
		const logger = makeLoggerMock();
		const basicCalculatorMod = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: {
					square: (x: number) => x * x,
					sum: (a: number[]) => a.reduce((s, x) => s + x, 0),
					root: (x: number) => Math.sqrt(x),
				}
			}),
		};
		const advancedCalculatorMod = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, { calculator }: {
				calculator: { square(x: number): number; sum(a: number[]): number }
			}) => ({
				instance: {
					sumOfSquares: (a: number[]) => calculator.sum(a.map(calculator.square)),
				}
			}),
		};
		const builder = modstack({ logger })
			.add('basic-calc', basicCalculatorMod, {})
			.add('adv-calc', advancedCalculatorMod, { calculator: 'basic-calc' });
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to define optional dependencies for a module', () => {
		const logger = makeLoggerMock();
		const modA = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a!' },
			}),
		};
		const modB = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, _deps: {
				a?: { sayA(): string },
			}) => ({ instance: {} }),
		};
		const builder = modstack({ logger })
			.add('mod-a', modA, {})
			.add('mod-b-with-a-dep', modB, { a: 'mod-a' })
			.add('mod-b-without-a-dep', modB, {});
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to define multiple dependencies for a module', () => {
		const logger = makeLoggerMock();
		const modA = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a!' },
			}),
		};
		const modB = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, _deps: {
				a: { sayA(): string },
				b: { sayB(): string },
				bOpt?: { sayB(): string },
			}) => ({ instance: {} }),
		};
		const builder = modstack({ logger })
			.add('mod-a', modA, {})
			.add('mod-b', modB, {})
			.add('mod-c', modC, { a: 'mod-a', b: 'mod-b' });
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('allows to define an array of same-type dependencies for a module', () => {
		const logger = makeLoggerMock();
		const modA1 = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a1!' },
			}),
		};
		const modA2 = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a2!' },
			}),
		};
		const modB = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, _multipleA: Record<string, { sayA(): string }>) => ({
				instance: {}
			}),
		};
		const builder = modstack({ logger })
			.add('mod-a1', modA1, {})
			.add('mod-a2', modA2, {})
			.add('mod-b', modB, { a1: 'mod-a1', a2: 'mod-a2' })
			.add('mod-b-with-zero-deps', modB, {});
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('checks that dependencies are type-compatible', () => {
		const logger = makeLoggerMock();
		const modB = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, _deps: {
				a: { sayA(): string },
			}) => ({ instance: {} }),
		};
		const builder = modstack({ logger })
			.add('mod-b', modB, {})
			// @ts-expect-error: mod-b is not type-compatible with mod-a.
			.add('mod-c-1', modC, { a: 'mod-b' })
			// @ts-expect-error: mod-d is not part of the stack.
			.add('mod-c-2', modC, { a: 'mod-d' });
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('checks that all non-optional dependencies are provided', () => {
		const logger = makeLoggerMock();
		const modA = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'b!' },
			}),
		};
		const modB = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
			configure: () => ({ ok: true as const, value: null }),
			initialize: async (_cfg: null, _deps: {
				a1: { sayA(): string },
				a2: { sayA(): string },
				b: { sayB(): string },
				bOpt?: { sayB(): string },
			}) => ({ instance: {} }),
		};
		const builder = modstack({ logger })
			.add('mod-a', modA, {})
			.add('mod-b', modB, {})
			.add('mod-c', modC, { a1: 'mod-a', a2: 'mod-a', b: 'mod-b' })
			// @ts-expect-error: dependency for 'a2' is not provided.
			.add('mod-c-error', modC, { a1: 'mod-a', b: 'mod-b' })
			// @ts-expect-error: dependency for 'a2' is not provided.
			.add('mod-c-error-2', modC, { a1: 'mod-a', b: 'mod-b', bOpt: 'mod-b' });
		expect(builder).toHaveProperty('complete', expect.any(Function));
	});

	it('returns the lifecycle object on complete', () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger })
			.add('mod-a', makeMod(), {})
			.add('mod-b', makeMod(), {});
		const lifecycle = builder.complete();
		expect(lifecycle).toHaveProperty('configure', expect.any(Function));
		expect(lifecycle).toHaveProperty('start', expect.any(Function));
		expect(lifecycle).toHaveProperty('stop', expect.any(Function));
		expect(lifecycle).toHaveProperty('status', expect.any(Function));
	});
});

describe('lifecycle', () => {
	const makeStandardTestModstackBuilder = () => {
		const logger = makeLoggerMock();
		const builder = modstack({ logger })
			.add('mod-a', makeMod(), {})
			.add('mod-b', makeMod(), {});
		return builder;
	};

	it('begins in "loading" phase', () => {
		const lifecycle = makeStandardTestModstackBuilder().complete();
		expect(lifecycle.status().phase).toEqual('loading');
	});

	describe("configuration", () => {
		it('switches to "configuring" phase during configuration', () => {
			let observedPhase = '';
			const lifecycleSurrogate = {
				status: () => ({ phase: '' }),
			};

			const configPhaseCheckerMod = {
				configure: (_envVars: EnvVars) => {
					observedPhase = lifecycleSurrogate.status().phase;
					return { ok: true, value: null } as const;
				},
				initialize: async (_cfg: null) => ({ instance: {} }),
			};

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('config-phase-checker', configPhaseCheckerMod, {})
				.complete();
			lifecycleSurrogate.status = lifecycle.status;

			lifecycle.configure({});

			expect(observedPhase).toEqual('configuring');
		});

		it('does not allow to start configuration from a phase other than "loading"', () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			lifecycle.configure({});
			const error = ensureThrow(() => lifecycle.configure({}));
			expect(error).toBeInstanceOf(ModstackError);
			expect(error).toHaveProperty('code', 'phase.incorrect');
		});

		it('switches to "configured" phase after successful configuration', () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			expect(lifecycle.configure({}).ok).toBe(true);
			expect(lifecycle.status().phase).toEqual('configured');
		});

		it('switches to "configuration_failed" phase after failed configuration', () => {
			const lifecycle = makeStandardTestModstackBuilder()
				.add('failing-config', {
					...makeMod(),
					configure: () => ({ ok: false as const, failure: ['always failing'] }),
				}, {})
				.complete();
			expect(lifecycle.configure({}).ok).toBe(false);
			expect(lifecycle.status().phase).toEqual('configuration_failed');
		});

		it('calls configure with env on all mods even when one fails', () => {
			const audit: { modName: string; envVars: unknown }[] = [];

			const makeAuditConfigureMod = ({ modName, fail }: { modName: string; fail?: boolean }) => ({
				configure: (envVars: EnvVars) => {
					audit.push({ modName, envVars });
					return fail ? { ok: false as const, failure: ['does not matter'] } : { ok: true as const, value: null };
				},
				initialize: async (_cfg: null) => ({ instance: {} }),
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', makeAuditConfigureMod({ modName: 'a' }), {})
				.add('mod-b', makeAuditConfigureMod({ modName: 'b', fail: true }), {})
				.add('mod-c', makeAuditConfigureMod({ modName: 'c' }), {})
				.complete();

			const env = {
				ONE: 'value1',
				TWO: 'value2',
			} as const;
			lifecycle.configure(env);

			expect(audit).toEqual([
				{ modName: 'a', envVars: env },
				{ modName: 'b', envVars: env },
				{ modName: 'c', envVars: env },
			]);
		});

		it('returns failures from all mods when configuration fails for at least one mod', () => {
			const makeFailConfigureMod = ({ failures }: { failures: string[] }) => ({
				configure: (_envVars: EnvVars) => ({ ok: false as const, failure: failures }),
				initialize: async (_cfg: null) => ({ instance: {} }),
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', makeMod(), {})
				.add('mod-fail-b', makeFailConfigureMod({ failures: ['failed-b-1']}), {})
				.add('mod-c', makeMod(), {})
				.add('mod-fail-d', makeFailConfigureMod({ failures: ['failed-d-1', 'failed-d-2']}), {})
				.add('mod-e', makeMod(), {})
				.complete();

			const configResult = lifecycle.configure({});

			expect(configResult.ok).toBe(false);
			expect(!configResult.ok && configResult.failure).toEqual([
				'[mod-fail-b] failed-b-1',
				'[mod-fail-d] failed-d-1',
				'[mod-fail-d] failed-d-2',
			]);
		});

		it('returns failures when an exception is thrown during configuration', () => {
			const makeThrowingConfigureMod = ({ errorMsg }: { errorMsg: string }) => ({
				configure: (_envVars: EnvVars) => { throw new Error(errorMsg); },
				initialize: async (_cfg: null) => ({ instance: {} }),
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', makeMod(), {})
				.add('mod-throw-b', makeThrowingConfigureMod({ errorMsg: 'error-b' }), {})
				.add('mod-c', makeMod(), {})
				.add('mod-throw-d', makeThrowingConfigureMod({ errorMsg: 'error-d' }), {})
				.add('mod-e', makeMod(), {})
				.complete();

			const configResult = lifecycle.configure({});

			expect(configResult.ok).toBe(false);
			expect(!configResult.ok && configResult.failure).toEqual([
				'[mod-throw-b] Error: error-b',
				'[mod-throw-d] Error: error-d',
			]);
		});
	});

	describe('start', () => {
		it('switches to "starting" phase during initialization', async () => {
			let observedPhase = '';

			const initPhaseCheckerMod = {
				configure: (_envVars: EnvVars) => ({ ok: true, value: null } as const),
				initialize: async (_cfg: null, { lifecycle }: { lifecycle: { status: () => { phase: string }}}) => {
					observedPhase = lifecycle.status().phase;
					return { instance: {} };
				},
			};

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('init-phase-checker', initPhaseCheckerMod, { lifecycle: 'lifecycle' })
				.complete();

			lifecycle.configure({});
			await lifecycle.start();

			expect(observedPhase).toEqual('starting');
		});

		it('does not allow to start initialization from a phase other than "configured"', async () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			const startPromise = lifecycle.start();
			await expect(startPromise).rejects.toThrow(ModstackError);
			expect(await ensurePromiseReject(startPromise)).toMatchObject({
				code: 'phase.incorrect',
			});
		});

		it('switches to "ready" phase after successful initialization', async () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			lifecycle.configure({});
			const startResult = await lifecycle.start();

			expect(startResult).toBe(true);
			expect(lifecycle.status().phase).toEqual('ready');
		});

		it('switches to "starting_failed" phase on error during initialization', async () => {
			const lifecycle = makeStandardTestModstackBuilder()
				.add('failing-config', {
					...makeMod(),
					initialize(_cfg) { throw new Error('Init error!'); },
				}, {})
				.complete();

			lifecycle.configure({});
			const startResult = await lifecycle.start();

			expect(startResult).toBe(false);
			expect(lifecycle.status().phase).toEqual('starting_failed');
		});

		it('calls initialize on all mods in order', async () => {
			const audit: { modName: string }[] = [];

			const makeAuditInitMod = ({ modName }: { modName: string }) => ({
				...makeMod(),
				initialize: async (_cfg: null) => {
					audit.push({ modName });
					return { instance: {} };
				},
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', makeAuditInitMod({ modName: 'a' }), {})
				.add('mod-b', makeAuditInitMod({ modName: 'b' }), {})
				.add('mod-c', makeAuditInitMod({ modName: 'c' }), {})
				.complete();

			lifecycle.configure({});
			const startResult = await lifecycle.start();

			expect(startResult).toBe(true);
			expect(audit).toEqual([
				{ modName: 'a' },
				{ modName: 'b' },
				{ modName: 'c' },
			]);
		});

		it('does not call initialize on later mods after initialization error', async () => {
			const audit: { modName: string }[] = [];

			const makeAuditInitMod = ({ modName, fail }: { modName: string; fail?: true }) => ({
				...makeMod(),
				initialize: async (_cfg: null) => {
					audit.push({ modName });
					if (fail) {
						throw new Error('Init error!');
					}
					return { instance: {} };
				},
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', makeAuditInitMod({ modName: 'a' }), {})
				.add('mod-b', makeAuditInitMod({ modName: 'b', fail: true }), {})
				.add('mod-c', makeAuditInitMod({ modName: 'c' }), {})
				.complete();

			lifecycle.configure({});
			const startResult = await lifecycle.start();

			expect(startResult).toBe(false);
			expect(audit).toEqual([
				{ modName: 'a' },
				{ modName: 'b' },
			]);

		});

		it('allows to use the instances of previously initialized mods as dependencies', async () => {
			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-a', {
					...makeMod(),
					initialize: async () => ({ instance: { doA() {} } }),
					// TODO: Audit
				}, {})
				.add('mod-b', {
					...makeMod(),
					async initialize(_cfg: null, deps: { modA: { doA: () => void } }) {
						deps.modA.doA();
						return { instance: { doB() {} } };
					}
				}, { modA: 'mod-a' })
				.complete();

			lifecycle.configure({});
			// TODO!!!
		});

		it('TODO: Only allows compatible deps', async () => {
			// TODO
		});

		it('', async () => {
			// TODO
		});

	});

	// TODO: Stop
	// TODO: Status
});
