export {}
const query = 'SELECT * FROM xp_events'
const insert = `INSERT INTO xp_events VALUES (1)`
const update = 'UPDATE xp_state SET revision = 1'
const remove = 'DELETE FROM xp_events WHERE id = 1'
void [query, insert, update, remove]
