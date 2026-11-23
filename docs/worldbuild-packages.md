# Worldbuild packages

A Worldbuild exports as a `.klwb` package: a zip with `worldbuild.json` and the images it names.
Every part of a world travels in it; `src/main/features/worldbuild/package-coverage.js` declares
what the package does with each table and each part, and its coverage tests fail when something
new is left undeclared.

## Package identity

A package names its records by `ref`, the id each one has in the world that exported it. Those ids
change on import, so they cannot tell a later version of the package which part is which. Three
things can:

- **`packageId` and `packageVersion`.** A world gets a package id the first time the person exports
  it and keeps it through every later export. The version moves only when the content does, and
  `packageHash` (sha256 of the content without the header) is what decides it. A package built only
  to copy a world, for a new story in the same world, gets no identity.
- **`uid` on every record with an id of its own:** entities, Knowledge entries, Facts, occurrences,
  in-world texts and background chapters (`IDENTIFIED` in the coverage registry). In the world that
  wrote a record, its uid is its own id. A world that imports it keeps the uid in
  `worldbuild_package_uids` and exports it again, so the uid holds through any number of imports,
  re-exports and new stories. Parts without an id of their own are found by what they are (`KEYED`):
  links by their ends, templates by type, fields and rules by key, which stays fixed through renames.
- **The origin.** An import of a package with an identity records it in `worldbuild_package_origins`,
  with the package itself as `base_json`. A package from before identities records nothing, and
  worlds imported before this was added have no origin: neither is guessed.

The one exception is Evenwell, whose package the app ships and seeds itself. A world seeded from
a copy without an identity gets its origin once the bundled package has one
(`src/main/features/worldbuild/package-adoption.js`): each packaged part is found in the world by
type and name, following renames the story made, or by its exact content, and only a single sure
match receives a uid. What the story made and what was deleted get none. The base is the package as
that world received it, so a world seeded on beta.1 keeps a base without the inn's rooms that came in
beta.2. Only origin and uid rows are written; the world itself is not touched.

None of this changes what an import does. A second import of the same package still lands a second
copy, with its own origin. The ids are the ground a Worldbuild Update stands on: matched by uid, a
newer version's canon can replace what the author changed, while the base shows what this world
changed since, by hand or in play, so that stays.
