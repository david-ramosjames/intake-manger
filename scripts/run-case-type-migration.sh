#!/bin/bash

# Case Type Standardization Migration Runner
# This script runs the case type migration on your Supabase database

echo "🔄 Running Case Type Standardization Migration..."
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local file not found"
    echo "Please create .env.local with your Supabase credentials"
    exit 1
fi

# Load environment variables
export $(cat .env.local | grep -v '^#' | xargs)

if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Error: Missing SUPABASE credentials"
    echo "Required variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

echo "✅ Credentials loaded"
echo "📊 Database: $NEXT_PUBLIC_SUPABASE_URL"
echo ""

# Run the migrations using npx
echo "🔄 Running source_category migration..."
npx tsx -e "
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
  const sql = readFileSync('supabase/migrations/20261022180000_source_category.sql', 'utf-8');
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) console.error('Error:', error);
  else console.log('✅ Source category migration complete');
}

runMigration();
"

echo ""
echo "🔄 Running case type standardization migration..."
npx tsx -e "
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
  const sql = readFileSync('supabase/migrations/20261022181000_standardize_case_types.sql', 'utf-8');
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) console.error('Error:', error);
  else console.log('✅ Case type standardization complete');
  
  // Show results
  const { data } = await supabase
    .from('leads')
    .select('case_type')
    .like('case_type', 'T:%')
    .limit(5);
  
  if (data && data.length > 0) {
    console.log('\\n📋 Sample updated case types:');
    data.forEach(row => console.log('  -', row.case_type));
  }
}

runMigration();
"

echo ""
echo "✅ All migrations completed!"
