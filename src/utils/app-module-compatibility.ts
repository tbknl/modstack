// Infer the instance type of an app-module:
export type AppModuleInstance<AppModule> = AppModule extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly initialize: (...args: any[]) => Promise<{ instance: infer Inst }>;
}
  ? Inst
  : never;

// Infer the dependencies type of an app-module:
export type AppModuleDependencies<AppModule> = AppModule extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly initialize: (cfg: any, deps: infer Deps) => Promise<{ instance: unknown }>;
}
  ? Deps
  : never;

// Checks whether second type argument (_U) is compatible with the first type argument (T).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const isCompatible = <T, _U extends T>() => true;
