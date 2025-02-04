const promiseNotRejected: unique symbol = Symbol('PromiseNotRejected');
export const ensurePromiseReject = <T>(x: T) =>
	(async () => x)()
		.then(() => {
			throw promiseNotRejected;
		})
		.catch((e: unknown) => {
			if (e === promiseNotRejected) {
				throw e;
			} else {
				return e;
			}
		});

const nothingThrown: unique symbol = Symbol('NothingThrown');
export const ensureThrow = (fn: () => unknown) => {
	try {
		fn();
	}
	catch (e: unknown) {
		return e;
	}

	throw nothingThrown;
};
