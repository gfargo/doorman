import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { createGenerator, Config as TsJsonSchemaGeneratorConfig } from 'ts-json-schema-generator'

const config = {
  path: resolve(__dirname, '../src/lib/types.ts'),
  type: 'FirewallConfig',
  additionalProperties: false,
} as TsJsonSchemaGeneratorConfig

const schemaOutputPath = resolve(__dirname, '../schema/firewall-config.schema.json')
const schemaAsVariableOutputPath = resolve(__dirname, '../src/constants/schema.ts')

const schema = createGenerator(config).createSchema(config.type)

// Add some metadata to the schema
const schemaWithMeta = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Doorman Config',
  description: 'Schema for doorman project configuration files',
  ...schema,
}

// Header comment for generated files
const headerComment = `/**
 * THIS FILE IS AUTO-GENERATED - DO NOT EDIT
 * 
 * Generated using ts-json-schema-generator
 * Run 'pnpm build:schema' to regenerate this file
 * Source: schema/generate-schema.ts
 */

export const SCHEMA_URL = '${process.env.SCHEMA_URL || 'https://doorman.griffen.codes/schema.json'}'
`

// Write the schema to a file as a variable so it can be used for validation
const schemaAsVariable = `${headerComment}
export const schema = ${JSON.stringify(schemaWithMeta, null, 2)}
`
writeFileSync(schemaAsVariableOutputPath, schemaAsVariable)

// Write the JSON schema without the comment header, as a standalone file
writeFileSync(schemaOutputPath, JSON.stringify(schemaWithMeta, null, 2))

// eslint-disable-next-line no-console
console.log(`\x1b[32m✨ Schema generated at \x1b[1m${schemaOutputPath}\x1b[0m\x1b[32m\x1b[0m`)
