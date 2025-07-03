const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/nkwflow'
});

module.exports = db;
