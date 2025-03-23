/* eslint-disable */
// TODO: Fix lint errors later.

type EnvVars = Record<string, string | undefined>;
type FinalizeFn = () => Promise<boolean | void>;
type StatusFn = () => Record<string, unknown>;

type ModCfg<Cfg> = {
	readonly configure: (envVars: EnvVars) => Readonly<{ ok: true; value: Cfg }> | Readonly<{ ok: false; failure: readonly string[] }>;
};

type ModOptions = {
	readonly orderedFinalization?: boolean;
};

type Mod<Cfg, Inst, Deps extends { readonly [name: string]: unknown }> = (Cfg extends null ? Partial<ModCfg<Cfg>> : ModCfg<Cfg>) & {
	readonly initialize: (cfg: Cfg, deps: Deps) => Promise<{ instance: Inst; finalize?: FinalizeFn; status?: StatusFn }>;
	readonly options?: ModOptions;
};

type ModState<Inst> = {
	readonly getName: () => string;
	readonly getOptions: () => ModOptions;
	readonly configure: (
		envVars: EnvVars,
	) => Readonly<{ ok: true }> | Readonly<{ ok: false; failure: readonly string[] }>;
	readonly initialize: () => Promise<Inst | null>;
	readonly getInstance: (dependent: { finalized: () => Promise<void> }) => Inst;
	readonly finalize: () => Promise<boolean>;
	readonly finalized: () => Promise<void>;
	readonly status: () => Record<string, unknown>;
};

type ModParams<M> = M extends Mod<infer C, infer I, infer D> ? { C: C; I: I; D: D } : never;
type ModStateParams<M> = M extends ModState<infer I> ? { I: I } : never;

// Check which module instance types are compatible with the dependency type:
export type CompatMods<Dep, A extends { readonly [name: string]: ModState<unknown> }> = {
	[N in keyof A]: ModStateParams<A[N]>['I'] extends Dep ? N : never;
}[keyof A];

// Lifecycle phases.
type Phase =
	| 'loading'
	| 'configuring'
	| 'configuration_failed'
	| 'configured'
	| 'starting'
	| 'starting_failed'
	| 'ready'
	| 'stopping'
	| 'stopping_failed'
	| 'stopped';

// Error to be thrown in case modstack is incorrectly used, e.g. when trying to make an incorrect phase transition.
export class ModstackError extends Error {
	constructor(
		public readonly code: string,
		msg: string,
	) {
		super(msg);
	}
}

// Logger interface.
interface Logger {
	info: (msg: string, data?: unknown) => void;
	error: (msg: string, data?: unknown) => void;
}

const makeResolvable = <ResolveType>() => {
	let resolve: (value: ResolveType) => void = () => {};
	const promise = new Promise<ResolveType>((r) => { resolve = r; });
	return { promise, resolve };
};

const makeModState = <Cfg, Inst, Deps extends { readonly [Name: string]: unknown }>(
	logger: Logger,
	name: string,
	mod: Mod<Cfg, Inst, Deps>,
	depMap: { [K in keyof Deps]: { getInstance: (dependent: { finalized: () => Promise<void> }) => Deps[K]; finalize: FinalizeFn } },
): ModState<Inst> => {
	let cfg: ModParams<typeof mod>['C'] | undefined = undefined; // TODO: Make this work when mod.configure is not defined.
	let inst: Inst | undefined = undefined;
	const dependents: { finalized: () => Promise<void> }[] = [];
	let finalize: FinalizeFn | undefined = undefined;
	let finalizationPromise: Promise<boolean> | undefined = undefined;
	let status: StatusFn | undefined = undefined;

	const finalized = () => {
		if (!finalizationPromise) {
			throw new ModstackError('not_finalizing', 'Cannot wait for finalization when not finalizing.');
		}
		return finalizationPromise.then(() => {});
	};

	return {
		getName() {
			return name;
		},
		getOptions() {
			return mod.options ?? {};
		},
		configure(envVars: EnvVars) {
			if (!mod.configure) {
				// NOTE: When configure does not exist `Cfg` must be `null`.
				cfg = null!; // TODO: Ensure type-safety?
				return { ok: true };
			}
			try {
				const cfgResult = mod.configure(envVars);
				if (cfgResult.ok) {
					cfg = cfgResult.value;
				} else {
					return { ok: false, failure: cfgResult.failure } as const;
				}
			} catch (err: unknown) {
				return { ok: false, failure: [`${err}`] } as const;
			}
			return { ok: true } as const;
		},
		async initialize() {
			if (cfg !== undefined) {
				logger.info(`[${name}] Initializing module.`);
				const selectedDeps = Object.fromEntries(
					Object.keys(depMap).map((key) => [key, depMap[key].getInstance({ finalized })]),
				) as unknown as Deps; // TODO: Make more type-safe!
				try {
					const initResult = await mod.initialize(cfg, selectedDeps);
					inst = initResult.instance;
					finalize = initResult.finalize;
					status = initResult.status;
					logger.info(`[${name}] Initialization successful.`);
				} catch (err: unknown) {
					logger.error(`[${name}] Initialization failed.`);
				}
			}
			return inst ?? null;
		},
		getInstance(dependent: { finalized: () => Promise<void> }) {
			if (inst === undefined) {
				throw new ModstackError('uninitialized_instance', 'Uninitialized instance cannot be retrieved.');
			}
			dependents.push(dependent);
			return inst;
		},
		async finalize() {
			if (!finalizationPromise) {
				finalizationPromise = (async () => {
					if (!inst) {
						return true;
					}
					if (dependents.length) {
						logger.info(`[${name}] Waiting for dependent modules to finish finalization.`);
						await Promise.all(dependents.map((dep) => dep.finalized()));
					}
					logger.info(`[${name}] Finalizing module.`);
					const finalizationResult = finalize ? await finalize().catch(() => false) ?? true : true;
					logger.info(`[${name}] Finalization finished${finalizationResult ? '' : ' with errors'}.`);
					return finalizationResult;
				})();
			}
			return finalizationPromise;
		},
		finalized,
		status() {
			return status?.() ?? {};
		},
	} as const;
};

const makeLifecycle = (logger: Logger, modStates: readonly ModState<unknown>[]) => {
	let phase: Phase = 'loading';
	const stopped = makeResolvable<{ ok: boolean }>();

	const changePhase = (newPhase: Phase, allowedCurrentPhases?: readonly Phase[]) => {
		if (allowedCurrentPhases && !allowedCurrentPhases.includes(phase)) {
			const errorMsg = `Cannot change lifecycle phase to '${newPhase}' from current phase '${phase}'.`;
			logger.error(errorMsg);
			throw new ModstackError('phase.incorrect', errorMsg);
		}
		phase = newPhase;
		logger.info(`Lifecycle phase changed to '${newPhase}'.`);
	};

	return {
		configure: (envVars: EnvVars) => {
			changePhase('configuring', ['loading']);
			const configResults = modStates.map((modState) => [modState.getName(), modState.configure(envVars)] as const);
			const result = configResults.every((r) => r[1].ok)
				? ({ ok: true } as const)
				: ({
					ok: false,
					failure: configResults
					.map(([name, cfgRes]) => (!cfgRes.ok ? cfgRes.failure.map((f) => `[${name}] ${f}`) : ([] as const)))
					.flat(),
				} as const);
			changePhase(result.ok ? 'configured' : 'configuration_failed');
			return result;
		},
		async start() {
			changePhase('starting', ['configured']);
			logger.info(`Starting initialization of all modules.`);
			for (const modState of modStates) {
				const inst = await modState.initialize();
				if (!inst) {
					changePhase('starting_failed');
					return false;
				}
			}
			changePhase('ready');
			return true;
		},
		stop() {
			if (phase !== 'stopping') {
				changePhase('stopping', ['ready', 'starting_failed']);
				logger.info(`Starting finalization of all modules.`);
				(async () => {
					const reversedModStates = [...modStates].reverse();
					const finalizationPromises: Promise<boolean>[] = [];

					for (const modState of reversedModStates) {
						if (modState.getOptions().orderedFinalization) {
							const finalizationOk = (await Promise.all(finalizationPromises)).every((ok) => ok);
							finalizationPromises.splice(0, finalizationPromises.length, Promise.resolve(finalizationOk));
						}
						finalizationPromises.push(modState.finalize());
					}
					const finalizationOk = (await Promise.all(finalizationPromises)).every((ok) => ok);

					changePhase(finalizationOk ? 'stopped' : 'stopping_failed');
					stopped.resolve({ ok: finalizationOk });
				})();
			}
		},
		async stopped() {
			return stopped.promise;
		},
		status() {
			return {
				phase,
				modules: modStates.map((modState) => [modState.getName(), modState.status()]),
			};
		},
	} as const;
};

type Lifecycle = ReturnType<typeof makeLifecycle>;

// Recursive ModStackBuilder builder type.
export type ModStackBuilder<
	A extends {
		readonly [name: string]: ModState<unknown>;
	},
> = {
	readonly add: <
	Name extends string extends Name ? 'must be a string literal' : string,
	Cfg,
	Inst,
	Deps extends { readonly [name: string]: unknown },
	DepKeys extends {
		readonly [K in keyof Deps]: CompatMods<Deps[K], A> & keyof A;
	},
  >(
	  name: Name extends keyof A ? never : Name, // Prevents already registered name to be added.
	  mod: Mod<Cfg, Inst, Deps>,
	  depKeys: DepKeys,
  ) => ModStackBuilder<{} & A & { [K in Name]: ModState<Inst> }>;
	readonly complete: () => Lifecycle;
};

const makeModstack = <A extends { readonly [Name: string]: ModState<unknown> }>(
	{ logger, lifecycleDep }: { logger: Logger; lifecycleDep: { setLifecycle: (lc: Lifecycle) => void } },
	modStates: A,
): ModStackBuilder<A> =>
	({
		add: (name, mod, depKeys) => {
			const depModStates = Object.fromEntries(
				Object.keys(depKeys).map((depName) => [depName, modStates[depKeys[depName]]] as const),
			) as unknown as {
				[DK in keyof ModParams<typeof mod>['D']]: {
					getInstance: (dependent: { finalized: () => Promise<void> }) => ModParams<typeof mod>['D'][DK];
					finalize: () => Promise<boolean>;
				};
			}; // TODO: Type!
			return makeModstack({ logger, lifecycleDep }, {
				...modStates,
				[name]: makeModState(logger, name, mod, depModStates),
			} as const);
		},
		complete: () => {
			const lifecycle = makeLifecycle(logger, Object.values(modStates));
			lifecycleDep.setLifecycle(lifecycle);
			return lifecycle;
		},
	}) as const;

const makeLifecycleDep = () => {
	let lifecyclePlaceholder: Lifecycle | null = null;

	return {
		setLifecycle(lifecycle: Lifecycle) {
			lifecyclePlaceholder = lifecycle;
		},
		mod: {
			async initialize(_cfg: null) {
				if (!lifecyclePlaceholder) {
					throw new ModstackError(
						'lifecycle_not_set',
						'Lifecycle-dep module instantiated without lifecycle being set.',
					);
				}
				const lifecycle = lifecyclePlaceholder;

				return {
					instance: {
						status: () => lifecycle.status(),
						stop: () => lifecycle.stop(),
					},
				};
			},
			options: {
				orderedFinalization: true,
			},
		},
	} as const;
};

export const modstack = ({ logger }: { logger: Logger }) => {
	const lifecycleDep = makeLifecycleDep();
	return makeModstack({ logger, lifecycleDep }, {}).add('lifecycle', lifecycleDep.mod, {});
};
