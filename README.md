modstack
========

# TODO (features)
* Built-in config-helper (recording env-proxy + config lock + only-check-config check + logging).
* AppModule compatibility testing helper.
# TODO ^^^

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

The only mandatory function of an app-module is the asynchronous `initialize`. It takes the resolved configuration and optionally dependencies as parameters. It should return a promise that resolves into an object with at least the instance. On failure, the `initialize` function should throw an exception, which will be caught and handled by ModStack.

> [!NOTE]  
> When the app-module requires no configuration, then the type of `initialize`'s first ("config") parameter must be `null`.

Example app-module with no dependencies:
```typescript
const myAppModule = {
    initialize: async (config: null) => ({
        instance: { dummy() { console.log('Dummy called'); } }
    })
} as const;
```

Example app-module with a single named dependency:
```typescript
const dependentAppModule = {
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

The optional synchronous `configure` takes a dictionary of string-to-string mapped values (typicaly environment variables) as a parameter. It returns the configuration values on success, or a list of failures.

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

A simple layered application could have the following app-modules:
* Database
* External service client
* Business logic
* Request handlers
* Http server (listening for requests)


TODO
* Create stack.
* Add app-modules.
* Complete.

### Lifecycle phases

TODO
* All phases.


### Check app-module type compatibility

TODO


## TODO (docs)
* Lifecycle itself as dependency.
* Built-in app-modules.
    * Built-in signal handler app-module.
    * Built-in management server app-module.
* Code design: (do this or lose many advantages that modstack brings)
    * Avoid back-references!
    * No global variables.
    * Stateless app-module adapters.
    * Any initialize which requires a resource will need a finalize.
    * Logger and telemetry initialized first, finalize last.
    * On finalize failure, likely need process.exit

