# Bundle the subagent runtime in the Pi package

The project distributes its Pi skills and the `subagent` extension as one npm Pi package, bundling the pinned `pi-sub-agent@0.1.5` dependency. This avoids a second user-managed installation while keeping the upstream runtime isolated and updateable as a bundled dependency rather than forking its implementation.

## Considered Options

- Ask users to install `pi-sub-agent` separately — rejected because it violates the one-install contract.
- Vendor or fork the extension — rejected because it creates an unnecessary maintenance and security-update burden.

## Consequences

Package releases must keep the bundled dependency and Pi compatibility version aligned. Existing shell-installer users remain supported, while Pi package users receive the runtime through `pi install npm:engineering-harness-skills`.
