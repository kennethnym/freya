# Dependency Patches

## `@ark/schema@0.56.0`

`@ark/schema` is patched for React Native/Hermes compatibility.

ArkType's internal `Disjoint` type extends `Array`. In Hermes, `Array.prototype.map()`
does not always preserve the subclass instance. If `Disjoint.withPrefixKey()` returns
a plain array, later ArkType reduction code can call schema methods such as `isRoot()`
on that array and crash during app startup.

The patch mirrors ArkType's existing guard in `Disjoint.invert()` by wrapping the
mapped result back into `new Disjoint(...)` when Hermes returns a plain array.

Upstream context:

- https://github.com/arktypeio/arktype/issues/1415
- https://github.com/arktypeio/arktype/issues/1027
