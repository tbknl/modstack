export type EnvVars = { [key: string]: string | undefined };

type EnvAccess =
  | {
      readonly type: 'read';
      readonly present: true;
      readonly key: string;
      readonly value: unknown;
    }
  | {
      readonly type: 'read';
      readonly present: false;
      readonly key: string;
    }
  | {
      readonly type: 'check';
      readonly present: boolean;
      readonly key: string;
    };

export const makeEnvProxy = (envVars: EnvVars, { logger }: { logger: { error: (msg: string) => void } }) => {
  let locked = false;

  const checkLock = (key: string) => {
    if (locked) {
      logger.error(`Unallowed access to env var '${key}' outside configuration phase.`);
    }
  };

  const envAccessLog: EnvAccess[] = [];

  const envVarsProxy = new Proxy(envVars, {
    get: (target, prop) => {
      const strProp = String(prop);
      checkLock(strProp);
      const value = target[strProp];
      const present = target.hasOwnProperty(prop);
      envAccessLog.push({
        type: 'read',
        key: strProp,
        ...(present ? ({ present: true, value } as const) : ({ present: false } as const)),
      } as const);
      return value;
    },
    has: (target, prop) => {
      const strProp = String(prop);
      checkLock(strProp);
      const present = target.hasOwnProperty(strProp);
      envAccessLog.push({
        type: 'check',
        key: strProp,
        present,
      });
      return present;
    },
  });

  return {
    vars: envVarsProxy,
    lock() {
      locked = true;
    },
    accessLog() {
      return envAccessLog;
    },
  };
};
