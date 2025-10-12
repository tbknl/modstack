class FailureToInfer<_Subject extends string> {}

// Infer the instance type of an app-module:
export type AppModuleInstance<AppModule> = AppModule extends {
	readonly initialize: (...args: any[]) => Promise<{ instance: infer Inst }>;
}
	? Inst
	: FailureToInfer<"AppModuleInstance">;

// Infer the dependencies type of an app-module:
export type AppModuleDependencies<AppModule> = AppModule extends {
	readonly initialize: (
		cfg: any,
		deps: infer Deps,
	) => Promise<{ instance: unknown }>;
}
	? Deps
	: FailureToInfer<"AppModuleDependencies">;

// Checks whether second type argument (_U) is compatible with the first type argument (T).
export const isCompatible = <T extends {}, _U extends T>() => true;
