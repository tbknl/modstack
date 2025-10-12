import { makeEnvProxy } from "modstack/utils/env-vars-proxy";
import { describe, expect, it, vi } from "vitest";

describe("env proxy", () => {
	it("allows read access to the underlying env data", () => {
		const envVars = { TEST_VAR: "testValue" };
		const envProxy = makeEnvProxy(envVars);
		expect(envProxy.vars.TEST_VAR).toEqual(envVars.TEST_VAR);
	});

	it("allows check access to the underlying env data", () => {
		const testKey = "TEST_VAR";
		const envVars = { [testKey]: "testValue" };
		const envProxy = makeEnvProxy(envVars);
		expect(testKey in envProxy.vars).toBe(true);
		expect("UNEXISTING_VAR" in envProxy.vars).toBe(false);
	});

	it("does not allow write operations", () => {
		const envProxy = makeEnvProxy({});
		expect(() => {
			envProxy.vars["TEST_KEY"] = "value";
		}).toThrow();
	});

	describe("access logging", () => {
		it("starts with an empty access log", () => {
			const envProxy = makeEnvProxy({});
			expect(envProxy.accessLog()).toEqual([]);
		});

		it("logs access when reading a property that is present", () => {
			const key = "X";
			const value = "env-value";
			const envProxy = makeEnvProxy({ [key]: value });

			envProxy.vars[key];

			expect(envProxy.accessLog()).toEqual([
				{ type: "read", key, present: true, value },
			]);
		});

		it("logs access when reading a property that is not present", () => {
			const key = "X";
			const envProxy = makeEnvProxy({});

			envProxy.vars[key];

			expect(envProxy.accessLog()).toEqual([
				{ type: "read", key, present: false },
			]);
		});

		it("logs access when checking a property that is present", () => {
			const key = "X";
			const value = "env-value";
			const envProxy = makeEnvProxy({ [key]: value });

			key in envProxy.vars;

			expect(envProxy.accessLog()).toEqual([
				{ type: "check", key, present: true },
			]);
		});

		it("logs access when checking a property that is not present", () => {
			const key = "X";
			const envProxy = makeEnvProxy({});

			key in envProxy.vars;

			expect(envProxy.accessLog()).toEqual([
				{ type: "check", key, present: false },
			]);
		});

		it("keeps a log of all accesses", () => {
			const key1 = "X";
			const key2 = "Y";
			const key3 = "Z";
			const value = "env-value";
			const envProxy = makeEnvProxy({ [key1]: value, [key2]: value });

			envProxy.vars[key1];
			key2 in envProxy.vars;
			envProxy.vars[key2];
			key3 in envProxy.vars;

			expect(envProxy.accessLog()).toEqual([
				{ type: "read", key: key1, present: true, value },
				{ type: "check", key: key2, present: true },
				{ type: "read", key: key2, present: true, value },
				{ type: "check", key: key3, present: false },
			]);
		});
	});

	describe("locking", () => {
		it("by default throws when trying to access env vars after locking", () => {
			const envProxy = makeEnvProxy({});
			expect(envProxy.vars["X"]).toBeUndefined();
			envProxy.lock();
			expect(() => envProxy.vars["X"]).toThrow();
		});

		it("allows to access env vars after locking when onLockedAccess returns true", () => {
			const key = "X";
			const onLockedAccess = vi.fn(({}: { key: string }) => true);
			const value = "env-value";
			const envProxy = makeEnvProxy({ [key]: value }, { onLockedAccess });

			expect(envProxy.vars[key]).toEqual(value);
			expect(onLockedAccess).toHaveBeenCalledTimes(0);

			envProxy.lock();
			expect(envProxy.vars[key]).toEqual(value);
			expect(onLockedAccess).toHaveBeenCalledExactlyOnceWith({ key });
		});

		it("throws when trying to access env vars after locking and onLockedAccess returns false", () => {
			const key = "X";
			const onLockedAccess = vi.fn(({}: { key: string }) => false);
			const value = "env-value";
			const envProxy = makeEnvProxy({ [key]: value }, { onLockedAccess });

			expect(envProxy.vars[key]).toEqual(value);
			expect(onLockedAccess).toHaveBeenCalledTimes(0);

			envProxy.lock();
			expect(() => envProxy.vars[key]).toThrow();
			expect(onLockedAccess).toHaveBeenCalledExactlyOnceWith({ key });
		});
	});
});
