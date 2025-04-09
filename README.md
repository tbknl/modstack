modstack
========

# TODO (features)
* Built-in signal handler app-module.
* Built-in management server app-module.
* Built-in config-helper (recording env-proxy + config lock).
* Tests for autoStopOnError.
* Tests for interrupt-start.
# TODO ^^^

Register application modules and guide them through the runtime lifecycle.


## What is `modstack` ?

ModStack is a library package that aims to provide structure to Typescript applications. It promotes a number of good practices for code design, which help to produce maintainable and testable code, while providing (more) predictable operations. This is achieved by splitting up your application, in whichever way you prefer, into independent **app-modules**.s

App-modules define their dependencies through typescript types/interfaces according to their needs, but they don't know which concrete dependency will be connected at runtime. In the **composition root**, the `modstack` library helps to add all app-modules to the application app-module-stack (a.k.a. "modstack") in a declarative way, where the **type-compatibility** is checked on the connections between dependents and their dependencies.

ModStack strongly encourages to follow a strict **application runtime lifecycle** (simply called "lifecycle" in most places in this document). The lifecycle strictly defines what actions are allowed and not allowed to perform during each of its phases. ModStack helps you to strictly follow these phases, resulting in a clear code structure and predictable runtime operations. It guides each app-module in the stack through the lifecycle.

ModStack is non-intrusive, which means that it can work together with any other library or framework, and it will not need to import from it in any part of the code other than the composition root. Through adding a simple adapter layer, literally anything can be plugged in.

ModStack does not (and will never) require any dependencies itself.


## Application runtime lifecycle

Lifecycle phases for a working application:
* `loading`: Modules are loaded; app-module stack is defined; logger is initialized.
    * Loading modules must be free of side-effects.
* `configuring`: Modules configure themselves from configuration source data (typically environment variables).
    * All configuration must be done in this phase.
* `starting`: App-modules are initializing; instances of dependencies are provided to dependents.
    * The application will (try to) connect to its dependencies (services, databases, etc.). Upon failure, the application will not be started.
* `ready`: All modules are successfully initialized; application is running.
* `stopping`: App-modules are finalizing gracefully; dependents finalize before dependencies.
* `stopped`: All modules are successfully finalized; application is stopped.

TODO
* Corresponding failure states per phase.


## Application modules

TODO
* Methods/interface
* Generic/reusable vs specific


### Example app-module stack

A layered application could have the following app-modules:
* Database
* External service client
* Business logic
* Request handlers
* Server (listening for requests)


## Usage

### Building the app-module stack

TODO
* Create stack.
* Add app-modules.
* Complete.

### Lifecycle phases

TODO


## TODO (docs)
* Logger initialized first.
* Lifecycle itself as dependency.
* Built-in app-modules.
* Code design: (do this or lose many advantages that modstack brings)
    * Avoid back-references!
    * No global variables.
    * Stateless app-module adapters.
    * Any initialize which requires a resource will need a finalize.
* On finalize failure, likely need process.exit

