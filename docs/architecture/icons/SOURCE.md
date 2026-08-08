# Architecture Diagram Icons

Most brand marks in this directory are pinned from `simple-icons@15.15.0`.
They are copied into the repository so architecture diagrams render and can be
regenerated without a CDN or runtime network dependency.

`elasticsearch.svg` is the multicolor Elasticsearch product mark from
`@elastic/eui@97.3.0`. It is rendered in source-color mode only for OpenSearch
resources; all other architecture icons retain the diagram's monochrome system.

To update them:

1. Review the upstream Simple Icons release and brand guidelines.
2. Replace only the required SVG files.
3. Update each diagram's `brand` and `brandColor` fields if needed.
4. Regenerate the SVG with `scripts/render-architecture-diagram.mjs`.
5. Inspect the rendered README at desktop and narrow widths.

Simple Icons project: <https://simpleicons.org/>
