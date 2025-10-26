modstack
========

Register application modules and guide them through the runtime lifecycle.


## What is `modstack` ?

ModStack is a library package that aims to provide structure to Typescript applications. It promotes a number of good practices for code design, which help to produce maintainable and testable code, while providing (more) predictable operations. This is achieved by splitting up your application, in whichever way you prefer, into independent **app-modules**.

App-modules define their dependencies through typescript types/interfaces according to their needs, but they don't know which concrete dependency will be connected at runtime. In the **composition root**, the `modstack` library helps to add all app-modules to the application app-module-stack (a.k.a. "modstack") in a declarative way, where the **type-compatibility** is checked on the connections between dependents and their dependencies.

ModStack strongly encourages to follow a strict **application runtime lifecycle** (simply called "lifecycle" in most places in this document). The lifecycle strictly defines what actions are allowed and not allowed to perform during each of its phases. ModStack helps you to strictly follow these phases, resulting in a clear code structure and predictable runtime operations. It guides each app-module in the stack through the lifecycle.

ModStack is non-intrusive, which means that it can work together with any other library or framework, and you will not need to import from it in any part of the code other than the composition root. Through adding a simple adapter layer, literally anything can be plugged in. The app-modules or adapters actually aren't specific for ModStack. They only expose a set of functions, that are logical to have anyway, which can be called by anyone from anywhere.

ModStack does not (and will never) require any dependencies itself.


## Application runtime lifecycle

Lifecycle phases for a working application:
* `loading`: Modules are loaded; app-module stack is defined; logger is initialized.
    * Loading modules must be free of side-effects.
* `configuring`: Modules configure themselves from configuration source data (typically environment variables).
    * Configuration is a synchronous phase.
    * All configuration must be done in this phase.
    * Typical configuration actions are reading environment variables or static configuration files.
* `starting`: App-modules are initialized in their stack order; instances of dependencies are provided to dependents.
    * The application will (try to) connect to its dependencies (services, databases, etc.). Upon failure, the application will not be started.
* `ready`: All modules are successfully initialized; application is running.
* `stopping`: App-modules are finalizing gracefully; dependents finalize before dependencies.
* `stopped`: All modules are successfully finalized; application is stopped.


### Lifecycle failure

A number of these phases can end in a failure, breaking the regular lifecycle. These failures each have a corresponding phase, which is an alternative endpoint of the lifecycle.
* `configuration_failed`: Failure occurred during the `configuring` phase. For example, an exception occurs, or the configuration function explicitly returns a failure, because a mandatory environment variable is absent. Even if the configuration of an app-module fails, all remaining app-modules will still be called to configure themselves. All failures combined will be returned.
* `starting_failed`: Initialization of an app-module failed with an exception. The `starting` phase will be interrupted immediately. Depending on the `autoStopOnError` argument of the `lifecycle.start` function, the already initialized app-modules will be finalized, which will set the current phase as `stopping`.
* `stopping_failed`: During the `stopping` phase, finalization of an app-module failed.


## Application modules

Application modules (in short: **app-modules**) are independent parts, which together compose an application. There is no rule that defines what functionality should go into an app-module and what should be separated, or how many source files it can consist of. But, following the ideas of modularity, it's a good idea to split the application code into coherent parts and connect them through well-defined interfaces. When a part can be configured and initialized on it's own, then it's definitely a good idea to make an app-module for it.

Typically, some of the app-modules of an application will be generic/reusable, while others are specific to that application. For example: a generic app-module for the database client and a specific app-module for the application's business logic.


### Dependencies

App-modules can depend on other app-modules which are added earlier in the stack. An app-module describes the typescript type of their dependencies. In this way, the dependent doesn't have to know which other app-module is actually used as the dependency, resulting in a modular, well-testable code design. ModStack uses the dependency types to determine which app-modules will produce instances compatible with each dependency type. In the stack definition, the dependencies are connected to the dependents by their name. ModStack checks that all non-optional dependencies are filled in and that all dependencies are type-compatible.

> [!NOTE]  
> Because dependencies are connected to dependents by name (which is a typescript literal string), incompatibilities will be indicated by a typescript error indicating that the specific dependency's name string can't be assigned to the dependency key of the dependent, while it will not show the cause of the incompatibility.

> [!TIP]  
> ModStack includes an app-module compatibility type helper, typically used in tests only. See the usage section for an example.


### Interface

#### Initialize

The central function of an app-module is the asynchronous `initialize`. It takes the resolved configuration and optionally dependencies as parameters. It should return a promise that resolves into an object with at least the instance. On failure, the `initialize` function should throw an exception, which will be caught and handled by ModStack.

> [!NOTE]  
> When the app-module requires no configuration, then the type of `initialize`'s first ("config") parameter must be `null`.

Example app-module with no dependencies:
```typescript
const myAppModule = {
    configure: () => ({ ok: true, value: null } as const),
    initialize: async (config: null) => ({
        instance: { dummy() { console.log('Dummy called'); } }
    })
} as const;
```

Example app-module with a single named dependency:
```typescript
const dependentAppModule = {
    configure: () => ({ ok: true, value: null } as const),
    initialize: async (config: null, dependencies: { other: { doSomething: () => void } }) => ({
        instance: {
            dummy() {
                other.doSomething();
                console.log('Dummy called');
            }
        }
    })
} as const;
```

A more realistic (but still very simplified) example, where the app-module is created from a function, and uses its dependency also in the initialization phase.
```typescript
interface Database {
    connect: (host: string, port: number) => Promise<{
        query: (q: string) => Promise<unknown>;
    }>;
}

const makeMyAppModule = ({ logger }: { logger: { error: (msg: string) => void } }) => ({
    configure: () => ({ ok: true, value: null } as const),
    initialize: async (config: null, { db }: { db: Database }) => {
        return {
            instance: {
                async createUser(username: string) {
                    return db.query(`INSERT (${username}) INTO users`);
                }
            }
        };
    })
} as const);
```


#### Configure

The synchronous `configure` takes a dictionary of string-to-string mapped values (typicaly environment variables) as a parameter. It returns the configuration values on success, or a list of failures.

The configuration values can be of an arbitrary type, but they must be compatible with the first ("config") parameter of the `initialize` function.

Example:
```typescript
const myConfigurableAppModule = {
    configure: (env: Record<string, string | undefined) => {
        const welcomeMsg = env.WELCOME;
        if (!welcomeMsg) {
            return { ok: false, failure: ['Welcome message not found!'] } as const;
        }
        return { ok: true, value: { welcomeMsg } } as const;
    },
    initialize: async (config: { welcomeMsg: string}) => {
        console.log('Hello', welcomeMsg);
        return { instance: {} };
    },
} as const;
```

> [!NOTE]  
> It recommended that both `configure` and `initialize` are pure functions, as ModStack keeps track of the configuration state. The configuration is returned from the `configure` function and passed to the first parameter of the `initialize` function, which must be type-compatible.


#### Finalize

Besides the instance, the initialization can optionally return an asynchronous `finalize` function, which is typically used to de-allocate resources acquired during initialization, such as closing database connections and stop listening for incoming requests or events.

> [!TIP]  
> Before de-allocating resources, it may be good to handle all ongoing transactions. For example, finalization can start by stopping listening for new incoming messages, then wait for handling of all currently processing messages to be finished.

Example:
```typescript
const myFinalizingAppModule = {
    configure: () => ({ ok: true, value: null } as const),
    initialize: async (config: null) => {
        const dbConnection = await db.connect('localhost', 1234).catch((err) => {
            logger.error(`Database connection error: ${err}`);
            throw err;
        });

        return {
            instance: {
                query: async (query: string) => dbConnection.execute(query),
            },
            async finalize() {
                await dbConnection.destroy();
            },
        };
    },
} as const;
```


#### Status

Optionally, the initialization can return return a synchronous `status` function, which can expose arbitrary information about the status of the app-module. The status of all app-module's in the stack can be retrieved through the lifecycle object, which will call the `status` function of each individual app-module.

Example
```typescript
const myStatusExposingAppModule = {
    configure: () => ({ ok: true, value: null } as const),
    initialize: async (config: null) => {
        const counter = { value: 0 };
        const makeInstance = (counter: { value: number }) => ({
            callMe() { counter.value++; },
        });

        return {
            instance: makeInstance(),
            status: () => ({
                callCount: counter.value,
            }),
        };
    },
} as const;
```


#### Options

The `options` property on the app-module is optional. It may contain the following options:

* `orderedFinalization` (boolean): Wait with finalizing this app-module until all app-modules higher in the stack (i.e. which were added/initialized after this one) have finished their finalization, as if this app-module would be a dependency of all of them. Please note that all app-modules lower in the stack will also postpone their finalization until finalization starts on this app-module. This option is typically not used on regular app-modules. It can be convenient in cases were an app-module instance needs to "stay alive" until the last moment before the application lifecycle stops; for example a control-server app-module which reports the service's liveness and readiness to its environment.


Example:
```typescript
const myAppModule = {
    initialize: async (config: null) => ({
        instance: {},
    }),
    options: {
        orderedFinalization: true,
    },
} as const;
```

### App-module adapters

Any existing library, module or class can easily be wrapped in an app-module adapter, so it can be used with ModStack. The other way around, an app-module can be integrated with any other application without using ModStack. An app-module adapter has no dependency on ModStack itself.


## Usage

### Building the app-module stack

A simplified layered application could have the following app-modules:
* Database client
* External service client
* Service layer (containing business logic)
* Request handlers (controller layer)
* Http server (listening for requests)

The code to build the app-module stack for this application, would look like this:
```typescript
import { modstack } from 'modstack';

const lifecycle = modstack({ logger: console })
    .add('postgresql-client', postgresqlClientAppModule, {})
    .add('payment-service-client', paymentServiceClientAppModule, {})
    .add('order-service', orderServiceAppModule, {
        orderDataSource: 'postgresql-client',
        paymentService: 'payment-service-client',
    })
    .add('order-http-controller', orderHttpControllerModule, { orderService: 'order-service' })
    .add('api-server', makeHttpServer({ port: 5000 }), { orderController: 'order-http-controller' })
    .complete(); // Complete the stack and return the application instance lifecycle.
```

### Lifecycle phases

Given the `lifecycle` instance, the remainder of the application's start-up module could look like this:

> [!NOTE]  
> The `modstack` package contains some built-in app-modules and utilities that help implement some common functionality.

```typescript
const configResult = lifeycle.config(process.env);

if (!configResult.ok) {
    logger.error('Configuration errors:', JSON.stringify(configResult.failure, null, 2));
    process.exit(1);
}

const { started } = await lifecycle.start({ autoStopOnError: true });
if (started) {
    (['SIGHUP', 'SIGINT', 'SIGTERM'] as const).forEach((sig) => {
        process.once(sig, () => {
            if (lifecycle.status().inStoppablePhase) {
                logger.info(`Stopping after receiving signal ${sig}`);
                lifecycle.stop();
            }
        });
    });
}
const stopped = await lifecycle.stopped();
await logger.stop(); // NOTE: Finalize/flush the logger and potentially other observability modules.
process.exit(started && stopped.ok ? 0 : 1);
```


### Utilities

#### Check app-module type compatibility

When assiging dependencies while adding app-modules to the stack, the compiler will not allow to use incompatible app-modules. As the assignment of dependencies is done by using the app-module's name string, the typescript error that will be shown when trying to assign an incompatible app-module looks like `Type 'string' is not assignable to type 'never'.`. This doesn't provide any information about what the type compatibility failure is.

The modstack package exports a utility for checking compatibility between an app-module used as a dependency and the declared type of the dependency on the dependent app-module. In case of an incompatibility, the compiler failure will provide the details about the compatibility failure.

> [!TIP]
> The recommended location for the compatibility checks between app-modules that are meant to be compatible, is as part of the unit tests.

The utility has the following exports:
* `type AppModuleInstance<AppModule>`: Returns the type of the instance that the app-module will produce on initialization. This instance type should be compatible with the declared dependency type, in order to be usable as the dependency instance.
* `type AppModuleDependencies<AppModule>`: Returns the type of the dependencies of an app-module. This is typically an object mapping dependency names to its type.
* `isCompatible<T, U extends T>()`: A helper function that only compiles when the second type argument is compatible with the first.

Usage example:
```ts 
import {
  type AppModuleInstance,
  type AppModuleDependencies,
  isCompatible,
} from 'modstack/utils/app-module-compatibility';

// Given some example app-modules:
const appModuleA = {
    async initialize(config: null) => ({
        instance: {
            print(msg: string) { console.log(msg); },
        },
    }),
};
const appModuleB = {
    async initialize(config: null, { printer: { print: (msg: string) => void } }) => ({
        instance: {
            doSomething() { printer.print('Hello!'); },
        },
    }),
};

describe('Check app-module A compatibility', () => {
    it('is compatible with app-module B', () => {
        expect(isCompatible<
          AppModuleDependencies<typeof appModuleB>['printer'],
          AppModuleInstance<typeof appModuleA>
        >()).to.be(true);
    });
});
```


#### Environment variables proxy

The `env-vars-proxy` utility wraps the environment variables (e.g. from `process.env`) in an opaque proxy object, that keeps track of which variable names are accessed and whether they are present.

The environment variables can be locked, causing an error to be logged when environment variables are accessed when locked. Usually environment variables are only read during the configuration phase of the application.

Usage example:
```typescript
import { makeEnvProxy } from 'modstack/utils/env-vars-proxy';

// ...

const logger = console;

const env = makeEnvProxy(process.env, { logger });

// ...
const configResult = lifecycle.configure(env.vars);
env.lock(); // Don't allow reading environment variables atfer the configuration phase.

logger.info('Environment variables accessed:', env.accessLog());
```

> [!TIP]
> To only check which environment variables an application consumes without starting the application, the program can be exited after printing the environment variable access log.


### Lifecycle as a dependency

Some functionality of the lifecycle is available to through the implicitly instantiated app-module `lifecycle`, which can be used as a dependency by other app-modules on the stack.

The lifecycle app-module exposes these lifecycle functions:
* `status()`: Retrieve the lifecycle status.
* `stop()`: Trigger the lifecycle to stop.


### Built-in app-modules

The `modstack` package has some app-modules built-in, which implement common application needs.

#### Stop-signal-handler

The built-in stop-signal-handler app-module takes the lifecycle as a dependency. It waits for a signal event ('SIGINT', 'SIGHUP' or 'SIGTERM') on the process, and then triggers the lifecycle to stop if it's in a stoppable phase.

The signal handler is typically one of the first app-modules on the stack, in order to have the signal handler available while the other app-modules initialize.

Usage example:
```typescript
import { modstack } from 'modstack';
import { makeStopSignalHandler } from 'modstack/app-modules/stop-signal-handler';

const lifecycle = modstack({ logger: console })
    .add('signal-handler', makeStopSignalHandler({ logger: console }), { lifecycle: 'lifecycle' })
    // Other app-modules go here...
    .complete();
```

#### Control-server

The built-in control-server app-module takes the lifecycle as a dependency. It starts a server listening for these specific http requests:
* `GET /liveness` always returns status code `200`, indicating that the application is alive.
* `GET /readiness` returns status code `200` whenever the lifecycle phase is "ready" and otherwise returns status code `503`.
* `GET /status` returns all information returned by `lifecycle.status()` in JSON format. An optional `?field=<field.name.separated.by.dots>` query parameter can be provided to return only a specific field of the JSON object.
* `GET /info` returns all information provided with the optional `info` parameter when creating the control-server in JSON format. An optional `?field=<field.name.separated.by.dots>` query parameter can be provided to return only a specific field of the JSON object.
* `POST /stop` triggers the lifecycle to stop, but only if the control-server is configured to allow that.

The signal handler is typically one of the first app-modules on the stack, in order to report the liveness to the application controller even while initializating the application. To remain available throughout the finalization phase, the control-server postpones its finalization until all stacked app-modules are finalized.

Usage example
```typescript
import { modstack } from 'modstack';
import { makeControlServer } from 'modstack/app-modules/control-server';

const logger = console;
const lifecycle = modstack({ logger })
    .add('control-server', makeControlServer({ defaultPort: 3333, allowStop: true, info: { version: '1.0' }, logger }), { lifecycle: 'lifecycle' })
    // Other app-modules go here...
    .complete();
```


## Code design recommendations

### Stateless app-modules

For modstack to ensure that each lifecycle phase is correctly handled, it's important that there's no shared state within an app-module between the `configure` and `initialize` functions. Sharing state through global variables should be avoided too.

The same app-module could be used to create more than one instance in the stack.


### Avoid back-references

App-modules defined later in the stack can rely on earlier defined app-modules to be initialized and available. But the reverse is not the case. Therefore an app-module should not pass references to itself or any of its required resources to its dependencies, for example through "registering" as a callback at a dependency. Instead, the dependencies should expose their own functionality to be used by dependent app-modules.


### Acquired resources require finalization

Resources acquired during an app-module's initialization or running state will very likely require finalization. Examples are: closing network connections and destroying worker pools.


### Full app-module independence

It's the intent for app-module's to be completely independent from one another, even if they do have a run-time dependency declared in the module stack. A dependent app-module declares the type of the dependency **itself**, by expressing what it requires from the dependency. This can be different from the actual type of the dependency, as long as it is type-compatible.

To be clear: A dependent does not "know" which other app-module will be connected in the module stack to supply the dependency instance. Therefore it **should not imported the dependency type from the (supposed) dependency app-module**.

It's recommended to apply "full abstraction" between app-module dependencies. This means not only that the dependent doesn't "know" the dependency, it also means that the dependent doesn't "know" how the dependency achieves its goals.

An example: An app-module could require a `"user-datasource"` dependency to retrieve user data according to an interface with non-implementation-specific functions like `getUserById`. There can be a `"user-database"` app-module that implements the `getUserById` function by retrieving it from a database directly. But over time there may be additional logic required when retrieving user data from the database and separate "user-service" application is created. A new `"user-service-client"` app-module that also implements `getUserById` is now created to take over the `"user-database"`'s' place in the module stack as the dependency connected to the app-module requiring a `"user-datasource"`, without that app-module being aware of the change.


### App-module factory function

Most often app-modules have some fixed settings that it needs to work. For those type of settings is common to create the app-module through a factory function, which takes those settings as parameters, to be available to the app-module.

Example:
```typescript
    .add('public-http-server', makeHttpServer({ defaultPort: 5000, logger: console }))
```


### Preliminary program requirements

There may be preliminary requirements of a program, which need to be available during the entire lifespan of the process. A logger is the easiest example. Other types of telemetry/observability belong to the same group.

These instances are not part of the application module stack, but are initialized before and finalized after. The modstack builder actually needs a logger itself. To cleanly terminate the program, the logger needs it's data flushed after the module stack is fully finalized, right before exiting the process.


### Force exit process on failure

When initialization or finalization of app-module fail, it may be that there are still event handlers registered in the program that prevent a "clean" exit. In that case it's likely a good idea to force exit the process through callng the `process.exit(exit_code)` function.


### Keep app-modules independent of modstack

App-modules implement the interfaces of `modstack` implicitly. Through typescript's structural typing they can be used safely with ModStack. But they may be used without modstack as well. Or they can be generically re-usable. For all these reasons, app-module implementations **must not import from modstack** or have any other (in)direct dependency on `modstack`.

---

## Authors

Dave van Soest <https://github.com/tbknl>

## LICENSE

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

