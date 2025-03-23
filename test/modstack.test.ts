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
			initialize: async (_cfg: null) => ({
				instance: {
					square: (x: number) => x * x,
					sum: (a: number[]) => a.reduce((s, x) => s + x, 0),
					root: (x: number) => Math.sqrt(x),
				}
			}),
		};
		const advancedCalculatorMod = {
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
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a!' },
			}),
		};
		const modB = {
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
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a!' },
			}),
		};
		const modB = {
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
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

	it('allows to define a record of same-type dependencies for a module', () => {
		const logger = makeLoggerMock();
		const modA1 = {
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a1!' },
			}),
		};
		const modA2 = {
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'a2!' },
			}),
		};
		const modB = {
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
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
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
			initialize: async (_cfg: null) => ({
				instance: { sayA: () => 'b!' },
			}),
		};
		const modB = {
			initialize: async (_cfg: null) => ({
				instance: { sayB: () => 'b!' },
			}),
		};
		const modC = {
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

	// Type-safety checks for configure:
	modstack({ logger: makeLoggerMock() })
	// @ts-expect-error: configure not defined (because first initialize parameter is not null)
		.add('x1', { initialize: async () => ({ instance: {} }) } as const, {})
	// @ts-expect-error: configure not defined (because first initialize parameter is not null)
		.add('x2', { initialize: async (_cfg: string) => ({ instance: {} }) } as const, {})
		.add('x3', {
			// @ts-expect-error: configure return value type is not assignable to config parameter of initialize.
			configure: (_envVars: EnvVars) => ({ ok: true, value: 123 } as const),
			initialize: async (_cfg: string) => ({ instance: {} })
		}, {})
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
					initialize(_cfg: null) { throw new Error('Init error!'); },
				} as const, {})
				.complete();

			lifecycle.configure({});
			const startResult = await lifecycle.start();

			expect(startResult).toBe(false);
			expect(lifecycle.status().phase).toEqual('starting_failed');
		});

		it('calls initialize on all mods in order', async () => {
			const audit: { modName: string }[] = [];

			const makeAuditInitMod = ({ modName }: { modName: string }) => ({
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
			const events: string[] = [];
			const lifecycle = modstack({ logger })
				.add('mod-a', {
					initialize: async (_cfg: null) => ({ instance: { doA(event: string) { events.push(event); } } }),
				} as const, {})
				.add('mod-b', {
					async initialize(_cfg: null, deps: { modA: { doA: (event: string) => void } }) {
						deps.modA.doA('on-init mod-b');
						return { instance: {} };
					}
				} as const, { modA: 'mod-a' })
				.complete();

			lifecycle.configure({});
			const started = await lifecycle.start();
			expect(started).toEqual(true);
			expect(events).toEqual(['on-init mod-b']);
		});
	});

	describe('stop', () => {
		it('switches to "stopping" phase during finalization', async () => {
			let observedPhase = '';

			const stoppingPhaseCheckerMod = {
				initialize: async (_cfg: null, { lifecycle }: { lifecycle: { status: () => { phase: string }}}) => {
					return {
						instance: {},
						finalize: async () => { observedPhase = lifecycle.status().phase; },
					};
				},
			};

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('stopping-phase-checker', stoppingPhaseCheckerMod, { lifecycle: 'lifecycle' })
				.complete();

			lifecycle.configure({});
			const started = await lifecycle.start();
			expect(started).toEqual(true);
			lifecycle.stop();
			await lifecycle.stopped();

			expect(observedPhase).toEqual('stopping');
		});

		it('does not allow to stop from a phase other than "ready" or "starting_failed"', async () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			expect(() => lifecycle.stop()).toThrow(ModstackError);
			expect(() => lifecycle.stop()).toThrow(expect.objectContaining({
				code: 'phase.incorrect',
			}));
		});

		it('allows to stop from phase "ready"', async () => {
			const lifecycle = makeStandardTestModstackBuilder().complete();
			lifecycle.configure({});
			const started = await lifecycle.start();
			expect(started).toEqual(true);
			expect(() => lifecycle.stop()).not.toThrow();
			await lifecycle.stopped();
		});

		it('allows to stop from phase "starting_failed"', async () => {
			const lifecycle = makeStandardTestModstackBuilder()
				.add('fail-to-start', {
					async initialize(_cfg: null) { throw new Error('Failed to initialize!'); },
				} as const, {})
				.complete();
			lifecycle.configure({});
			const started = await lifecycle.start();
			expect(started).toEqual(false);
			expect(() => lifecycle.stop()).not.toThrow();
			await lifecycle.stopped();
		});

		it('finalizes modules in reverse order', async () => {
			const events: string[] = [];

			const makeFinalizeMod = (modId: string) => ({
				initialize: async (_cfg: null) => {
					return {
						instance: {},
						finalize: async () => { events.push(`Finalizing ${modId}`); },
					};
				},
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('mod-1', makeFinalizeMod('1'), {})
				.add('mod-2', makeFinalizeMod('2'), {})
				.add('mod-3', makeFinalizeMod('3'), {})
				.complete();

			lifecycle.configure({});
			await lifecycle.start();
			lifecycle.stop();
			await lifecycle.stopped();

			expect(events).toEqual([
				'Finalizing 3',
				'Finalizing 2',
				'Finalizing 1',
			]);
		});

		it.only('wait with module finalization until all its dependents are finalized', async () => {
			const events: string[] = [];

			const makeFinalizeMod = (modId: string, options?: { delay?: number }) => ({
				initialize: async (_cfg: null) => {
					return {
						instance: {},
						finalize: async () => {
							if (options?.delay) {
								events.push(`Delaying finalize ${modId}`);
								await new Promise<void>((resolve) => setTimeout(resolve, options.delay));
							}
							events.push(`Finalizing ${modId}`);
						},
					};
				},
			});

			const logger = makeLoggerMock();
			const lifecycle = modstack({ logger })
				.add('modX0', makeFinalizeMod('X0'), {})
				.add('modX1', makeFinalizeMod('X1'), {})
				.add('modA1', makeFinalizeMod('A1'), {})
				.add('modA2', makeFinalizeMod('A2'), {})
				.add('modA3', makeFinalizeMod('A3', { delay: 10 }), { modA2: 'modA2' })
				.add('modB1', makeFinalizeMod('B1'), { modX1: 'modX1' })
				.add('modB2', makeFinalizeMod('B2'), { modB1: 'modB1' })
				.add('modB3', makeFinalizeMod('B3'), {})
				.add('modB4', makeFinalizeMod('B4', { delay: 10 }), { modB3: 'modB3', modB1: 'modB1' })
				.add('modC1', makeFinalizeMod('C1'), {})
				.complete();

			lifecycle.configure({});
			await lifecycle.start();
			lifecycle.stop();
			await lifecycle.stopped();

			expect(events).toEqual([
				'Finalizing C1',
				'Delaying finalize B4',
				'Finalizing B2',
				'Delaying finalize A3',
				'Finalizing A1',
				'Finalizing X0',
				'Finalizing B4',
				'Finalizing B3',
				'Finalizing B1',
				'Finalizing X1',
				'Finalizing A3',
				'Finalizing A2',
			]);
		});

		// TODO: Ordered finalization option.
		// TODO: Succeed finalization by (1) returning void (2) returning true;
		// TODO: Fail finalization by (1) throwing error (2) returning false.
		// TODO: Switches phase to 'stopped' after successful finalization.
		// TODO: Switches phase to 'stopping_failed' after failing finalization.
	});

	// TODO: Status
});
