/**
 * Writes src/generated.ts from spec/openapi.json: the request and response
 * types of every route the SDK calls, and `Routes`, which ties each route to
 * its body, query and response. The document is the only source; nothing in
 * the output is typed by hand. It fails on any schema construct it does not
 * know, so a new one is a build error here rather than a wrong type.
 *
 *   node scripts/gen-types.mjs           write src/generated.ts
 *   node scripts/gen-types.mjs --check   exit 1 when it is stale
 *
 * test/generated.test.ts runs the check, so CI fails on a stale file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = 'spec/openapi.json';
const OUT_PATH = 'src/generated.ts';
const WIDTH = 80;
/** En and em dash, by code point so no formatter turns them into literals. */
const LONG_DASHES = new Set(
  [0x2013, 0x2014].map((code) => String.fromCodePoint(code)),
);
const root = new URL('..', import.meta.url);
const inRepo = (path) => fileURLToPath(new URL(path, root));

/** Every route the SDK calls. One missing from the document is an error. */
const SDK_ROUTES = [
  ['POST', '/api/v1/emails/send'],
  ['POST', '/api/v1/emails/send-template'],
  ['POST', '/api/v1/emails/send-bulk'],
  ['GET', '/api/v1/emails/{id}'],
  ['DELETE', '/api/v1/emails/scheduled/{id}'],
  ['GET', '/api/v1/templates'],
  ['POST', '/api/v1/templates'],
  ['GET', '/api/v1/templates/{id}'],
  ['PATCH', '/api/v1/templates/{id}'],
  ['DELETE', '/api/v1/templates/{id}'],
  ['POST', '/api/v1/templates/validate'],
  ['POST', '/api/v1/templates/preview'],
  ['GET', '/api/v1/suppressions'],
  ['POST', '/api/v1/suppressions'],
  ['GET', '/api/v1/suppressions/check'],
  ['DELETE', '/api/v1/suppressions/{email}'],
  ['GET', '/api/v1/usage'],
  ['POST', '/api/v1/forms/{formId}/signups'],
];

const spec = JSON.parse(readFileSync(inRepo(SPEC_PATH), 'utf8'));
const schemas = spec.components?.schemas ?? {};

const fail = (message) => {
  throw new Error(`gen-types: ${message}`);
};

const refName = (ref) => {
  const prefix = '#/components/schemas/';
  if (typeof ref !== 'string' || !ref.startsWith(prefix)) {
    fail(`unsupported $ref ${ref}`);
  }
  const name = ref.slice(prefix.length);
  if (!schemas[name]) fail(`$ref to a missing schema: ${name}`);
  return name;
};

const operations = SDK_ROUTES.map(([method, path]) => {
  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  if (!operation) fail(`${method} ${path} is not in ${SPEC_PATH}`);
  const successes = Object.entries(operation.responses ?? {}).filter(
    ([status]) => /^2\d\d$/.test(status),
  );
  if (successes.length !== 1) {
    fail(`${method} ${path}: ${successes.length} success responses, not 1`);
  }
  const [status, success] = successes[0];
  const response = success.content?.['application/json']?.schema;
  if (!response) fail(`${method} ${path}: its ${status} has no JSON schema`);
  const requestBody = operation.requestBody;
  const body = requestBody?.content?.['application/json']?.schema;
  if (requestBody && !body) fail(`${method} ${path}: a body without JSON`);
  const query = (operation.parameters ?? []).filter((p) => p.in === 'query');
  return {
    key: `${method} ${path}`,
    body,
    bodyRequired: requestBody?.required === true,
    query,
    response,
  };
});

/**
 * A list route answers `allOf: [Base, { data: Item[] }]`: the envelope
 * with its items named. Base is emitted once, generic over its items.
 */
const genericUse = (schema) => {
  if (!Array.isArray(schema.allOf) || schema.allOf.length !== 2) return null;
  const [base, extra] = schema.allOf;
  const keys = Object.keys(extra?.properties ?? {});
  const data = extra?.properties?.data;
  if (!base?.$ref || keys.length !== 1 || data?.type !== 'array') return null;
  return { base: refName(base.$ref), item: data.items };
};

// Which schemas the SDK's routes reach, and whether as a request or a
// response: that decides the public name of a backend `...RestDto`.
const roles = new Map();
const genericBases = new Set();
const visit = (schema, role) => {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const seen = roles.get(name) ?? new Set();
    if (seen.has(role)) return;
    seen.add(role);
    roles.set(name, seen);
    visit(schemas[name], role);
    return;
  }
  const generic = genericUse(schema);
  if (generic) genericBases.add(generic.base);
  for (const part of schema.allOf ?? []) visit(part, role);
  for (const part of schema.oneOf ?? []) visit(part, role);
  for (const part of schema.anyOf ?? []) visit(part, role);
  visit(schema.items, role);
  for (const property of Object.values(schema.properties ?? {})) {
    visit(property, role);
  }
  if (typeof schema.additionalProperties === 'object') {
    visit(schema.additionalProperties, role);
  }
};
for (const operation of operations) {
  visit(operation.body, 'request');
  for (const parameter of operation.query) visit(parameter.schema, 'request');
  visit(operation.response, 'response');
}

const typeName = (name) => {
  if (!name.endsWith('RestDto')) return name;
  const suffix = roles.get(name)?.has('response') ? 'Response' : 'Request';
  return name.replace(/RestDto$/, suffix);
};
const emitted = [...roles.keys()];
const names = emitted.map(typeName);
for (const [index, name] of names.entries()) {
  if (names.indexOf(name) !== index) fail(`two schemas would be ${name}`);
}

const quote = (value) => {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value !== 'string') fail(`unsupported enum value ${value}`);
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
};
const union = (types) => [...new Set(types)].join(' | ');
const arrayOf = (type) => (type.includes(' | ') ? `(${type})[]` : `${type}[]`);

const tsType = (schema) => {
  if (!schema || typeof schema !== 'object') fail('a schema is missing');
  let type;
  if (schema.$ref) {
    type = typeName(refName(schema.$ref));
  } else if (schema.allOf) {
    const generic = genericUse(schema);
    if (generic) {
      type = `${typeName(generic.base)}<${tsType(generic.item)}>`;
    } else if (schema.allOf.length === 1) {
      type = tsType(schema.allOf[0]);
    } else {
      fail(`unsupported allOf ${JSON.stringify(schema)}`);
    }
  } else if (schema.oneOf || schema.anyOf) {
    type = union((schema.oneOf ?? schema.anyOf).map(tsType));
  } else if (schema.enum) {
    type = union(schema.enum.map(quote));
  } else if (schema.type === 'string') {
    type = 'string';
  } else if (schema.type === 'number' || schema.type === 'integer') {
    type = 'number';
  } else if (schema.type === 'boolean') {
    type = 'boolean';
  } else if (schema.type === 'array') {
    type = arrayOf(tsType(schema.items));
  } else if (schema.type === 'object' && !schema.properties) {
    const extra = schema.additionalProperties;
    type =
      extra && typeof extra === 'object' && Object.keys(extra).length > 0
        ? `Record<string, ${tsType(extra)}>`
        : 'Record<string, unknown>';
  } else {
    fail(`unsupported schema ${JSON.stringify(schema)}`);
  }
  return schema.nullable === true ? `${type} | null` : type;
};

/**
 * A JSDoc block, wrapped to the line width, or nothing without text. These
 * ship in dist/ as the SDK's doc comments, where the house rule allows no
 * em or en dash: a description carrying one is fixed in the backend, not
 * here.
 */
const jsdoc = (paragraphs, indent) => {
  const lines = [];
  const width = WIDTH - indent.length - 3;
  for (const paragraph of paragraphs.filter(Boolean)) {
    if ([...String(paragraph)].some((c) => LONG_DASHES.has(c))) {
      fail(`a long dash in the document's text: ${paragraph}`);
    }
    if (lines.length > 0) lines.push('');
    for (const source of String(paragraph)
      .replace(/\*\//g, '*\\/')
      .split('\n')) {
      let line = '';
      for (const word of source.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > width) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      lines.push(line);
    }
  }
  if (lines.length === 0) return [];
  if (lines.length === 1 && indent.length + lines[0].length + 7 <= WIDTH) {
    return [`${indent}/** ${lines[0]} */`];
  }
  return [
    `${indent}/**`,
    ...lines.map((line) => (line ? `${indent} * ${line}` : `${indent} *`)),
    `${indent} */`,
  ];
};

const propertyDocs = (schema) => {
  const description =
    schema.description ??
    (schema.allOf ?? []).find((part) => part.description)?.description;
  const tags = [];
  if (schema.format === 'date-time') tags.push('@format date-time');
  if (schema.default !== undefined) {
    tags.push(`@default ${JSON.stringify(schema.default)}`);
  }
  if (schema.deprecated === true) tags.push('@deprecated');
  return [description, tags.join('\n')];
};

const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name));

/** The members of an object type: one property per entry, with its docs. */
const members = (entries, indent) => {
  const out = [];
  for (const { name, schema, required, docs } of entries) {
    out.push(...jsdoc(docs ?? propertyDocs(schema), indent));
    out.push(`${indent}${key(name)}${required ? '' : '?'}: ${tsType(schema)};`);
  }
  return out;
};

const out = [
  '// Generated from spec/openapi.json by scripts/gen-types.mjs: do not edit.',
  '// After `pnpm spec:update`, run `pnpm types:generate`.',
  '',
];

for (const name of Object.keys(schemas)) {
  if (!roles.has(name)) continue;
  const schema = schemas[name];
  if (schema.type !== 'object' || !schema.properties) {
    fail(`${name} is not an object with properties`);
  }
  const generic = genericBases.has(name) ? '<T>' : '';
  out.push(...jsdoc([schema.description], ''));
  out.push(`export interface ${typeName(name)}${generic} {`);
  const required = new Set(schema.required ?? []);
  for (const [property, value] of Object.entries(schema.properties)) {
    // The envelope's items are what the route names: `data: T[]`.
    const isGenericData = generic !== '' && property === 'data';
    if (isGenericData && value.type !== 'array') {
      fail(`${name}.data is not an array`);
    }
    out.push(...jsdoc(propertyDocs(value), '  '));
    const type = isGenericData ? 'T[]' : tsType(value);
    const optional = required.has(property) ? '' : '?';
    out.push(`  ${key(property)}${optional}: ${type};`);
  }
  out.push('}', '');
}

out.push(
  ...jsdoc(
    [
      'The routes this SDK calls, as the API document declares them: the body, the query and the success response of each. The resources are typed to match, and test/types.test.ts holds them to it.',
    ],
    '',
  ),
);
out.push('export interface Routes {');
for (const operation of operations) {
  out.push(`  '${operation.key}': {`);
  if (operation.query.length > 0) {
    out.push('    query: {');
    out.push(
      ...members(
        operation.query.map((parameter) => ({
          name: parameter.name,
          schema: parameter.schema,
          required: parameter.required === true,
          docs: [
            parameter.description,
            parameter.schema?.default !== undefined
              ? `@default ${JSON.stringify(parameter.schema.default)}`
              : '',
          ],
        })),
        '      ',
      ),
    );
    out.push('    };');
  }
  if (operation.body) {
    const optional = operation.bodyRequired ? '' : '?';
    out.push(`    body${optional}: ${tsType(operation.body)};`);
  }
  out.push(`    response: ${tsType(operation.response)};`);
  out.push('  };');
}
out.push('}', '');

// The repo's formatter lays out what the line width cannot hold (long
// unions), so the file passes lint like any other source file.
const output = execFileSync(
  inRepo('node_modules/.bin/biome'),
  ['format', `--stdin-file-path=${OUT_PATH}`],
  { cwd: inRepo('.'), input: out.join('\n'), encoding: 'utf8' },
);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(inRepo(OUT_PATH), 'utf8');
  } catch {}
  if (current !== output) {
    console.error(
      `${OUT_PATH} is not what ${SPEC_PATH} generates: run pnpm types:generate`,
    );
    process.exit(1);
  }
  console.log(`${OUT_PATH} matches ${SPEC_PATH}.`);
} else {
  writeFileSync(inRepo(OUT_PATH), output);
  console.log(`Wrote ${OUT_PATH}`);
}
