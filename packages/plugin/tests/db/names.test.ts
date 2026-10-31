import { is, Table } from 'drizzle-orm'
import { getTableConfig, isPgEnum } from 'drizzle-orm/pg-core'
import { describe, expect, test } from 'vitest'
import { TABLES, COLUMNS, ENUMS } from '../../src/db/names.js'
import * as schema from '../_fixtures/generated-schema.js'

const pluginTable = (name: string) => /^_?xp_/.test(name)
const tables = Object.values(schema).filter(value => is(value, Table)).map(table => getTableConfig(table))
const pluginTables = tables.filter(table => pluginTable(table.name))
const enumNames = Object.values(schema).flatMap(value => isPgEnum(value) ? [value.enumName] : [])

describe('SQL identifiers match the generated Payload schema', () => {
  test('every plugin table, column and enum is represented, with no invented identifiers', () => {
    expect(Object.values(TABLES).sort()).toEqual(pluginTables.map(table => table.name).sort())
    for (const key of Object.keys(TABLES) as Array<keyof typeof TABLES>) {
      const table = pluginTables.find(table => table.name === TABLES[key])
      expect(table, TABLES[key]).toBeDefined()
      expect(Object.values(COLUMNS[key]).sort(), TABLES[key]).toEqual(table!.columns.map(column => column.name).sort())
    }
    expect(Object.values(ENUMS).sort()).toEqual(enumNames.sort())
  })

  test('events dedupe_key is varchar with the unique index needed by ON CONFLICT', () => {
    const events = getTableConfig(schema.xp_events)
    expect(schema.xp_events.dedupeKey.name).toBe(COLUMNS.events.dedupeKey)
    expect(schema.xp_events.dedupeKey.getSQLType()).toBe('varchar')
    expect(events.indexes.some(index => index.config.unique && index.config.columns.length === 1 &&
      'name' in index.config.columns[0]! && index.config.columns[0].name === COLUMNS.events.dedupeKey,
    )).toBe(true)
  })

  test('state is xp_state with timestamps; hasMany metrics live in xp_experiments_rels', () => {
    expect(getTableConfig(schema.xp_state).name).toBe(TABLES.state)
    expect(COLUMNS.state).toMatchObject({ createdAt: 'created_at', updatedAt: 'updated_at' })
    const rels = getTableConfig(schema.xp_experiments_rels)
    expect(rels.name).toBe(TABLES.experimentsRels)
    expect(rels.columns.map(column => column.name)).toEqual(['id', 'order', 'parent_id', 'path', 'xp_metrics_id'])
    const foreignKeys = rels.foreignKeys.map(key => key.reference())
    expect(foreignKeys.some(key => key.foreignTable === schema.xp_metrics)).toBe(true)
    expect(foreignKeys.some(key => key.foreignTable === schema.xp_experiments)).toBe(true)
    expect(Object.values(COLUMNS.experiments)).not.toContain('metrics_secondary_id')
    expect(Object.values(COLUMNS.experiments)).not.toContain('metrics_guardrails_id')
    // The two hasMany fields use the relation path, not separate scalar columns.
    expect(schema.relations_xp_experiments).toBeDefined()
  })

  test('array children cascade and version array row ids are serial, not varchar', () => {
    const arms = getTableConfig(schema.xp_experiments_arms)
    expect(arms.foreignKeys[0]?.onDelete).toBe('cascade')
    expect(schema.xp_experiments_arms.id.getSQLType()).toBe('varchar')
    expect(schema._xp_experiments_v_version_arms.id.getSQLType()).toBe('serial')
  })

  test('phase, snapshot and event experiment relationships are nullable', () => {
    for (const column of [schema.xp_phases.experiment, schema.xp_results_snapshots.experiment, schema.xp_events.experiment]) {
      expect(column.name).toBe('experiment_id')
      expect(column.notNull).toBe(false)
    }
  })
})
