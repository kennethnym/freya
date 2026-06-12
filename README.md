# freya

To install dependencies:

```bash
bun install
```

## Packages

### @freya/source-tfl

TfL (Transport for London) feed source for tube, overground, and Elizabeth line alerts.

#### Testing

```bash
cd packages/freya-source-tfl
bun run test
```

#### Fixtures

Tests use fixture data from real TfL API responses stored in `fixtures/tfl-responses.json`.

To refresh fixtures:

```bash
bun run fetch-fixtures
```
