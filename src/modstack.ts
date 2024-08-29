/* eslint-disable */
// TODO: Fix lint errors later.

type EnvVars = Record<string, string | undefined>;
type FinalizeFn = () => Promise<boolean>;
type StatusFn = () => Record<string, unknown>;

interface Mod<Cfg, Inst, Deps extends { readonly [name: string]: unknown }> {
  configure: (
    envVars: EnvVars,
  ) => Readonly<{ ok: true; value: Cfg }> | Readonly<{ ok: false; failure: readonly string[] }>;
  initialize: (cfg: Cfg, deps: Deps) => Promise<{ instance: Inst; finalize?: FinalizeFn; status?: StatusFn }>;
}

type ModState<Inst> = {
  readonly getName: () => string;
  readonly configure: (
    envVars: EnvVars,
  ) => Readonly<{ ok: true }> | Readonly<{ ok: false; failure: readonly string[] }>;
  readonly initialize: () => Promise<Inst | null>;
  readonly getInstance: () => Inst;
  readonly finalize: () => Promise<boolean>;
  readonly status: () => Record<string, unknown>;
};

type ModParams<M> = M extends Mod<infer C, infer I, infer D> ? { C: C; I: I; D: D } : never;
type ModStateParams<M> = M extends ModState<infer I> ? { I: I } : never;

// Check which module instance types are compatible with the dependency type:
type CompatMods<Dep, A extends { readonly [name: string]: ModState<unknown> }> = {
  [N in keyof A]: ModStateParams<A[N]>['I'] extends Dep ? N : never;
}[keyof A];

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
  readonly complete: () => {
    readonly configure: (
      envVars: EnvVars,
    ) => Readonly<{ ok: true }> | Readonly<{ ok: false; failure: readonly string[] }>;
    readonly start: () => Promise<boolean>;
    readonly stop: () => Promise<boolean>;
    readonly status: () => Record<string, unknown>;
  };
};

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

const makeModState = <Cfg, Inst, Deps extends { readonly [Name: string]: unknown }>(
  logger: Logger,
  name: string,
  mod: Mod<Cfg, Inst, Deps>,
  depMap: { [K in keyof Deps]: { getInstance(): Deps[K] } },
): ModState<Inst> => {
  let cfg: ModParams<typeof mod>['C'] | undefined = undefined; // TODO: Make this work when mod.configure is not defined.
  let inst: Inst | undefined = undefined;
  let finalize: FinalizeFn | undefined = undefined;
  let status: StatusFn | undefined = undefined;

  return {
    getName() {
      return name;
    },
    configure(envVars: EnvVars) {
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
          Object.keys(depMap).map((key) => [key, depMap[key].getInstance()]),
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
    getInstance() {
      if (inst === undefined) {
        throw new ModstackError('uninitialized_instance', 'Uninitialized instance cannot be retrieved.');
      }
      return inst;
    },
    async finalize() {
      logger.info(`[${name}] Finalizing module.`);
      const finalizationResult = finalize ? await finalize().catch(() => false) : true;
      logger.info(`[${name}] Finalization finished${finalizationResult ? '' : ' with errors'}.`);
      return finalizationResult;
    },
    status() {
      return status?.() ?? {};
    },
  } as const;
};

const makeLifecycle = (logger: Logger, modStates: readonly ModState<unknown>[]) => {
  let phase: Phase = 'loading';

  const changePhase = (newPhase: Phase, allowedCurrentPhases?: Phase[]) => {
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
    async stop() {
      changePhase('stopping', ['ready', 'starting_failed']);
      logger.info(`Starting finalization of all modules.`);
      // TODO: Support waiting for all previous modules to finalize first.
      const finalizationOk = (await Promise.all([...modStates].reverse().map((modState) => modState.finalize()))).every(
        (ok) => ok,
      );
      changePhase(finalizationOk ? 'stopped' : 'stopping_failed');
      return finalizationOk;
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

const makeModstack = <A extends { readonly [Name: string]: ModState<unknown> }>(
  { logger, lifecycleDep }: { logger: Logger; lifecycleDep: { setLifecycle(lc: Lifecycle): void } },
  modStates: A,
): ModStackBuilder<A> =>
  ({
    add: (name, mod, depKeys) => {
      const depModStates = Object.fromEntries(
        Object.keys(depKeys).map((depName) => [depName, modStates[depKeys[depName]]] as const),
      ) as unknown as { [DK in keyof ModParams<typeof mod>['D']]: { getInstance(): ModParams<typeof mod>['D'][DK] } }; // TODO: Type!
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
  let lifecycle: Lifecycle | null = null;

  return {
    setLifecycle: (lc: Lifecycle) => {
      lifecycle = lc;
    },
    mod: {
      configure(_envVars: EnvVars) {
        return { ok: true, value: null } as const;
      },
      async initialize(_cfg: null) {
        return {
          instance: {
            // TODO: Expose functionality here!
            status() {
              if (!lifecycle) {
                throw new ModstackError(
                  'lifecycle_not_set',
                  'Lifecycle-dep module instantiated without lifecycle being set.',
                );
              }
              return lifecycle.status();
            },
          },
        };
      },
    },
  } as const;
};

export const modstack = ({ logger }: { logger: Logger }) => {
  const lifecycleDep = makeLifecycleDep();
  return makeModstack({ logger, lifecycleDep }, {}).add('lifecycle', lifecycleDep.mod, {});
};
